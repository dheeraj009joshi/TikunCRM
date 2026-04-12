"""
Normalize notification title/message for API responses.

Legacy rows in the DB may still store older copy (e.g. multi-campaign / duplicate-lead
notifications). We rewrite display text here so the app always shows current wording
without requiring a data migration.
"""
import re
from typing import Optional, Tuple

from app.models.notification import Notification, NotificationType
from app.schemas.notification import NotificationResponse

# Old sheet-sync duplicate-lead body: "{name} also appeared in campaign: {campaign}"
_RE_LEGACY_MULTI_CAMPAIGN = re.compile(
    r"^(.+?)\s+also appeared in campaign:\s*(.+)$",
    re.DOTALL | re.IGNORECASE,
)

_DUPLICATE_TITLE_PREFIX = "duplicate lead:"

_MSG_DUPLICATE = (
    'A new lead came in from "{campaign}"'
    "(duplicate). Open the lead to see campaign history before contacting them again."
)


def normalize_lead_multi_campaign_text(
    notification_type: NotificationType,
    title: str,
    message: Optional[str],
) -> Tuple[str, Optional[str]]:
    if notification_type != NotificationType.LEAD_MULTI_CAMPAIGN:
        return title, message
    if title.strip().lower().startswith(_DUPLICATE_TITLE_PREFIX):
        return title, message

    if message:
        m = _RE_LEGACY_MULTI_CAMPAIGN.match(message.strip())
        if m:
            lead_name = m.group(1).strip()
            campaign = m.group(2).strip()
            return (
                f"Duplicate lead: {lead_name}",
                _MSG_DUPLICATE.format(campaign=campaign),
            )

    # Mid-era title: "{name}: same contact, another campaign"
    lower_t = title.lower()
    marker = ": same contact, another campaign"
    if marker in lower_t:
        idx = lower_t.find(marker)
        lead_name = title[:idx].strip()
        if lead_name and message:
            m2 = re.search(r'"([^"]+)"', message)
            if m2:
                campaign = m2.group(1).strip()
                return (
                    f"Duplicate lead: {lead_name}",
                    _MSG_DUPLICATE.format(campaign=campaign),
                )

    return title, message


def notification_to_response(notification: Notification) -> NotificationResponse:
    """Build API response with display normalization for legacy copy."""
    title, message = normalize_lead_multi_campaign_text(
        notification.type,
        notification.title,
        notification.message,
    )
    return NotificationResponse(
        id=notification.id,
        user_id=notification.user_id,
        type=notification.type,
        title=title,
        message=message,
        link=notification.link,
        related_id=notification.related_id,
        related_type=notification.related_type,
        is_read=notification.is_read,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )
