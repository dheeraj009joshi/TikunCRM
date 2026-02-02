"""
Models module initialization
"""
from app.models.dealership import Dealership
from app.models.user import User
from app.models.lead import Lead, LeadSource, LeadStatus
from app.models.activity import Activity, ActivityType
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.schedule import Schedule
from app.models.oauth_token import OAuthToken, OAuthProvider
from app.models.email_log import EmailLog, EmailDirection
from app.models.email_template import EmailTemplate, TemplateCategory
from app.models.dealership_email_config import DealershipEmailConfig
from app.models.notification import Notification, NotificationType

__all__ = [
    "Dealership",
    "User",
    "Lead",
    "LeadSource",
    "LeadStatus",
    "Activity",
    "ActivityType",
    "FollowUp",
    "FollowUpStatus",
    "Schedule",
    "OAuthToken",
    "OAuthProvider",
    "EmailLog",
    "EmailDirection",
    "EmailTemplate",
    "TemplateCategory",
    "DealershipEmailConfig",
    "Notification",
    "NotificationType",
]
