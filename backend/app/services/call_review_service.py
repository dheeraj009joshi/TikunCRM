"""
Call review pipeline: eligibility -> transcription -> AI evaluation.

Runs outside the request cycle (FastAPI background task after the recording
webhook, plus a scheduler sweep that retries failures and picks up anything a
restart interrupted), so it never blocks the CRM.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import utc_now
from app.models.ai_outbound_call import AiOutboundCall
from app.models.appointment import Appointment
from app.models.call_log import CallDirection, CallLog, CallStatus
from app.models.call_review import (
    CallEvaluation,
    CallReview,
    CallReviewStatus,
    CallRubric,
    RubricStatus,
)
from app.services import call_evaluation_service as evaluation
from app.services import call_transcription_service as transcription

logger = logging.getLogger(__name__)

# Too little speech to coach on (dead air, wrong number, immediate hang-up)
MIN_TRANSCRIPT_WORDS = 20
# A review left mid-flight longer than this is assumed interrupted (e.g. by a restart)
STALE_AFTER = timedelta(minutes=15)
# An appointment created for the lead within this window after the call counts as booked on it
APPOINTMENT_ATTRIBUTION_WINDOW = timedelta(hours=2)

_IN_FLIGHT = (CallReviewStatus.TRANSCRIBING.value, CallReviewStatus.EVALUATING.value)


# ------------------------------------------------------------ eligibility ----

def ineligibility_reason(call_log: CallLog, is_ai_call: bool = False) -> Optional[str]:
    """Why this call should not be reviewed, or None if it is eligible."""
    if is_ai_call:
        return "ai_outbound_call"
    if not call_log.recording_url:
        return "no_recording"
    if call_log.status != CallStatus.COMPLETED:
        return "not_completed"
    if (call_log.outcome or "") in {"voicemail", "missed"}:
        return "voicemail"
    if call_log.direction == CallDirection.INBOUND and not call_log.answered_by and not call_log.answered_at:
        return "not_answered"
    duration = call_log.recording_duration_seconds or call_log.duration_seconds or 0
    if duration < settings.call_review_min_duration_seconds:
        return "too_short"
    return None


async def _is_ai_outbound_call(db: AsyncSession, call_log: CallLog) -> bool:
    result = await db.execute(
        select(AiOutboundCall.id)
        .where(
            or_(
                AiOutboundCall.call_log_id == call_log.id,
                AiOutboundCall.twilio_call_sid == call_log.twilio_call_sid,
            )
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


# ----------------------------------------------------------------- rubric ----

async def get_active_rubric(db: AsyncSession) -> Optional[CallRubric]:
    result = await db.execute(
        select(CallRubric)
        .where(CallRubric.status == RubricStatus.ACTIVE.value)
        .order_by(CallRubric.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ------------------------------------------------------------ review rows ----

async def get_or_create_review(db: AsyncSession, call_log: CallLog) -> CallReview:
    result = await db.execute(select(CallReview).where(CallReview.call_log_id == call_log.id))
    review = result.scalar_one_or_none()
    if review:
        return review
    review = CallReview(
        call_log_id=call_log.id,
        lead_id=call_log.lead_id,
        customer_id=call_log.customer_id,
        # The person who actually took the call, falling back to who it was logged against
        rep_user_id=call_log.answered_by or call_log.user_id,
        dealership_id=call_log.dealership_id,
        call_started_at=call_log.started_at,
        status=CallReviewStatus.PENDING.value,
    )
    db.add(review)
    await db.flush()
    return review


async def _claim(db: AsyncSession, review_id: UUID, force: bool) -> bool:
    """
    Atomically move a review into TRANSCRIBING so two workers never process the
    same call. Returns False if someone else has it or it is already finished.
    """
    claimable = [
        CallReview.status.in_([CallReviewStatus.PENDING.value, CallReviewStatus.FAILED.value]),
        and_(CallReview.status.in_(_IN_FLIGHT), CallReview.updated_at < utc_now() - STALE_AFTER),
    ]
    if force:
        claimable.append(
            CallReview.status.in_([CallReviewStatus.COMPLETED.value, CallReviewStatus.SKIPPED.value])
        )
    result = await db.execute(
        update(CallReview)
        .where(CallReview.id == review_id, or_(*claimable))
        .values(
            status=CallReviewStatus.TRANSCRIBING.value,
            attempts=CallReview.attempts + 1,
            error=None,
            skip_reason=None,
            updated_at=utc_now(),
        )
        .returning(CallReview.id)
    )
    claimed = result.scalar_one_or_none() is not None
    await db.commit()
    return claimed


async def _finish(db: AsyncSession, review_id: UUID, **values: Any) -> None:
    await db.execute(
        update(CallReview).where(CallReview.id == review_id).values(updated_at=utc_now(), **values)
    )
    await db.commit()


async def store_evaluation(
    db: AsyncSession, review_id: UUID, rubric: CallRubric, evaluated: Dict[str, Any]
) -> CallEvaluation:
    """Save an evaluation as the current one; earlier ones are kept for audit."""
    await db.execute(
        update(CallEvaluation)
        .where(CallEvaluation.review_id == review_id, CallEvaluation.is_current.is_(True))
        .values(is_current=False)
    )
    row = CallEvaluation(
        review_id=review_id,
        is_current=True,
        rubric_id=rubric.id,
        rubric_version=rubric.version,
        llm_model=evaluated["llm_model"],
        prompt_version=evaluated["prompt_version"],
        overall_score=evaluated["overall_score"],
        category_scores=evaluated["category_scores"],
        result=evaluated["result"],
        ai_call_outcome=evaluated["ai_call_outcome"],
    )
    db.add(row)
    await db.flush()
    return row


# --------------------------------------------------------------- pipeline ----

async def process_review(db: AsyncSession, review_id: UUID, *, force: bool = False) -> str:
    """
    Run transcription + evaluation for one review. Returns the final status.
    `force=True` re-runs a finished review (manager pressed "re-run"); an
    existing transcript is reused so only the evaluation is repeated.
    """
    if not await _claim(db, review_id, force):
        return "not_claimed"

    review = (await db.execute(select(CallReview).where(CallReview.id == review_id))).scalar_one()
    call_log = (await db.execute(select(CallLog).where(CallLog.id == review.call_log_id))).scalar_one_or_none()
    if call_log is None:
        await _finish(db, review_id, status=CallReviewStatus.FAILED.value, error="Call no longer exists")
        return CallReviewStatus.FAILED.value

    try:
        reason = ineligibility_reason(call_log, await _is_ai_outbound_call(db, call_log))
        if reason:
            await _finish(db, review_id, status=CallReviewStatus.SKIPPED.value, skip_reason=reason)
            return CallReviewStatus.SKIPPED.value

        transcript: Optional[List[Dict[str, Any]]] = review.transcript
        if not transcript:
            transcript = await transcription.transcribe_call(db, call_log)
            await _finish(
                db,
                review_id,
                transcript=transcript,
                transcript_provider=transcription.PROVIDER,
                transcript_model=transcription.get_transcription_model(),
                transcribed_at=utc_now(),
                status=CallReviewStatus.EVALUATING.value,
            )
        else:
            await _finish(db, review_id, status=CallReviewStatus.EVALUATING.value)

        if transcription.transcript_word_count(transcript) < MIN_TRANSCRIPT_WORDS:
            await _finish(db, review_id, status=CallReviewStatus.SKIPPED.value, skip_reason="too_little_speech")
            return CallReviewStatus.SKIPPED.value

        rubric = await get_active_rubric(db)
        if rubric is None:
            raise evaluation.EvaluationError("No active scoring rubric. Publish one in Settings → Call Scoring.")

        evaluated = await evaluation.evaluate_transcript(
            transcript,
            rubric.criteria,
            rubric.guidance,
            call_log.direction.value if call_log.direction else None,
        )
        await store_evaluation(db, review_id, rubric, evaluated)
        await _finish(db, review_id, status=CallReviewStatus.COMPLETED.value)
        logger.info("Call review %s completed (rubric v%s)", review_id, rubric.version)
        return CallReviewStatus.COMPLETED.value

    except (transcription.TranscriptionError, evaluation.EvaluationError) as e:
        await db.rollback()
        await _finish(db, review_id, status=CallReviewStatus.FAILED.value, error=str(e)[:500])
        logger.warning("Call review %s failed: %s", review_id, e)
        return CallReviewStatus.FAILED.value
    except Exception as e:
        # Unknown errors may carry call content in their message: store only the type.
        await db.rollback()
        await _finish(
            db, review_id, status=CallReviewStatus.FAILED.value, error=f"Unexpected error ({type(e).__name__})"
        )
        logger.exception("Call review %s failed unexpectedly", review_id)
        return CallReviewStatus.FAILED.value


async def process_call_review_background(call_log_id: UUID, *, force: bool = False, manual: bool = False) -> None:
    """
    Entry point for background execution with its own DB session.
    Automatic runs (manual=False) only happen when CALL_REVIEW_AUTO_ENABLED is on.
    """
    if not manual and not settings.call_review_auto_enabled:
        return
    from app.db.database import async_session_maker

    try:
        async with async_session_maker() as db:
            call_log = (await db.execute(select(CallLog).where(CallLog.id == call_log_id))).scalar_one_or_none()
            if call_log is None:
                return
            if not manual and ineligibility_reason(call_log, await _is_ai_outbound_call(db, call_log)):
                # Don't create rows for voicemails, missed calls, etc.
                return
            review = await get_or_create_review(db, call_log)
            await db.commit()
            await process_review(db, review.id, force=force)
    except Exception:
        logger.exception("Background call review failed for call_log %s", call_log_id)


async def run_call_review_sweep(batch_size: int = 10) -> None:
    """
    Scheduler job. Picks up recorded calls that were never reviewed, retries
    failures (up to CALL_REVIEW_MAX_ATTEMPTS) and resumes interrupted reviews.
    """
    if not settings.call_review_auto_enabled:
        return
    from app.db.database import get_background_session_maker

    now = utc_now()
    try:
        async with get_background_session_maker()() as db:
            # 1. Recent completed calls with a recording and no review yet
            unreviewed = await db.execute(
                select(CallLog.id)
                .outerjoin(CallReview, CallReview.call_log_id == CallLog.id)
                .where(
                    CallReview.id.is_(None),
                    CallLog.status == CallStatus.COMPLETED,
                    CallLog.recording_url.isnot(None),
                    # Give the recording upload a few minutes to settle first
                    CallLog.updated_at < now - timedelta(minutes=5),
                    CallLog.started_at > now - timedelta(days=2),
                )
                .order_by(CallLog.started_at.desc())
                .limit(batch_size)
            )
            call_ids = [row[0] for row in unreviewed.all()]

            # 2. Failed (with attempts left), never-started, or interrupted reviews
            retryable = await db.execute(
                select(CallReview.id)
                .where(
                    CallReview.attempts < settings.call_review_max_attempts,
                    or_(
                        CallReview.status == CallReviewStatus.FAILED.value,
                        and_(
                            CallReview.status == CallReviewStatus.PENDING.value,
                            CallReview.updated_at < now - timedelta(minutes=5),
                        ),
                        and_(CallReview.status.in_(_IN_FLIGHT), CallReview.updated_at < now - STALE_AFTER),
                    ),
                )
                .order_by(CallReview.updated_at.asc())
                .limit(batch_size)
            )
            review_ids = [row[0] for row in retryable.all()]

        for call_id in call_ids:
            await process_call_review_background(call_id)

        if review_ids:
            async with get_background_session_maker()() as db:
                for review_id in review_ids:
                    await process_review(db, review_id)
    except Exception:
        logger.exception("Call review sweep failed")


# ----------------------------------------------------------- CRM outcome ----

async def get_crm_outcome(db: AsyncSession, call_log: CallLog) -> Dict[str, Any]:
    """
    What ACTUALLY happened in the CRM around this call — independent of the AI's
    opinion of call quality. An appointment counts as booked on this call when it
    was created for the same lead between the call starting and shortly after it ended.
    """
    outcome: Dict[str, Any] = {
        "appointment_booked": False,
        "appointment": None,
        "rep_logged_outcome": call_log.outcome,
    }
    if not call_log.lead_id or not call_log.started_at:
        outcome["appointment_booked"] = None  # unknown: call isn't linked to a lead
        return outcome

    window_end = (call_log.ended_at or call_log.started_at) + APPOINTMENT_ATTRIBUTION_WINDOW
    result = await db.execute(
        select(Appointment)
        .where(
            Appointment.lead_id == call_log.lead_id,
            Appointment.created_at >= call_log.started_at,
            Appointment.created_at <= window_end,
        )
        .order_by(Appointment.created_at.asc())
        .limit(1)
    )
    appt = result.scalar_one_or_none()
    if appt:
        outcome["appointment_booked"] = True
        outcome["appointment"] = {
            "id": str(appt.id),
            "scheduled_at": appt.scheduled_at.isoformat() if isinstance(appt.scheduled_at, datetime) else None,
            "status": appt.status.value if hasattr(appt.status, "value") else str(appt.status),
        }
    return outcome
