"""
TikunCRM - FastAPI Main Application
"""
import asyncio
import logging
import os
import fcntl
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import settings
from app.api.v1.router import api_router
from app.db.database import async_session_maker
from app.services.lead_stage_service import LeadStageService
from app.tasks.scheduler import setup_scheduler, start_scheduler, stop_scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Log slow requests and expose timing in response headers."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
        if duration_ms >= 1000 and request.url.path.startswith("/api/"):
            logger.warning(
                "Slow request: %s %s took %.0fms",
                request.method,
                request.url.path,
                duration_ms,
            )
        return response


# Lock file for scheduler (only one worker should run scheduler)
SCHEDULER_LOCK_FILE = Path("/tmp/tikuncrm_scheduler.lock")
_scheduler_lock_fd = None
_is_scheduler_worker = False
_scheduler_failover_task: asyncio.Task | None = None
SCHEDULER_FAILOVER_INTERVAL_SECONDS = 30


def try_acquire_scheduler_lock() -> bool:
    """
    Try to acquire the scheduler lock.
    Only one worker should run the scheduler to avoid duplicate jobs.
    Returns True if this worker should run the scheduler.
    """
    global _scheduler_lock_fd, _is_scheduler_worker
    
    try:
        _scheduler_lock_fd = open(SCHEDULER_LOCK_FILE, 'w')
        fcntl.flock(_scheduler_lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _scheduler_lock_fd.write(str(os.getpid()))
        _scheduler_lock_fd.flush()
        _is_scheduler_worker = True
        return True
    except (IOError, OSError):
        # Another worker has the lock
        if _scheduler_lock_fd:
            _scheduler_lock_fd.close()
            _scheduler_lock_fd = None
        return False


def release_scheduler_lock():
    """Release the scheduler lock."""
    global _scheduler_lock_fd, _is_scheduler_worker
    
    if _scheduler_lock_fd:
        try:
            fcntl.flock(_scheduler_lock_fd.fileno(), fcntl.LOCK_UN)
            _scheduler_lock_fd.close()
        except:
            pass
        _scheduler_lock_fd = None
    _is_scheduler_worker = False


def _start_scheduler_as_leader() -> bool:
    """Acquire lock (if needed) and start APScheduler. Returns True if this process is leader."""
    global _is_scheduler_worker
    if _is_scheduler_worker:
        return True
    if not try_acquire_scheduler_lock():
        return False
    try:
        setup_scheduler()
        start_scheduler()
        logger.info("Background scheduler started (this worker is the scheduler leader)")
        return True
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
        release_scheduler_lock()
        return False


async def _scheduler_failover_loop():
    """
    If the scheduler-leader worker dies under multi-worker uvicorn, fcntl releases
    the lock but surviving workers never retry at startup. Poll and take over.
    """
    while True:
        try:
            await asyncio.sleep(SCHEDULER_FAILOVER_INTERVAL_SECONDS)
            if _is_scheduler_worker or not settings.run_background_scheduler:
                continue
            if _start_scheduler_as_leader():
                logger.warning(
                    "Scheduler failover: this worker took over as leader after lock became free"
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Scheduler failover loop error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    global _is_scheduler_worker, _scheduler_failover_task
    
    # Startup
    logger.info(f"Starting {settings.app_name} in {settings.app_env} mode")
    logger.info(
        "Background scheduler setting: enabled=%s (BACKGROUND_SCHEDULER_ENABLED)",
        settings.run_background_scheduler,
    )
    from app.services.email_notifier import email_notifier
    if email_notifier.is_configured:
        logger.info("System SMTP configured for notification emails")
    else:
        logger.warning(
            "System SMTP not configured (SMTP_USER/SMTP_PASSWORD) — notification emails will be skipped"
        )
    
    # Only one worker should run the scheduler (optional in development — see settings.run_background_scheduler)
    if not settings.run_background_scheduler:
        logger.info(
            "Background scheduler disabled (APP_ENV=development by default; set BACKGROUND_SCHEDULER_ENABLED=true to enable)"
        )
    elif _start_scheduler_as_leader():
        pass
    else:
        logger.info("Background scheduler skipped (another worker is the scheduler leader)")
        _scheduler_failover_task = asyncio.create_task(
            _scheduler_failover_loop(),
            name="scheduler-failover",
        )

    # Ensure default lead stages exist (e.g. manager_review for existing deployments)
    try:
        async with async_session_maker() as db:
            await LeadStageService.seed_default_stages(db)
            await db.commit()
    except Exception as e:
        logger.warning("Startup seed of default lead stages failed (non-fatal): %s", e)

    yield
    
    # Shutdown
    logger.info(f"Shutting down {settings.app_name}")

    if _scheduler_failover_task and not _scheduler_failover_task.done():
        _scheduler_failover_task.cancel()
        try:
            await _scheduler_failover_task
        except asyncio.CancelledError:
            pass
        _scheduler_failover_task = None
    
    # Stop background scheduler only if this worker is running it
    if _is_scheduler_worker:
        try:
            stop_scheduler()
            release_scheduler_lock()
            logger.info("Background scheduler stopped")
        except Exception as e:
            logger.error(f"Error stopping scheduler: {e}")


def create_application() -> FastAPI:
    """Create and configure the FastAPI application"""
    app = FastAPI(
        title=settings.app_name,
        description="Multi-Level Lead Management CRM API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    
    # Configure CORS - Use explicit origins when credentials=True (required by spec)
    _cors = settings.cors_origins_list or ["http://localhost:3000"]
    logger.info("CORS allow_origins (%d): %s", len(_cors), ", ".join(_cors))
    app.add_middleware(RequestTimingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include API router
    app.include_router(api_router, prefix="/api/v1")
    
    # AI Voice WebSocket endpoint (must be at root level for Twilio)
    @app.websocket("/ws/twilio-ai")
    async def twilio_ai_websocket(websocket):
        """
        WebSocket endpoint for Twilio Media Streams + Pipecat AI voice pipeline.
        """
        from fastapi import WebSocket
        from app.pipecat_runner import run_ai_conversation
        from app.db.database import get_engine_url_and_connect_args
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AsyncSessionType
        from sqlalchemy.orm import sessionmaker
        from uuid import UUID
        
        await websocket.accept()
        
        # Get query params
        query_params = websocket.query_params
        lead_id_str = query_params.get("lead_id")
        call_sid = query_params.get("call_sid", "")
        token = query_params.get("token", "")
        
        if not lead_id_str or not token:
            logger.error("Missing lead_id or token in WebSocket")
            await websocket.close(code=4000, reason="Missing parameters")
            return
        
        try:
            lead_id = UUID(lead_id_str)
        except ValueError:
            logger.error(f"Invalid lead_id format: {lead_id_str}")
            await websocket.close(code=4001, reason="Invalid lead ID")
            return
        
        # Create new DB session for this WebSocket connection
        url, connect_args = get_engine_url_and_connect_args()
        engine = create_async_engine(url, echo=False, pool_pre_ping=True, connect_args=connect_args)
        async_session = sessionmaker(engine, class_=AsyncSessionType, expire_on_commit=False)
        
        async with async_session() as session:
            try:
                result = await run_ai_conversation(
                    websocket,
                    lead_id,
                    call_sid,
                    token,
                    session
                )
                logger.info(f"AI conversation completed for lead {lead_id}: {result}")
            except Exception as e:
                logger.error(f"AI conversation error for lead {lead_id}: {e}", exc_info=True)
                try:
                    await websocket.close(code=1011, reason="Internal error")
                except:
                    pass
    
    # Health check endpoint
    @app.get("/health", tags=["Health"])
    async def health_check():
        from app.tasks.scheduler import scheduler as apscheduler
        scheduler_running = bool(
            _is_scheduler_worker and apscheduler is not None and apscheduler.running
        )
        return {
            "status": "healthy",
            "app": settings.app_name,
            "scheduler_enabled": settings.run_background_scheduler,
            "scheduler_leader": _is_scheduler_worker,
            "scheduler_running": scheduler_running,
        }
    
    return app


app = create_application()
