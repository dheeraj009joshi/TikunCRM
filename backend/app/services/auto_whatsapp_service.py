"""
Auto WhatsApp Business Logic Service

Handles:
- Profile management (setup, status, connection)
- Lead filtering and preview
- Job creation and management
- Message placeholder replacement
"""
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utc_now
from app.models.auto_whatsapp import (
    AutoWhatsAppProfile,
    AutoWhatsAppJob,
    AutoWhatsAppJobLog,
    AutoWhatsAppProfileStatus,
    AutoWhatsAppJobStatus,
    AutoWhatsAppLogAction,
)
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.lead_stage import LeadStage
from app.models.lead_campaign import LeadCampaign
from app.models.dealership import Dealership
from app.models.user import User
from app.schemas.auto_whatsapp import (
    LeadPreviewFilter,
    LeadPreviewItem,
    LeadPreviewResponse,
)
from app.services.auto_whatsapp_driver import (
    AutoWhatsAppDriver,
    driver_manager,
    get_random_delay,
)

logger = logging.getLogger(__name__)


class AutoWhatsAppService:
    """Service for Auto WhatsApp business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ==================== PROFILE MANAGEMENT ====================

    async def get_profile_for_dealership(
        self, dealership_id: UUID
    ) -> Optional[AutoWhatsAppProfile]:
        """Get WhatsApp profile for a dealership"""
        result = await self.db.execute(
            select(AutoWhatsAppProfile)
            .options(selectinload(AutoWhatsAppProfile.dealership))
            .where(AutoWhatsAppProfile.dealership_id == dealership_id)
        )
        return result.scalar_one_or_none()

    async def get_or_create_profile(
        self, dealership_id: UUID
    ) -> Tuple[AutoWhatsAppProfile, bool]:
        """
        Get existing profile or create a new one.
        Returns (profile, created) tuple.
        """
        profile = await self.get_profile_for_dealership(dealership_id)
        if profile:
            return profile, False

        # Get dealership for slug
        dealership = await self.db.get(Dealership, dealership_id)
        if not dealership:
            raise ValueError(f"Dealership {dealership_id} not found")

        # Create profile with dealership slug for directory name
        slug = dealership.slug or str(dealership_id)[:8]
        profile_path = f"auto_whatsapp/profiles/{slug}"

        profile = AutoWhatsAppProfile(
            dealership_id=dealership_id,
            profile_path=profile_path,
            status=AutoWhatsAppProfileStatus.DISCONNECTED,
        )
        self.db.add(profile)
        await self.db.commit()
        await self.db.refresh(profile)
        
        return profile, True

    async def update_profile_status(
        self,
        profile_id: UUID,
        status: AutoWhatsAppProfileStatus,
        phone_number: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> AutoWhatsAppProfile:
        """Update profile status"""
        profile = await self.db.get(AutoWhatsAppProfile, profile_id)
        if not profile:
            raise ValueError(f"Profile {profile_id} not found")

        profile.status = status
        if phone_number is not None:
            profile.phone_number = phone_number
        if error_message is not None:
            profile.error_message = error_message
        if status == AutoWhatsAppProfileStatus.CONNECTED:
            profile.last_connected_at = utc_now()
            profile.error_message = None

        await self.db.commit()
        await self.db.refresh(profile)
        return profile

    async def check_phone_number_used(
        self, phone_number: str, exclude_dealership_id: Optional[UUID] = None
    ) -> Optional[Dealership]:
        """
        Check if a phone number is already used by another dealership.
        Returns the dealership using it, or None.
        """
        query = select(AutoWhatsAppProfile).where(
            AutoWhatsAppProfile.phone_number == phone_number
        )
        if exclude_dealership_id:
            query = query.where(
                AutoWhatsAppProfile.dealership_id != exclude_dealership_id
            )

        result = await self.db.execute(query)
        existing = result.scalar_one_or_none()
        
        if existing:
            dealership = await self.db.get(Dealership, existing.dealership_id)
            return dealership
        return None

    async def delete_profile(self, dealership_id: UUID) -> bool:
        """Delete a profile and stop any associated driver"""
        profile = await self.get_profile_for_dealership(dealership_id)
        if not profile:
            return False

        # Stop the driver if running
        dealership = await self.db.get(Dealership, dealership_id)
        if dealership and dealership.slug:
            driver_manager.stop_driver(dealership.slug)

        await self.db.delete(profile)
        await self.db.commit()
        return True

    # ==================== LEAD FILTERING ====================

    async def preview_leads(
        self,
        dealership_id: UUID,
        filters: LeadPreviewFilter,
        limit: int = 500,
    ) -> LeadPreviewResponse:
        """
        Get leads matching filters for preview before bulk send.
        """
        # Base query - join with customer for contact info and stage for display
        query = (
            select(Lead)
            .join(Customer, Lead.customer_id == Customer.id)
            .outerjoin(LeadStage, Lead.stage_id == LeadStage.id)
            .where(Lead.dealership_id == dealership_id)
            .options(
                selectinload(Lead.customer),
                selectinload(Lead.stage),
            )
        )

        # Apply filters
        conditions = []

        if filters.stage_ids:
            conditions.append(Lead.stage_id.in_(filters.stage_ids))

        if filters.campaign_ids:
            # Match leads with any of the campaigns
            subquery = (
                select(LeadCampaign.lead_id)
                .where(LeadCampaign.campaign_mapping_id.in_(filters.campaign_ids))
            )
            conditions.append(
                or_(
                    Lead.campaign_mapping_id.in_(filters.campaign_ids),
                    Lead.id.in_(subquery),
                )
            )

        if filters.source:
            conditions.append(Lead.source == filters.source)

        if filters.salesperson_id:
            conditions.append(Lead.assigned_to == filters.salesperson_id)

        if filters.is_active is not None:
            conditions.append(Lead.is_active == filters.is_active)

        if filters.created_after:
            conditions.append(Lead.created_at >= filters.created_after)

        if filters.created_before:
            conditions.append(Lead.created_at <= filters.created_before)

        if filters.search:
            search_term = f"%{filters.search}%"
            conditions.append(
                or_(
                    Customer.first_name.ilike(search_term),
                    Customer.last_name.ilike(search_term),
                    Customer.phone.ilike(search_term),
                    Customer.email.ilike(search_term),
                )
            )

        if conditions:
            query = query.where(and_(*conditions))

        # Execute query
        result = await self.db.execute(query.limit(limit))
        leads = result.scalars().all()

        # Build response
        preview_items = []
        has_phone_count = 0
        missing_phone_count = 0

        for lead in leads:
            has_phone = bool(lead.customer and lead.customer.phone)
            if has_phone:
                has_phone_count += 1
            else:
                missing_phone_count += 1

            # Skip leads without phone if filter requires it
            if filters.has_phone and not has_phone:
                continue

            item = LeadPreviewItem(
                id=lead.id,
                first_name=lead.customer.first_name if lead.customer else "Unknown",
                last_name=lead.customer.last_name if lead.customer else None,
                phone=lead.customer.phone if lead.customer else None,
                email=lead.customer.email if lead.customer else None,
                stage_name=lead.stage.display_name if lead.stage else None,
                stage_color=lead.stage.color if lead.stage else None,
                source=lead.source.value if lead.source else None,
                interested_in=lead.interested_in,
                created_at=lead.created_at,
            )
            preview_items.append(item)

        return LeadPreviewResponse(
            leads=preview_items,
            total_count=len(leads),
            has_phone_count=has_phone_count,
            missing_phone_count=missing_phone_count,
        )

    async def get_leads_by_ids(
        self, lead_ids: List[UUID]
    ) -> List[Lead]:
        """Get leads by IDs with customer info loaded"""
        result = await self.db.execute(
            select(Lead)
            .where(Lead.id.in_(lead_ids))
            .options(selectinload(Lead.customer))
        )
        return list(result.scalars().all())

    # ==================== JOB MANAGEMENT ====================

    async def create_job(
        self,
        dealership_id: UUID,
        user_id: UUID,
        name: str,
        message_text: str,
        lead_ids: List[UUID],
        filter_criteria: Optional[Dict[str, Any]] = None,
    ) -> AutoWhatsAppJob:
        """Create a new bulk send job"""
        # Verify profile exists and is connected
        profile = await self.get_profile_for_dealership(dealership_id)
        if not profile:
            raise ValueError("WhatsApp profile not configured for this dealership")
        if profile.status != AutoWhatsAppProfileStatus.CONNECTED:
            raise ValueError(f"WhatsApp profile is not connected (status: {profile.status})")

        # Verify leads exist and have phone numbers
        leads = await self.get_leads_by_ids(lead_ids)
        valid_lead_ids = []
        for lead in leads:
            if lead.customer and lead.customer.phone:
                valid_lead_ids.append(str(lead.id))

        if not valid_lead_ids:
            raise ValueError("No leads with valid phone numbers found")

        # Create job
        job = AutoWhatsAppJob(
            dealership_id=dealership_id,
            profile_id=profile.id,
            created_by=user_id,
            name=name,
            message_text=message_text,
            status=AutoWhatsAppJobStatus.PENDING,
            total_leads=len(valid_lead_ids),
            lead_ids=valid_lead_ids,
            filter_criteria=filter_criteria or {},
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)

        # Add creation log
        await self._add_job_log(
            job.id,
            AutoWhatsAppLogAction.CREATED,
            f"Job created with {len(valid_lead_ids)} leads",
            {"original_count": len(lead_ids), "valid_count": len(valid_lead_ids)},
        )

        return job

    async def get_job(self, job_id: UUID) -> Optional[AutoWhatsAppJob]:
        """Get a job by ID with relationships loaded"""
        result = await self.db.execute(
            select(AutoWhatsAppJob)
            .where(AutoWhatsAppJob.id == job_id)
            .options(
                selectinload(AutoWhatsAppJob.profile),
                selectinload(AutoWhatsAppJob.created_by_user),
                selectinload(AutoWhatsAppJob.logs),
            )
        )
        return result.scalar_one_or_none()

    async def list_jobs(
        self,
        dealership_id: UUID,
        status: Optional[AutoWhatsAppJobStatus] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[AutoWhatsAppJob], int]:
        """List jobs for a dealership with pagination"""
        query = (
            select(AutoWhatsAppJob)
            .where(AutoWhatsAppJob.dealership_id == dealership_id)
            .options(selectinload(AutoWhatsAppJob.created_by_user))
            .order_by(AutoWhatsAppJob.created_at.desc())
        )

        if status:
            query = query.where(AutoWhatsAppJob.status == status)

        # Get total count
        count_query = select(func.count()).select_from(
            query.subquery()
        )
        total = (await self.db.execute(count_query)).scalar() or 0

        # Apply pagination
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        jobs = list(result.scalars().all())

        return jobs, total

    async def update_job_status(
        self,
        job_id: UUID,
        status: AutoWhatsAppJobStatus,
        log_action: Optional[AutoWhatsAppLogAction] = None,
        log_message: Optional[str] = None,
    ) -> AutoWhatsAppJob:
        """Update job status and optionally add a log entry"""
        job = await self.db.get(AutoWhatsAppJob, job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        old_status = job.status
        job.status = status

        # Update timestamps based on status
        now = utc_now()
        if status == AutoWhatsAppJobStatus.RUNNING and not job.started_at:
            job.started_at = now
        elif status == AutoWhatsAppJobStatus.PAUSED:
            job.paused_at = now
        elif status in (
            AutoWhatsAppJobStatus.COMPLETED,
            AutoWhatsAppJobStatus.CANCELLED,
            AutoWhatsAppJobStatus.FAILED,
        ):
            job.completed_at = now

        await self.db.commit()
        await self.db.refresh(job)

        # Add log entry
        if log_action and log_message:
            await self._add_job_log(
                job_id,
                log_action,
                log_message,
                {"old_status": old_status.value, "new_status": status.value},
            )

        return job

    async def update_job_progress(
        self,
        job_id: UUID,
        sent_count: int,
        failed_count: int,
        current_index: int,
    ) -> AutoWhatsAppJob:
        """Update job progress counters"""
        job = await self.db.get(AutoWhatsAppJob, job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job.sent_count = sent_count
        job.failed_count = failed_count
        job.current_index = current_index

        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def add_job_error(
        self,
        job_id: UUID,
        lead_id: str,
        lead_name: str,
        phone: str,
        error: str,
    ) -> None:
        """Add an error to the job's error list"""
        job = await self.db.get(AutoWhatsAppJob, job_id)
        if not job:
            return

        error_entry = {
            "lead_id": lead_id,
            "lead_name": lead_name,
            "phone": phone,
            "error": error,
            "timestamp": utc_now().isoformat(),
        }

        # JSONB requires reassignment for change detection
        errors = list(job.errors)
        errors.append(error_entry)
        job.errors = errors

        await self.db.commit()

    async def _add_job_log(
        self,
        job_id: UUID,
        action: AutoWhatsAppLogAction,
        message: str,
        meta_data: Optional[Dict[str, Any]] = None,
    ) -> AutoWhatsAppJobLog:
        """Add a log entry for a job"""
        log = AutoWhatsAppJobLog(
            job_id=job_id,
            action=action,
            message=message,
            meta_data=meta_data or {},
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        return log

    async def pause_job(self, job_id: UUID) -> AutoWhatsAppJob:
        """Pause a running job"""
        job = await self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        if job.status != AutoWhatsAppJobStatus.RUNNING:
            raise ValueError(f"Cannot pause job in status {job.status}")

        return await self.update_job_status(
            job_id,
            AutoWhatsAppJobStatus.PAUSED,
            AutoWhatsAppLogAction.PAUSED,
            f"Job paused at index {job.current_index}",
        )

    async def resume_job(self, job_id: UUID) -> AutoWhatsAppJob:
        """Resume a paused job"""
        job = await self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        if job.status != AutoWhatsAppJobStatus.PAUSED:
            raise ValueError(f"Cannot resume job in status {job.status}")

        return await self.update_job_status(
            job_id,
            AutoWhatsAppJobStatus.RUNNING,
            AutoWhatsAppLogAction.RESUMED,
            f"Job resumed from index {job.current_index}",
        )

    async def cancel_job(self, job_id: UUID) -> AutoWhatsAppJob:
        """Cancel a pending, running, or paused job"""
        job = await self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        if job.status in (
            AutoWhatsAppJobStatus.COMPLETED,
            AutoWhatsAppJobStatus.CANCELLED,
            AutoWhatsAppJobStatus.FAILED,
        ):
            raise ValueError(f"Cannot cancel job in status {job.status}")

        return await self.update_job_status(
            job_id,
            AutoWhatsAppJobStatus.CANCELLED,
            AutoWhatsAppLogAction.CANCELLED,
            f"Job cancelled at index {job.current_index} (sent: {job.sent_count}, failed: {job.failed_count})",
        )

    # ==================== MESSAGE PROCESSING ====================

    def replace_placeholders(self, template: str, lead: Lead) -> str:
        """
        Replace placeholders in message template with lead data.
        
        Supported placeholders:
        - {{first_name}}
        - {{last_name}}
        - {{full_name}}
        - {{phone}}
        - {{interested_in}}
        - {{dealership_name}}
        """
        customer = lead.customer
        dealership = lead.dealership

        replacements = {
            "{{first_name}}": customer.first_name if customer else "Customer",
            "{{last_name}}": customer.last_name if customer else "",
            "{{full_name}}": customer.full_name if customer else "Customer",
            "{{phone}}": customer.phone if customer else "",
            "{{interested_in}}": lead.interested_in or "",
            "{{dealership_name}}": dealership.name if dealership else "",
        }

        result = template
        for placeholder, value in replacements.items():
            result = result.replace(placeholder, value or "")

        # Clean up extra whitespace from empty replacements
        result = re.sub(r"\s+", " ", result).strip()

        return result
