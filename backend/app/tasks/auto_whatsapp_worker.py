"""
Auto WhatsApp Background Worker

Processes pending and running bulk WhatsApp send jobs:
- Picks up pending jobs and starts processing
- Sends messages via Selenium with random delays
- Updates progress and broadcasts via WebSocket
- Handles pause/resume/cancel signals
- Logs errors and handles failures gracefully
"""
import asyncio
import logging
import time
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.timezone import utc_now
from app.db.database import get_engine_url_and_connect_args
from app.models.auto_whatsapp import (
    AutoWhatsAppJob,
    AutoWhatsAppProfile,
    AutoWhatsAppJobStatus,
    AutoWhatsAppProfileStatus,
    AutoWhatsAppLogAction,
)
from app.models.lead import Lead
from app.models.dealership import Dealership
from app.services.auto_whatsapp_service import AutoWhatsAppService
from app.services.auto_whatsapp_driver import (
    driver_manager,
    get_random_delay,
)

logger = logging.getLogger(__name__)

# Session maker for background tasks
_auto_wa_session_maker: Optional[async_sessionmaker] = None

# Daily message limit per dealership
DAILY_MESSAGE_LIMIT = 500


def get_auto_whatsapp_session_maker() -> async_sessionmaker:
    """Get or create an async session maker for Auto WhatsApp tasks."""
    global _auto_wa_session_maker
    if _auto_wa_session_maker is None:
        url, connect_args = get_engine_url_and_connect_args()
        engine = create_async_engine(
            url,
            connect_args=connect_args,
            pool_size=2,
            max_overflow=3,
            pool_pre_ping=True,
        )
        _auto_wa_session_maker = async_sessionmaker(engine, expire_on_commit=False)
    return _auto_wa_session_maker


async def broadcast_progress(job_id: str, data: dict):
    """Broadcast progress update to WebSocket clients"""
    try:
        from app.api.v1.endpoints.auto_whatsapp import broadcast_to_job
        await broadcast_to_job(job_id, data)
    except Exception as e:
        logger.warning(f"Failed to broadcast progress for job {job_id}: {e}")


async def process_auto_whatsapp_job(job_id: UUID) -> dict:
    """
    Process a single Auto WhatsApp job.
    
    Args:
        job_id: The job ID to process
        
    Returns:
        dict with status and counts
    """
    session_maker = get_auto_whatsapp_session_maker()
    job_id_str = str(job_id)
    
    async with session_maker() as session:
        # Get job with profile
        result = await session.execute(
            select(AutoWhatsAppJob)
            .where(AutoWhatsAppJob.id == job_id)
            .options(
                selectinload(AutoWhatsAppJob.profile),
                selectinload(AutoWhatsAppJob.dealership),
            )
        )
        job = result.scalar_one_or_none()
        
        if not job:
            logger.error(f"Auto WhatsApp job {job_id} not found")
            return {"error": "Job not found"}
        
        if job.status not in (AutoWhatsAppJobStatus.PENDING, AutoWhatsAppJobStatus.RUNNING):
            logger.warning(f"Job {job_id} is not pending/running (status: {job.status})")
            return {"error": f"Job is {job.status}"}
        
        # Check profile is connected
        if not job.profile or job.profile.status != AutoWhatsAppProfileStatus.CONNECTED:
            logger.error(f"WhatsApp profile not connected for job {job_id}")
            
            service = AutoWhatsAppService(session)
            await service.update_job_status(
                job_id,
                AutoWhatsAppJobStatus.FAILED,
                AutoWhatsAppLogAction.FAILED,
                "WhatsApp profile is not connected",
            )
            
            await broadcast_progress(job_id_str, {
                "type": "failed",
                "job_id": job_id_str,
                "status": "failed",
                "message": "WhatsApp profile is not connected",
                "sent": job.sent_count,
                "failed": job.failed_count,
            })
            
            return {"error": "Profile not connected"}
        
        # Get dealership slug for driver
        dealership = job.dealership
        slug = dealership.slug or str(dealership.id)[:8] if dealership else str(job.dealership_id)[:8]
        
        # Mark as running if pending
        if job.status == AutoWhatsAppJobStatus.PENDING:
            job.status = AutoWhatsAppJobStatus.RUNNING
            job.started_at = utc_now()
            await session.commit()
            
            # Add log
            service = AutoWhatsAppService(session)
            await service._add_job_log(
                job_id,
                AutoWhatsAppLogAction.STARTED,
                f"Job started processing {job.total_leads} leads",
            )
            
            await broadcast_progress(job_id_str, {
                "type": "started",
                "job_id": job_id_str,
                "status": "running",
                "sent": 0,
                "failed": 0,
                "total": job.total_leads,
                "percent": 0,
            })
        
        # Get or start driver
        driver = driver_manager.get_driver(slug, headless=False)
        if not driver._is_initialized:
            if not driver.start(timeout=30):
                service = AutoWhatsAppService(session)
                await service.update_job_status(
                    job_id,
                    AutoWhatsAppJobStatus.FAILED,
                    AutoWhatsAppLogAction.FAILED,
                    "Failed to start browser",
                )
                return {"error": "Failed to start browser"}
        
        # Verify still logged in
        if not driver.is_logged_in(timeout=10):
            service = AutoWhatsAppService(session)
            await service.update_job_status(
                job_id,
                AutoWhatsAppJobStatus.FAILED,
                AutoWhatsAppLogAction.FAILED,
                "WhatsApp session expired - please scan QR code again",
            )
            
            # Update profile status
            await service.update_profile_status(
                job.profile_id,
                AutoWhatsAppProfileStatus.DISCONNECTED,
                error_message="Session expired during job processing",
            )
            
            await broadcast_progress(job_id_str, {
                "type": "failed",
                "job_id": job_id_str,
                "status": "failed",
                "message": "WhatsApp session expired",
                "sent": job.sent_count,
                "failed": job.failed_count,
            })
            
            return {"error": "Session expired"}
        
        # Get service for updates
        service = AutoWhatsAppService(session)
        
        # Process leads starting from current_index
        lead_ids = job.lead_ids
        start_index = job.current_index
        sent_count = job.sent_count
        failed_count = job.failed_count
        
        logger.info(f"Processing job {job_id} from index {start_index}, total {len(lead_ids)} leads")
        
        for i in range(start_index, len(lead_ids)):
            # Check if job was paused or cancelled
            await session.refresh(job)
            if job.status == AutoWhatsAppJobStatus.PAUSED:
                logger.info(f"Job {job_id} paused at index {i}")
                
                await broadcast_progress(job_id_str, {
                    "type": "paused",
                    "job_id": job_id_str,
                    "status": "paused",
                    "sent": sent_count,
                    "failed": failed_count,
                    "at_index": i,
                })
                
                return {
                    "status": "paused",
                    "sent_count": sent_count,
                    "failed_count": failed_count,
                    "at_index": i,
                }
            
            if job.status == AutoWhatsAppJobStatus.CANCELLED:
                logger.info(f"Job {job_id} cancelled at index {i}")
                
                await broadcast_progress(job_id_str, {
                    "type": "cancelled",
                    "job_id": job_id_str,
                    "status": "cancelled",
                    "sent": sent_count,
                    "failed": failed_count,
                    "at_index": i,
                })
                
                return {
                    "status": "cancelled",
                    "sent_count": sent_count,
                    "failed_count": failed_count,
                    "at_index": i,
                }
            
            # Get lead
            lead_id = lead_ids[i]
            lead_result = await session.execute(
                select(Lead)
                .where(Lead.id == UUID(lead_id))
                .options(selectinload(Lead.customer), selectinload(Lead.dealership))
            )
            lead = lead_result.scalar_one_or_none()
            
            if not lead or not lead.customer or not lead.customer.phone:
                logger.warning(f"Lead {lead_id} not found or has no phone")
                failed_count += 1
                await service.add_job_error(
                    job_id, lead_id, "Unknown", "N/A", "Lead not found or missing phone"
                )
                continue
            
            phone = lead.customer.phone
            lead_name = lead.customer.full_name or lead.customer.first_name or "Unknown"
            
            # Replace placeholders in message
            message = service.replace_placeholders(job.message_text, lead)
            
            # Send message
            logger.info(f"Sending message to {phone} ({lead_name}) - job {job_id} index {i}")
            success, error = driver.send_message(phone, message, timeout=30)
            
            if success:
                sent_count += 1
                logger.info(f"Message sent to {phone}")
            else:
                failed_count += 1
                logger.warning(f"Failed to send to {phone}: {error}")
                await service.add_job_error(job_id, lead_id, lead_name, phone, error or "Unknown error")
                
                await broadcast_progress(job_id_str, {
                    "type": "error",
                    "job_id": job_id_str,
                    "lead_id": lead_id,
                    "lead_name": lead_name,
                    "phone": phone,
                    "error": error or "Unknown error",
                    "timestamp": utc_now().isoformat(),
                })
            
            # Update progress
            current_index = i + 1
            job.sent_count = sent_count
            job.failed_count = failed_count
            job.current_index = current_index
            await session.commit()
            
            # Broadcast progress
            percent = round((sent_count + failed_count) / job.total_leads * 100, 1)
            await broadcast_progress(job_id_str, {
                "type": "progress",
                "job_id": job_id_str,
                "status": "running",
                "sent": sent_count,
                "failed": failed_count,
                "total": job.total_leads,
                "current_index": current_index,
                "current_lead_name": lead_name,
                "percent": percent,
            })
            
            # Random delay between messages (5-10 seconds)
            if i < len(lead_ids) - 1:  # Don't delay after last message
                delay = get_random_delay(5.0, 10.0)
                logger.debug(f"Waiting {delay:.1f}s before next message")
                await asyncio.sleep(delay)
        
        # Job completed
        job.status = AutoWhatsAppJobStatus.COMPLETED
        job.completed_at = utc_now()
        await session.commit()
        
        await service._add_job_log(
            job_id,
            AutoWhatsAppLogAction.COMPLETED,
            f"Job completed: sent={sent_count}, failed={failed_count}",
            {"sent_count": sent_count, "failed_count": failed_count},
        )
        
        # Calculate duration
        duration_seconds = None
        if job.started_at:
            duration_seconds = int((job.completed_at - job.started_at).total_seconds())
        
        await broadcast_progress(job_id_str, {
            "type": "completed",
            "job_id": job_id_str,
            "status": "completed",
            "sent": sent_count,
            "failed": failed_count,
            "total": job.total_leads,
            "percent": 100,
            "duration_seconds": duration_seconds,
        })
        
        logger.info(f"Job {job_id} completed: sent={sent_count}, failed={failed_count}")
        
        return {
            "status": "completed",
            "sent_count": sent_count,
            "failed_count": failed_count,
        }


async def run_auto_whatsapp_worker():
    """
    Background task to process pending Auto WhatsApp jobs.
    Called periodically by the scheduler.
    """
    logger.info("Running Auto WhatsApp worker...")
    
    session_maker = get_auto_whatsapp_session_maker()
    
    async with session_maker() as session:
        # Find pending or running jobs (running jobs may have been interrupted)
        result = await session.execute(
            select(AutoWhatsAppJob)
            .where(
                AutoWhatsAppJob.status.in_([
                    AutoWhatsAppJobStatus.PENDING,
                    AutoWhatsAppJobStatus.RUNNING,
                ])
            )
            .order_by(AutoWhatsAppJob.created_at)
            .limit(1)  # Process one job at a time
        )
        job = result.scalar_one_or_none()
        
        if not job:
            logger.debug("No pending Auto WhatsApp jobs")
            return
        
        logger.info(f"Found job to process: {job.id} (status: {job.status})")
    
    # Process the job (outside the session to avoid long transactions)
    try:
        await process_auto_whatsapp_job(job.id)
    except Exception as e:
        logger.exception(f"Error processing Auto WhatsApp job {job.id}: {e}")
        
        # Mark as failed
        async with session_maker() as session:
            service = AutoWhatsAppService(session)
            try:
                await service.update_job_status(
                    job.id,
                    AutoWhatsAppJobStatus.FAILED,
                    AutoWhatsAppLogAction.FAILED,
                    f"Job failed with error: {str(e)}",
                )
            except Exception as inner_e:
                logger.error(f"Failed to update job status: {inner_e}")
