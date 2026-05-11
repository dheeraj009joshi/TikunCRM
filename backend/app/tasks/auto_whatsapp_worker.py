"""
Auto WhatsApp Background Worker

Processes pending and running bulk WhatsApp send jobs:
- Picks up pending jobs and starts processing
- Sends messages via Selenium with random delays
- Updates progress and broadcasts via WebSocket
- Handles pause/resume/cancel signals
- Logs errors and handles failures gracefully

Uses database-level locking (FOR UPDATE SKIP LOCKED) to prevent
duplicate job processing across multiple server workers.
"""
import asyncio
import logging
import os
import socket
import time
from datetime import timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select, or_
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
from app.services.activity import ActivityService
from app.models.activity import ActivityType

logger = logging.getLogger(__name__)

# Session maker for background tasks
_auto_wa_session_maker: Optional[async_sessionmaker] = None

# Daily message limit per dealership
DAILY_MESSAGE_LIMIT = 500

# Lock timeout - jobs locked for longer than this are considered stale
LOCK_TIMEOUT_MINUTES = 5


def get_worker_id() -> str:
    """Get a unique identifier for this worker process"""
    hostname = socket.gethostname()[:50]
    pid = os.getpid()
    return f"{hostname}:{pid}"


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
        
        # Add started log if this is the first time processing (index is 0)
        # Note: Status is already set to RUNNING atomically by run_auto_whatsapp_worker
        if job.current_index == 0 and job.sent_count == 0 and job.failed_count == 0:
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
        
        # Get or start driver (headless mode for background processing)
        driver = driver_manager.get_driver(slug, headless=True)
        if not driver._is_initialized:
            if not driver.start(timeout=30):
                service = AutoWhatsAppService(session)
                await service.update_job_status(
                    job_id,
                    AutoWhatsAppJobStatus.FAILED,
                    AutoWhatsAppLogAction.FAILED,
                    "Failed to start browser. Make sure Chrome is installed.",
                )
                # Clean up driver
                driver_manager.stop_driver(slug)
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
            
            # Close browser on failure
            driver_manager.stop_driver(slug)
            return {"error": "Session expired"}
        
        # Get service for updates
        service = AutoWhatsAppService(session)
        
        # Process leads starting from current_index
        lead_ids = job.lead_ids
        start_index = job.current_index
        sent_count = job.sent_count
        failed_count = job.failed_count
        
        logger.info(f"Processing job {job_id} from index {start_index}, total {len(lead_ids)} leads")
        
        # OPTIMIZATION: Batch fetch all remaining leads upfront (much faster than one-by-one)
        remaining_lead_ids = [UUID(lid) for lid in lead_ids[start_index:]]
        leads_result = await session.execute(
            select(Lead)
            .where(Lead.id.in_(remaining_lead_ids))
            .options(selectinload(Lead.customer), selectinload(Lead.dealership))
        )
        leads_by_id = {str(lead.id): lead for lead in leads_result.scalars().all()}
        logger.info(f"Batch loaded {len(leads_by_id)} leads for job {job_id}")
        
        # Batch commit interval - commit every N messages for performance
        BATCH_COMMIT_SIZE = 5
        messages_since_commit = 0
        
        for i in range(start_index, len(lead_ids)):
            # Check if job was paused or cancelled (only every 3 messages for performance)
            if i % 3 == 0:
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
                    
                    # Close browser on cancellation
                    driver_manager.stop_driver(slug)
                    return {
                        "status": "cancelled",
                        "sent_count": sent_count,
                        "failed_count": failed_count,
                        "at_index": i,
                    }
            
            # Get lead from pre-fetched batch (fast lookup)
            lead_id = lead_ids[i]
            lead = leads_by_id.get(lead_id)
            
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
                
                # Log activity for the lead (async, don't wait)
                try:
                    await ActivityService.log_activity(
                        session,
                        activity_type=ActivityType.WHATSAPP_SENT,
                        description=f"Auto WhatsApp message sent: {message[:100]}{'...' if len(message) > 100 else ''}",
                        lead_id=UUID(lead_id),
                        dealership_id=job.dealership_id,
                        user_id=job.created_by,
                        meta_data={
                            "job_id": str(job.id),
                            "job_name": job.name,
                            "phone": phone,
                            "message_preview": message[:200],
                            "auto_whatsapp": True,
                        }
                    )
                except Exception as activity_error:
                    logger.warning(f"Failed to log activity for lead {lead_id}: {activity_error}")
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
            messages_since_commit += 1
            
            # OPTIMIZATION: Batch commit every N messages (faster than every message)
            if messages_since_commit >= BATCH_COMMIT_SIZE or current_index == len(lead_ids):
                await session.commit()
                messages_since_commit = 0
            
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
            
            # Random delay between messages (3-6 seconds - reduced for faster processing)
            if i < len(lead_ids) - 1:  # Don't delay after last message
                delay = get_random_delay(3.0, 6.0)
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
        
        # Close browser after job completion to free resources
        driver_manager.stop_driver(slug)
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
    
    Uses database-level locking (FOR UPDATE SKIP LOCKED) to prevent
    multiple workers from processing the same job simultaneously.
    """
    logger.info("Running Auto WhatsApp worker...")
    
    session_maker = get_auto_whatsapp_session_maker()
    job_id = None
    worker_id = get_worker_id()
    
    # Calculate stale lock threshold (jobs locked for more than LOCK_TIMEOUT_MINUTES)
    stale_lock_threshold = utc_now() - timedelta(minutes=LOCK_TIMEOUT_MINUTES)
    
    async with session_maker() as session:
        async with session.begin():
            # Use FOR UPDATE SKIP LOCKED to atomically select and lock a job
            # This prevents multiple workers from selecting the same job
            result = await session.execute(
                select(AutoWhatsAppJob)
                .where(
                    or_(
                        # Pending jobs that aren't locked
                        AutoWhatsAppJob.status == AutoWhatsAppJobStatus.PENDING,
                        # Stale locked jobs (worker crashed, lock expired)
                        (AutoWhatsAppJob.status == AutoWhatsAppJobStatus.RUNNING) & 
                        (AutoWhatsAppJob.locked_at != None) & 
                        (AutoWhatsAppJob.locked_at < stale_lock_threshold)
                    )
                )
                .order_by(AutoWhatsAppJob.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)  # Skip rows locked by other transactions
            )
            job = result.scalar_one_or_none()
            
            if not job:
                logger.debug("No pending Auto WhatsApp jobs available")
                return
            
            job_id = job.id
            
            # Immediately lock the job by updating status and lock fields
            # This happens in the same transaction, so it's atomic
            job.status = AutoWhatsAppJobStatus.RUNNING
            job.locked_at = utc_now()
            job.locked_by = worker_id
            if not job.started_at:
                job.started_at = utc_now()
            
            logger.info(f"Acquired lock on job {job_id} (worker: {worker_id})")
        
        # Transaction committed, lock is now visible to other workers
    
    # Process the job (outside the session to avoid long transactions)
    try:
        await process_auto_whatsapp_job(job_id)
    except Exception as e:
        logger.exception(f"Error processing Auto WhatsApp job {job_id}: {e}")
        
        # Mark as failed and release lock
        async with session_maker() as session:
            service = AutoWhatsAppService(session)
            try:
                await service.update_job_status(
                    job_id,
                    AutoWhatsAppJobStatus.FAILED,
                    AutoWhatsAppLogAction.FAILED,
                    f"Job failed with error: {str(e)}",
                )
                # Clear lock fields
                result = await session.execute(
                    select(AutoWhatsAppJob).where(AutoWhatsAppJob.id == job_id)
                )
                failed_job = result.scalar_one_or_none()
                if failed_job:
                    failed_job.locked_at = None
                    failed_job.locked_by = None
                    await session.commit()
            except Exception as inner_e:
                logger.error(f"Failed to update job status: {inner_e}")
        
        # Clean up any running driver on error
        try:
            async with session_maker() as session:
                result = await session.execute(
                    select(AutoWhatsAppJob)
                    .where(AutoWhatsAppJob.id == job_id)
                    .options(selectinload(AutoWhatsAppJob.dealership))
                )
                failed_job = result.scalar_one_or_none()
                if failed_job and failed_job.dealership:
                    slug = failed_job.dealership.slug or str(failed_job.dealership_id)[:8]
                    driver_manager.stop_driver(slug)
        except Exception as cleanup_e:
            logger.warning(f"Failed to cleanup driver after error: {cleanup_e}")
    finally:
        # Release the lock when done (clear locked_at/locked_by)
        try:
            async with session_maker() as session:
                result = await session.execute(
                    select(AutoWhatsAppJob).where(AutoWhatsAppJob.id == job_id)
                )
                completed_job = result.scalar_one_or_none()
                if completed_job:
                    completed_job.locked_at = None
                    completed_job.locked_by = None
                    await session.commit()
                    logger.debug(f"Released database lock for job {job_id}")
        except Exception as e:
            logger.warning(f"Failed to release lock for job {job_id}: {e}")
