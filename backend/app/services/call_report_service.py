"""
Weekly call report email for managers.

The email is built from the same numbers as the Call Intelligence dashboard.
No AI writes any part of it, and it contains no customer details: only team
figures and representative names.

Sending on a schedule is off unless CALL_REVIEW_WEEKLY_REPORT_ENABLED is true.
A manager can always email the report to themselves from the dashboard.
"""
import asyncio
import logging
from datetime import timedelta
from html import escape
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select

from app.core.config import settings
from app.core.permissions import UserRole
from app.core.timezone import utc_now
from app.models.user import User
from app.services import call_insights_service as insights
from app.services.email_notifier import EmailNotifier

logger = logging.getLogger(__name__)

REPORT_DAYS = 7
MANAGER_ROLES = (UserRole.SUPER_ADMIN, UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER)


class ReportError(Exception):
    """The report could not be sent (safe to show to the user)."""


def _rate_text(rate: Dict[str, Any]) -> str:
    if not rate["denominator"]:
        return "no data yet"
    return f"{round(rate['rate'] * 100)}% ({rate['numerator']} of {rate['denominator']})"


def _score_text(score: Optional[float]) -> str:
    return "no data yet" if score is None else f"{score:g} out of 100"


def build_report(data: Dict[str, Any], days: int = REPORT_DAYS) -> Tuple[str, str, str]:
    """Returns (subject, plain text, html) for a dashboard payload."""
    s, prev = data["summary"], data["previous_summary"]
    link = f"{settings.frontend_url.rstrip('/')}/call-reviews/dashboard"
    subject = f"Call report: {s['calls_reviewed']} calls reviewed in the last {days} days"

    headline: List[Tuple[str, str, str]] = [
        ("Calls reviewed", str(s["calls_reviewed"]), str(prev["calls_reviewed"])),
        ("Average call quality (AI score)", _score_text(s["average_score"]), _score_text(prev["average_score"])),
        ("Appointment-setting rate (CRM)", _rate_text(s["appointment_rate"]), _rate_text(prev["appointment_rate"])),
        ("Show rate (CRM)", _rate_text(s["show_rate"]), _rate_text(prev["show_rate"])),
    ]
    reps = [
        (r["name"], str(r["calls_reviewed"]), _score_text(r["average_score"]), _rate_text(r["appointment_rate"]))
        for r in data["by_rep"][:15]
    ]
    footnote = (
        "Call quality is the AI's score of how each call was handled. Appointment and show figures come "
        "from CRM records, not from the AI. Appointment-setting rate counts reviewed calls linked to a lead; "
        "show rate counts appointments whose outcome is known."
    )

    if not s["calls_reviewed"]:
        text = f"No calls were reviewed in the last {days} days.\n\nOpen the dashboard: {link}\n"
        html = f"<p>No calls were reviewed in the last {days} days.</p><p><a href=\"{escape(link)}\">Open the dashboard</a></p>"
        return subject, text, html

    lines = [f"Call report for the last {days} days (previous {days} days in brackets)", ""]
    lines += [f"{label}: {now} ({before})" for label, now, before in headline]
    if data["focus"]:
        lines += ["", "What to focus on"]
        lines += [f"- {f['title']}. {f['detail']}" for f in data["focus"]]
    if reps:
        lines += ["", "By representative"]
        lines += [f"- {name}: {calls} calls, quality {score}, appointments {rate}" for name, calls, score, rate in reps]
    lines += ["", footnote, "", f"Open the dashboard: {link}"]
    text = "\n".join(lines) + "\n"

    cell = "padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;text-align:left;font-size:14px"
    rows = "".join(
        f"<tr><td style=\"{cell}\">{escape(label)}</td><td style=\"{cell}\"><strong>{escape(now)}</strong></td>"
        f"<td style=\"{cell};color:#6b7280\">{escape(before)}</td></tr>"
        for label, now, before in headline
    )
    focus = "".join(
        f"<li><strong>{escape(f['title'])}.</strong> {escape(f['detail'])}</li>" for f in data["focus"]
    )
    rep_rows = "".join(
        "<tr>" + "".join(f"<td style=\"{cell}\">{escape(v)}</td>" for v in row) + "</tr>" for row in reps
    )
    html = (
        "<div style=\"font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px\">"
        f"<h2 style=\"font-size:18px\">Call report for the last {days} days</h2>"
        f"<table style=\"border-collapse:collapse\"><tr><th style=\"{cell}\"></th><th style=\"{cell}\">Last {days} days</th>"
        f"<th style=\"{cell}\">Previous {days} days</th></tr>{rows}</table>"
        + (f"<h3 style=\"font-size:15px\">What to focus on</h3><ul style=\"font-size:14px\">{focus}</ul>" if focus else "")
        + (
            f"<h3 style=\"font-size:15px\">By representative</h3><table style=\"border-collapse:collapse\">"
            f"<tr><th style=\"{cell}\">Representative</th><th style=\"{cell}\">Calls</th>"
            f"<th style=\"{cell}\">Call quality</th><th style=\"{cell}\">Appointments set</th></tr>{rep_rows}</table>"
            if rep_rows else ""
        )
        + f"<p style=\"font-size:12px;color:#6b7280\">{escape(footnote)}</p>"
        f"<p><a href=\"{escape(link)}\">Open the dashboard</a></p></div>"
    )
    return subject, text, html


async def _deliver(to_email: str, subject: str, text: str, html: str) -> bool:
    # smtplib is blocking, so keep it off the event loop
    return await asyncio.to_thread(EmailNotifier._send_via_system, to_email, subject, text, html)


async def send_report_to(db, to_email: str, days: int = REPORT_DAYS) -> Dict[str, Any]:
    """Build the report for the last `days` days and email it to one address."""
    if not (settings.smtp_user and settings.smtp_password):
        raise ReportError("Email sending is not set up on this server (SMTP settings are missing).")
    if not to_email:
        raise ReportError("Your account has no email address.")
    end = utc_now()
    data = await insights.get_dashboard(db, end - timedelta(days=days), end)
    subject, text, html = build_report(data, days)
    if not await _deliver(to_email, subject, text, html):
        raise ReportError("The email could not be sent. Check the server's SMTP settings.")
    return {"sent_to": to_email, "calls_reviewed": data["summary"]["calls_reviewed"]}


async def send_weekly_reports() -> int:
    """Scheduler job: email last week's report to every active manager. Returns emails sent."""
    if not settings.call_review_weekly_report_enabled:
        return 0
    if not (settings.smtp_user and settings.smtp_password):
        logger.warning("Weekly call report skipped: SMTP is not configured")
        return 0
    from app.db.database import get_background_session_maker

    sent = 0
    try:
        async with get_background_session_maker()() as db:
            end = utc_now()
            data = await insights.get_dashboard(db, end - timedelta(days=REPORT_DAYS), end)
            if not data["summary"]["calls_reviewed"]:
                logger.info("Weekly call report skipped: no calls reviewed this week")
                return 0
            subject, text, html = build_report(data)
            result = await db.execute(
                select(User.email).where(User.role.in_(MANAGER_ROLES), User.is_active.is_(True))
            )
            recipients = sorted({(e or "").strip().lower() for (e,) in result.all()} - {""})
        for email in recipients:
            if await _deliver(email, subject, text, html):
                sent += 1
        logger.info("Weekly call report sent to %d of %d managers", sent, len(recipients))
    except Exception as e:
        logger.error("Weekly call report failed (%s)", type(e).__name__)
    return sent
