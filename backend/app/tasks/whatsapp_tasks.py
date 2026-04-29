"""
WhatsApp Background Tasks

Handles:
- Processing pending bulk WhatsApp sends
- Auto-sending WhatsApp templates for new leads matching campaigns
"""
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.timezone import utc_now
from app.db.database import get_engine_url_and_connect_args
from app.models.whatsapp_message import WhatsAppBulkSend
from app.models.whatsapp_template import WhatsAppTemplate
from app.models.campaign_mapping import CampaignMapping
from app.models.lead import Lead
from app.models.lead_campaign import LeadCampaign
from app.services.whatsapp_conversation_service import WhatsAppConversationService
from app.services.dealership_twilio_config_service import get_effective_twilio_config

logger = logging.getLogger(__name__)

# Session maker for background tasks
_whatsapp_session_maker: Optional[async_sessionmaker] = None


def get_whatsapp_session_maker() -> async_sessionmaker:
    """Get or create an async session maker for WhatsApp tasks."""
    global _whatsapp_session_maker
    if _whatsapp_session_maker is None:
        url, connect_args = get_engine_url_and_connect_args()
        engine = create_async_engine(
            url,
            connect_args=connect_args,
            pool_size=2,
            max_overflow=3,
            pool_pre_ping=True,
        )
        _whatsapp_session_maker = async_sessionmaker(engine, expire_on_commit=False)
    return _whatsapp_session_maker


async def send_campaign_whatsapp_for_lead(
    session: AsyncSession,
    lead_id: UUID,
    campaign_mapping: CampaignMapping,
) -> bool:
    """
    Send WhatsApp template to a new lead that matched a campaign with auto-send enabled.
    
    Returns True if message was sent successfully, False otherwise.
    """
    if not campaign_mapping.whatsapp_auto_send:
        return False
    
    if not campaign_mapping.whatsapp_template_id:
        logger.warning(
            f"Campaign {campaign_mapping.id} has auto_send=True but no template assigned"
        )
        return False
    
    # Get lead with phone
    lead_result = await session.execute(
        select(Lead).where(Lead.id == lead_id)
    )
    lead = lead_result.scalar_one_or_none()
    
    if not lead or not lead.phone:
        logger.debug(f"Lead {lead_id} has no phone number, skipping WhatsApp auto-send")
        return False
    
    # Get template
    template_result = await session.execute(
        select(WhatsAppTemplate).where(
            WhatsAppTemplate.id == campaign_mapping.whatsapp_template_id
        )
    )
    template = template_result.scalar_one_or_none()
    
    if not template:
        logger.warning(
            f"Template {campaign_mapping.whatsapp_template_id} not found for campaign {campaign_mapping.id}"
        )
        return False
    
    # Check WhatsApp is configured for this dealership
    dealership_id = lead.dealership_id or campaign_mapping.dealership_id
    effective_config = await get_effective_twilio_config(session, dealership_id)
    
    if not effective_config.is_whatsapp_ready():
        logger.warning(
            f"WhatsApp not configured for dealership {dealership_id}, skipping auto-send"
        )
        return False
    
    # Build content variables - support basic placeholders
    content_variables = {}
    for var_name in template.variable_names:
        if var_name == "1" or var_name.lower() == "first_name":
            content_variables[var_name] = lead.first_name or "Customer"
        elif var_name == "2" or var_name.lower() == "last_name":
            content_variables[var_name] = lead.last_name or ""
        elif var_name.lower() == "full_name" or var_name.lower() == "name":
            content_variables[var_name] = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "Customer"
        else:
            content_variables[var_name] = ""  # Unknown variable
    
    # Send the message
    service = WhatsAppConversationService(session)
    success, wa_log, error = await service.send_whatsapp_template(
        to_number=lead.phone,
        content_sid=template.content_sid,
        content_variables=content_variables,
        user_id=None,  # System-initiated
        lead_id=lead.id,
        dealership_id=dealership_id,
    )
    
    if success:
        logger.info(
            f"Auto-sent WhatsApp template {template.name} to lead {lead_id} "
            f"(campaign: {campaign_mapping.display_name})"
        )
    else:
        logger.warning(
            f"Failed to auto-send WhatsApp to lead {lead_id}: {error}"
        )
    
    return success


async def process_bulk_send(bulk_send_id: UUID) -> dict:
    """
    Process a pending bulk WhatsApp send.
    
    Returns stats dict with sent_count, failed_count, etc.
    """
    session_maker = get_whatsapp_session_maker()
    
    async with session_maker() as session:
        # Get bulk send record
        result = await session.execute(
            select(WhatsAppBulkSend).where(WhatsAppBulkSend.id == bulk_send_id)
        )
        bulk_send = result.scalar_one_or_none()
        
        if not bulk_send:
            logger.error(f"Bulk send {bulk_send_id} not found")
            return {"error": "Bulk send not found"}
        
        if bulk_send.status != "pending":
            logger.warning(f"Bulk send {bulk_send_id} is not pending (status: {bulk_send.status})")
            return {"error": f"Bulk send is {bulk_send.status}"}
        
        # Mark as in progress
        bulk_send.status = "in_progress"
        bulk_send.started_at = utc_now()
        await session.commit()
        
        # Get filter criteria
        filter_criteria = bulk_send.filter_criteria or {}
        content_sid = bulk_send.message_template
        content_variables_template = filter_criteria.get("content_variables", {})
        
        # Build lead query
        lead_query = select(Lead).where(Lead.phone.isnot(None), Lead.phone != "")
        
        if bulk_send.dealership_id:
            lead_query = lead_query.where(Lead.dealership_id == bulk_send.dealership_id)
        
        lead_ids = filter_criteria.get("lead_ids")
        campaign_mapping_id = filter_criteria.get("campaign_mapping_id")
        
        if lead_ids:
            lead_ids = [UUID(lid) for lid in lead_ids]
            lead_query = lead_query.where(Lead.id.in_(lead_ids))
        elif campaign_mapping_id:
            campaign_mapping_id = UUID(campaign_mapping_id)
            from sqlalchemy import or_
            lead_query = lead_query.where(
                or_(
                    Lead.campaign_mapping_id == campaign_mapping_id,
                    Lead.id.in_(
                        select(LeadCampaign.lead_id).where(
                            LeadCampaign.campaign_mapping_id == campaign_mapping_id
                        )
                    )
                )
            )
        
        # Fetch leads
        leads_result = await session.execute(lead_query)
        leads = leads_result.scalars().all()
        
        sent_count = 0
        failed_count = 0
        
        service = WhatsAppConversationService(session)
        
        for lead in leads:
            # Build content variables with lead data
            content_variables = {}
            for key, value in content_variables_template.items():
                if "{{first_name}}" in value:
                    value = value.replace("{{first_name}}", lead.first_name or "Customer")
                if "{{last_name}}" in value:
                    value = value.replace("{{last_name}}", lead.last_name or "")
                if "{{lead_name}}" in value or "{{name}}" in value:
                    full_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "Customer"
                    value = value.replace("{{lead_name}}", full_name).replace("{{name}}", full_name)
                content_variables[key] = value
            
            # Get effective config for this lead's dealership
            effective = await get_effective_twilio_config(session, lead.dealership_id)
            if not effective.is_whatsapp_ready():
                logger.warning(f"WhatsApp not ready for dealership {lead.dealership_id}")
                failed_count += 1
                continue
            
            # Send message
            success, wa_log, error = await service.send_whatsapp_template(
                to_number=lead.phone,
                content_sid=content_sid,
                content_variables=content_variables,
                user_id=bulk_send.user_id,
                lead_id=lead.id,
                dealership_id=lead.dealership_id,
            )
            
            if success:
                sent_count += 1
            else:
                failed_count += 1
                logger.warning(f"Failed to send to lead {lead.id}: {error}")
            
            # Update progress periodically
            if (sent_count + failed_count) % 10 == 0:
                bulk_send.sent_count = sent_count
                bulk_send.failed_count = failed_count
                await session.commit()
        
        # Mark as completed
        bulk_send.status = "completed"
        bulk_send.completed_at = utc_now()
        bulk_send.sent_count = sent_count
        bulk_send.failed_count = failed_count
        await session.commit()
        
        logger.info(
            f"Bulk send {bulk_send_id} completed: sent={sent_count}, failed={failed_count}"
        )
        
        return {
            "bulk_send_id": str(bulk_send_id),
            "status": "completed",
            "sent_count": sent_count,
            "failed_count": failed_count,
        }


async def run_process_pending_bulk_sends():
    """
    Task to process all pending bulk WhatsApp sends.
    Called periodically by the scheduler.
    """
    logger.info("Processing pending bulk WhatsApp sends...")
    
    session_maker = get_whatsapp_session_maker()
    
    async with session_maker() as session:
        # Find pending bulk sends
        result = await session.execute(
            select(WhatsAppBulkSend).where(
                WhatsAppBulkSend.status == "pending"
            ).order_by(WhatsAppBulkSend.created_at).limit(5)
        )
        pending_sends = result.scalars().all()
        
        if not pending_sends:
            logger.debug("No pending bulk sends")
            return
        
        logger.info(f"Found {len(pending_sends)} pending bulk sends")
    
    # Process each one (outside the session to avoid long transactions)
    for bulk_send in pending_sends:
        try:
            await process_bulk_send(bulk_send.id)
        except Exception as e:
            logger.exception(f"Error processing bulk send {bulk_send.id}: {e}")
            # Mark as failed
            async with session_maker() as session:
                result = await session.execute(
                    select(WhatsAppBulkSend).where(WhatsAppBulkSend.id == bulk_send.id)
                )
                bs = result.scalar_one_or_none()
                if bs:
                    bs.status = "failed"
                    await session.commit()
