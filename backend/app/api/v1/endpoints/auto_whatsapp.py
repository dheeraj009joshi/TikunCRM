"""
Auto WhatsApp API Endpoints

Handles:
- Profile setup and management (QR code scanning)
- Lead preview and selection
- Bulk send job management (create, pause, resume, cancel)
- Real-time progress via WebSocket
"""
import asyncio
import concurrent.futures
import logging
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.auto_whatsapp import (
    AutoWhatsAppProfileStatus,
    AutoWhatsAppJobStatus,
    AutoWhatsAppLogAction,
)
from app.schemas.auto_whatsapp import (
    AutoWhatsAppProfileResponse,
    AutoWhatsAppProfileSetupResponse,
    AutoWhatsAppProfileStatusResponse,
    LeadPreviewFilter,
    LeadPreviewResponse,
    AutoWhatsAppJobCreate,
    AutoWhatsAppJobResponse,
    AutoWhatsAppJobDetailResponse,
    AutoWhatsAppJobListResponse,
    AutoWhatsAppJobActionResponse,
    AutoWhatsAppJobLogResponse,
)
from app.services.auto_whatsapp_service import AutoWhatsAppService
from app.services.auto_whatsapp_driver import driver_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auto-whatsapp", tags=["Auto WhatsApp"])


# ==================== HELPER FUNCTIONS ====================

def _require_admin(current_user: User) -> None:
    """Raise 403 if user is not admin or super admin"""
    if current_user.role not in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can manage Auto WhatsApp",
        )


def _require_dealership(current_user: User) -> UUID:
    """Raise 400 if user has no dealership, return dealership_id"""
    if not current_user.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User must be associated with a dealership",
        )
    return current_user.dealership_id


# ==================== PROFILE ENDPOINTS ====================

@router.get("/profile", response_model=AutoWhatsAppProfileResponse)
async def get_profile(
    verify: bool = Query(False, description="Actually verify session by opening browser (slower)"),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the WhatsApp profile for the current user's dealership.
    If verify=true, actually checks the browser session (takes 10-15 seconds).
    Returns 404 if no profile exists.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    profile = await service.get_profile_for_dealership(dealership_id)

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="WhatsApp profile not configured. Use POST /profile/setup to create one.",
        )

    actual_status = profile.status
    error_message = profile.error_message

    # Only verify if explicitly requested (to avoid blocking other requests)
    if verify:
        from app.models.dealership import Dealership
        import concurrent.futures
        
        dealership = await db.get(Dealership, dealership_id)
        slug = dealership.slug or str(dealership_id)[:8] if dealership else str(dealership_id)[:8]
        profile_id = profile.id

        def check_browser_status():
            """Run browser check in thread to not block async loop"""
            try:
                driver = driver_manager.get_driver(slug, headless=True)
                if not driver._is_initialized:
                    if driver.start(timeout=30):
                        is_connected = driver.is_logged_in(timeout=10)
                        driver_manager.stop_driver(slug)
                        return is_connected
                    return None  # Couldn't start
                else:
                    is_connected = driver.is_logged_in(timeout=5)
                    driver_manager.stop_driver(slug)
                    return is_connected
            except Exception as e:
                logger.warning(f"Error in browser check: {e}")
                return None

        # Run browser check in thread pool
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as executor:
            is_connected = await loop.run_in_executor(executor, check_browser_status)

        if is_connected is not None:
            if is_connected:
                actual_status = AutoWhatsAppProfileStatus.CONNECTED
                error_message = None
            else:
                actual_status = AutoWhatsAppProfileStatus.DISCONNECTED
                error_message = "Session expired or logged out"

            # Update profile status if changed
            if actual_status != profile.status:
                await service.update_profile_status(
                    profile_id,
                    actual_status,
                    error_message=error_message,
                )

    return AutoWhatsAppProfileResponse(
        id=profile.id,
        dealership_id=profile.dealership_id,
        dealership_name=profile.dealership.name if profile.dealership else None,
        phone_number=profile.phone_number,
        status=actual_status.value if isinstance(actual_status, AutoWhatsAppProfileStatus) else actual_status,
        last_connected_at=profile.last_connected_at,
        error_message=error_message,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


@router.post("/profile/setup", response_model=AutoWhatsAppProfileSetupResponse)
async def setup_profile(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Start WhatsApp profile setup by launching browser and generating QR code.
    If profile doesn't exist, creates one.
    Returns QR code as base64 for user to scan.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    
    # Get or create profile
    profile, created = await service.get_or_create_profile(dealership_id)
    
    # Get dealership slug for driver
    from app.models.dealership import Dealership
    dealership = await db.get(Dealership, dealership_id)
    if not dealership:
        raise HTTPException(status_code=404, detail="Dealership not found")
    
    slug = dealership.slug or str(dealership_id)[:8]

    # Update status to connecting
    await service.update_profile_status(
        profile.id,
        AutoWhatsAppProfileStatus.CONNECTING,
    )

    # Run Selenium operations in a thread pool to avoid blocking the event loop
    def setup_browser_sync() -> Tuple[str, Optional[str], Optional[str]]:
        """
        Synchronous browser setup - runs in thread pool.
        Returns: (status, qr_code_base64, error_message)
        """
        try:
            driver = driver_manager.get_driver(slug, headless=True)
            logger.info(f"Starting browser for profile setup. Profile path: {driver.profile_path}")
            
            if not driver.start(timeout=30):
                error_msg = (
                    "Failed to start Chrome browser. Common issues: "
                    "1) Chrome not installed (run: google-chrome --version) "
                    "2) Zombie Chrome processes (run: pkill -9 chrome) "
                    "3) Corrupted profile (run: rm -rf {profile_path}) "
                    "4) Missing dependencies (run: apt-get install libnss3 libatk1.0-0)"
                ).format(profile_path=driver.profile_path)
                logger.error(f"Browser failed to start for {slug}. {error_msg}")
                driver_manager.stop_driver(slug)
                return "error", None, "Failed to start browser - check server logs"
            
            # Check if already logged in
            if driver.is_logged_in(timeout=5):
                driver_manager.stop_driver(slug)
                return "connected", None, None
            
            # Get QR code
            qr_code = driver.get_qr_code_base64(timeout=15)
            if not qr_code:
                driver_manager.stop_driver(slug)
                return "error", None, "Could not capture QR code"
            
            # Keep browser open for QR polling
            return "qr_ready", qr_code, None
            
        except Exception as e:
            logger.exception(f"Error in browser setup: {e}")
            driver_manager.stop_driver(slug)
            return "error", None, str(e)

    try:
        # Run browser setup in thread pool (non-blocking)
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as executor:
            status_result, qr_code, error_msg = await loop.run_in_executor(
                executor, setup_browser_sync
            )
        
        if status_result == "error":
            await service.update_profile_status(
                profile.id,
                AutoWhatsAppProfileStatus.ERROR,
                error_message=error_msg,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error_msg or "Setup failed",
            )
        
        if status_result == "connected":
            await service.update_profile_status(
                profile.id,
                AutoWhatsAppProfileStatus.CONNECTED,
            )
            return AutoWhatsAppProfileSetupResponse(
                profile_id=profile.id,
                status="connected",
                message="Already logged in to WhatsApp",
                qr_code_base64=None,
            )
        
        # qr_ready
        await service.update_profile_status(
            profile.id,
            AutoWhatsAppProfileStatus.QR_READY,
        )
        return AutoWhatsAppProfileSetupResponse(
            profile_id=profile.id,
            status="qr_ready",
            message="Scan the QR code with your WhatsApp mobile app",
            qr_code_base64=qr_code,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error during profile setup: {e}")
        await service.update_profile_status(
            profile.id,
            AutoWhatsAppProfileStatus.ERROR,
            error_message=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Setup failed: {str(e)}",
        )


@router.get("/profile/qr", response_model=AutoWhatsAppProfileSetupResponse)
async def get_qr_code(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the current QR code (refresh) or check if user has logged in.
    Call this endpoint periodically after setup to check login status.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    profile = await service.get_profile_for_dealership(dealership_id)

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found. Use POST /profile/setup first.",
        )

    # Get dealership slug
    from app.models.dealership import Dealership
    dealership = await db.get(Dealership, dealership_id)
    slug = dealership.slug or str(dealership_id)[:8] if dealership else str(dealership_id)[:8]
    profile_id = profile.id

    def check_qr_status_sync() -> Tuple[str, Optional[str]]:
        """
        Check QR/login status synchronously - runs in thread pool.
        Returns: (status, qr_code_base64)
        """
        driver = driver_manager.get_driver(slug, headless=True)
        
        # Check if driver is running
        if not driver._is_initialized:
            return "disconnected", None
        
        # Check if logged in
        if driver.is_logged_in(timeout=3):
            driver_manager.stop_driver(slug)
            return "connected", None
        
        # Not logged in, get fresh QR code
        qr_code = driver.get_qr_code_base64(timeout=10)
        return "qr_ready" if qr_code else "waiting", qr_code

    # Run in thread pool (non-blocking)
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as executor:
        status_result, qr_code = await loop.run_in_executor(executor, check_qr_status_sync)

    if status_result == "disconnected":
        return AutoWhatsAppProfileSetupResponse(
            profile_id=profile_id,
            status="disconnected",
            message="Browser not running. Use POST /profile/setup to restart.",
            qr_code_base64=None,
        )

    if status_result == "connected":
        await service.update_profile_status(
            profile_id,
            AutoWhatsAppProfileStatus.CONNECTED,
        )
        return AutoWhatsAppProfileSetupResponse(
            profile_id=profile_id,
            status="connected",
            message="Successfully logged in to WhatsApp!",
            qr_code_base64=None,
        )

    # qr_ready or waiting
    return AutoWhatsAppProfileSetupResponse(
        profile_id=profile_id,
        status=status_result,
        message="Scan the QR code with your WhatsApp mobile app" if qr_code else "Waiting for QR code...",
        qr_code_base64=qr_code,
    )


@router.post("/profile/verify", response_model=AutoWhatsAppProfileStatusResponse)
async def verify_profile(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Verify that the profile is logged in after QR scan.
    Updates the profile status accordingly.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    profile = await service.get_profile_for_dealership(dealership_id)

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found",
        )

    # Get dealership slug
    from app.models.dealership import Dealership
    dealership = await db.get(Dealership, dealership_id)
    slug = dealership.slug or str(dealership_id)[:8] if dealership else str(dealership_id)[:8]
    profile_id = profile.id
    phone_number = profile.phone_number

    def verify_login_sync() -> Tuple[bool, Optional[bool]]:
        """
        Verify login status synchronously - runs in thread pool.
        Returns: (is_initialized, is_connected)
        """
        driver = driver_manager.get_driver(slug, headless=True)
        
        if not driver._is_initialized:
            return False, None
        
        is_connected = driver.is_logged_in(timeout=5)
        if is_connected:
            driver_manager.stop_driver(slug)
        return True, is_connected

    # Run in thread pool (non-blocking)
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as executor:
        is_initialized, is_connected = await loop.run_in_executor(executor, verify_login_sync)

    if not is_initialized:
        return AutoWhatsAppProfileStatusResponse(
            profile_id=profile_id,
            status="disconnected",
            phone_number=phone_number,
            is_connected=False,
            error_message="Browser not running",
        )

    if is_connected:
        await service.update_profile_status(
            profile_id,
            AutoWhatsAppProfileStatus.CONNECTED,
        )
    else:
        await service.update_profile_status(
            profile_id,
            AutoWhatsAppProfileStatus.DISCONNECTED,
        )

    return AutoWhatsAppProfileStatusResponse(
        profile_id=profile_id,
        status="connected" if is_connected else "disconnected",
        phone_number=phone_number,
        is_connected=is_connected,
        error_message=None if is_connected else "Not logged in",
    )


@router.delete("/profile")
async def delete_profile(
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete the WhatsApp profile and stop the browser.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    deleted = await service.delete_profile(dealership_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found",
        )

    return {"message": "Profile deleted successfully"}


# ==================== LEAD PREVIEW ENDPOINTS ====================

@router.post("/leads/preview", response_model=LeadPreviewResponse)
async def preview_leads(
    filters: LeadPreviewFilter,
    limit: int = Query(500, ge=1, le=500),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Preview leads matching the given filters.
    Returns leads with their phone numbers for selection before bulk send.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    return await service.preview_leads(dealership_id, filters, limit=limit)


# ==================== JOB ENDPOINTS ====================

@router.post("/jobs", response_model=AutoWhatsAppJobResponse)
async def create_job(
    request: AutoWhatsAppJobCreate,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new bulk WhatsApp send job.
    The job will be queued for processing by the background worker.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)

    try:
        job = await service.create_job(
            dealership_id=dealership_id,
            user_id=current_user.id,
            name=request.name,
            message_text=request.message_text,
            lead_ids=request.lead_ids,
            filter_criteria=request.filter_criteria,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return AutoWhatsAppJobResponse(
        id=job.id,
        dealership_id=job.dealership_id,
        profile_id=job.profile_id,
        created_by=job.created_by,
        created_by_name=current_user.full_name,
        name=job.name,
        message_text=job.message_text,
        status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
        total_leads=job.total_leads,
        sent_count=job.sent_count,
        failed_count=job.failed_count,
        remaining_count=job.remaining_count,
        progress_percent=job.progress_percent,
        current_index=job.current_index,
        error_count=len(job.errors),
        started_at=job.started_at,
        paused_at=job.paused_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get("/jobs", response_model=AutoWhatsAppJobListResponse)
async def list_jobs(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List bulk send jobs for the current dealership.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    # Parse status filter
    job_status = None
    if status_filter:
        try:
            job_status = AutoWhatsAppJobStatus(status_filter)
        except ValueError:
            pass

    service = AutoWhatsAppService(db)
    jobs, total = await service.list_jobs(
        dealership_id,
        status=job_status,
        page=page,
        page_size=page_size,
    )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    job_responses = [
        AutoWhatsAppJobResponse(
            id=job.id,
            dealership_id=job.dealership_id,
            profile_id=job.profile_id,
            created_by=job.created_by,
            created_by_name=job.created_by_user.full_name if job.created_by_user else None,
            name=job.name,
            message_text=job.message_text,
            status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
            total_leads=job.total_leads,
            sent_count=job.sent_count,
            failed_count=job.failed_count,
            remaining_count=job.remaining_count,
            progress_percent=job.progress_percent,
            current_index=job.current_index,
            error_count=len(job.errors),
            started_at=job.started_at,
            paused_at=job.paused_at,
            completed_at=job.completed_at,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )
        for job in jobs
    ]

    return AutoWhatsAppJobListResponse(
        jobs=job_responses,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/jobs/{job_id}", response_model=AutoWhatsAppJobDetailResponse)
async def get_job(
    job_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific job.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    job = await service.get_job(job_id)

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )

    if job.dealership_id != dealership_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    return AutoWhatsAppJobDetailResponse(
        id=job.id,
        dealership_id=job.dealership_id,
        profile_id=job.profile_id,
        created_by=job.created_by,
        created_by_name=job.created_by_user.full_name if job.created_by_user else None,
        name=job.name,
        message_text=job.message_text,
        status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
        total_leads=job.total_leads,
        sent_count=job.sent_count,
        failed_count=job.failed_count,
        remaining_count=job.remaining_count,
        progress_percent=job.progress_percent,
        current_index=job.current_index,
        error_count=len(job.errors),
        started_at=job.started_at,
        paused_at=job.paused_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
        lead_ids=job.lead_ids,
        filter_criteria=job.filter_criteria,
        errors=job.errors,
        logs=[
            AutoWhatsAppJobLogResponse(
                id=log.id,
                job_id=log.job_id,
                action=log.action.value if isinstance(log.action, AutoWhatsAppLogAction) else log.action,
                message=log.message,
                meta_data=log.meta_data,
                created_at=log.created_at,
            )
            for log in (job.logs or [])
        ],
    )


@router.post("/jobs/{job_id}/pause", response_model=AutoWhatsAppJobActionResponse)
async def pause_job(
    job_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Pause a running job.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    job = await service.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.dealership_id != dealership_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        job = await service.pause_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AutoWhatsAppJobActionResponse(
        job_id=job.id,
        status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
        message="Job paused successfully",
        sent_count=job.sent_count,
        failed_count=job.failed_count,
    )


@router.post("/jobs/{job_id}/resume", response_model=AutoWhatsAppJobActionResponse)
async def resume_job(
    job_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resume a paused job.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    job = await service.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.dealership_id != dealership_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        job = await service.resume_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AutoWhatsAppJobActionResponse(
        job_id=job.id,
        status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
        message="Job resumed successfully",
        sent_count=job.sent_count,
        failed_count=job.failed_count,
    )


@router.post("/jobs/{job_id}/cancel", response_model=AutoWhatsAppJobActionResponse)
async def cancel_job(
    job_id: UUID,
    current_user: User = Depends(deps.get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Cancel a pending, running, or paused job.
    """
    _require_admin(current_user)
    dealership_id = _require_dealership(current_user)

    service = AutoWhatsAppService(db)
    job = await service.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.dealership_id != dealership_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        job = await service.cancel_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AutoWhatsAppJobActionResponse(
        job_id=job.id,
        status=job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
        message="Job cancelled successfully",
        sent_count=job.sent_count,
        failed_count=job.failed_count,
    )


# ==================== WEBSOCKET ENDPOINT ====================

# Store for active WebSocket connections per job
_job_websockets: dict[str, list[WebSocket]] = {}


async def broadcast_to_job(job_id: str, message: dict):
    """Broadcast a message to all WebSocket clients watching a job"""
    if job_id in _job_websockets:
        dead_connections = []
        for ws in _job_websockets[job_id]:
            try:
                await ws.send_json(message)
            except Exception:
                dead_connections.append(ws)
        
        # Remove dead connections
        for ws in dead_connections:
            _job_websockets[job_id].remove(ws)


@router.websocket("/jobs/{job_id}/ws")
async def job_progress_websocket(
    websocket: WebSocket,
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket endpoint for real-time job progress updates.
    Clients receive progress updates, errors, and state changes.
    """
    await websocket.accept()
    
    job_id_str = str(job_id)
    
    # Add to connections
    if job_id_str not in _job_websockets:
        _job_websockets[job_id_str] = []
    _job_websockets[job_id_str].append(websocket)
    
    logger.info(f"WebSocket connected for job {job_id}")

    try:
        # Send initial status
        service = AutoWhatsAppService(db)
        job = await service.get_job(job_id)
        if job:
            await websocket.send_json({
                "type": "status",
                "job_id": job_id_str,
                "status": job.status.value if isinstance(job.status, AutoWhatsAppJobStatus) else job.status,
                "sent": job.sent_count,
                "failed": job.failed_count,
                "total": job.total_leads,
                "percent": job.progress_percent,
            })

        # Keep connection alive and listen for client messages
        while True:
            try:
                # Wait for messages (heartbeat/ping)
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=30.0
                )
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send heartbeat
                await websocket.send_json({"type": "heartbeat"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for job {job_id}")
    except Exception as e:
        logger.warning(f"WebSocket error for job {job_id}: {e}")
    finally:
        # Remove from connections
        if job_id_str in _job_websockets and websocket in _job_websockets[job_id_str]:
            _job_websockets[job_id_str].remove(websocket)
            if not _job_websockets[job_id_str]:
                del _job_websockets[job_id_str]
