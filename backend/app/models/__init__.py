"""
Models module initialization
"""
from app.models.customer import Customer
from app.models.lead_stage import LeadStage
from app.models.dealership import Dealership
from app.models.user import User
from app.models.user_dealership_access import UserDealershipAccess
from app.models.lead import Lead, LeadSource
from app.models.activity import Activity, ActivityType
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.schedule import Schedule
from app.models.oauth_token import OAuthToken, OAuthProvider
from app.models.email_log import EmailLog, EmailDirection
from app.models.email_template import EmailTemplate, TemplateCategory
from app.models.dealership_email_config import DealershipEmailConfig
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.models.notification import Notification, NotificationType
from app.models.password_reset import PasswordResetToken
from app.models.appointment import Appointment, AppointmentType, AppointmentStatus
from app.models.fcm_token import FCMToken
from app.models.call_log import CallLog, CallDirection, CallStatus
from app.models.sms_log import SMSLog, MessageDirection, SMSStatus
from app.models.whatsapp_log import WhatsAppLog, WhatsAppDirection, WhatsAppStatus
from app.models.whatsapp_template import WhatsAppTemplate
from app.models.showroom_visit import ShowroomVisit, ShowroomOutcome
from app.models.stips_category import StipsCategory
from app.models.customer_stip_document import CustomerStipDocument
from app.models.lead_stip_document import LeadStipDocument
from app.models.lead_sync_source import LeadSyncSource, SyncSourceType
from app.models.campaign_mapping import CampaignMapping, MatchType
from app.models.lead_campaign import LeadCampaign
from app.models.whatsapp_message import WhatsAppMessage, WhatsAppBulkSend, WhatsAppConnection, WhatsAppChannel
from app.models.ai_outbound_call import AiOutboundCall
from app.models.auto_whatsapp import (
    AutoWhatsAppProfile,
    AutoWhatsAppJob,
    AutoWhatsAppJobLog,
    AutoWhatsAppProfileStatus,
    AutoWhatsAppJobStatus,
    AutoWhatsAppLogAction,
)
from app.models.eligibility import (
    EligibilityCriterion,
    EligibilityAssessment,
    EligibilityAssessmentItem,
    EligibilityInputType,
    EligibilityValueSource,
    EligibilityEntityType,
)
from app.models.guest import Guest, GuestStatus

__all__ = [
    "Customer",
    "LeadStage",
    "Dealership",
    "User",
    "UserDealershipAccess",
    "Lead",
    "LeadSource",
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
    "DealershipTwilioConfig",
    "Notification",
    "NotificationType",
    "PasswordResetToken",
    "Appointment",
    "AppointmentType",
    "AppointmentStatus",
    "FCMToken",
    "CallLog",
    "CallDirection",
    "CallStatus",
    "SMSLog",
    "MessageDirection",
    "SMSStatus",
    "WhatsAppLog",
    "WhatsAppDirection",
    "WhatsAppStatus",
    "WhatsAppTemplate",
    "ShowroomVisit",
    "ShowroomOutcome",
    "StipsCategory",
    "CustomerStipDocument",
    "LeadStipDocument",
    "LeadSyncSource",
    "SyncSourceType",
    "CampaignMapping",
    "MatchType",
    "LeadCampaign",
    "WhatsAppMessage",
    "WhatsAppBulkSend",
    "WhatsAppConnection",
    "WhatsAppChannel",
    "AiOutboundCall",
    "AutoWhatsAppProfile",
    "AutoWhatsAppJob",
    "AutoWhatsAppJobLog",
    "AutoWhatsAppProfileStatus",
    "AutoWhatsAppJobStatus",
    "AutoWhatsAppLogAction",
    "EligibilityCriterion",
    "EligibilityAssessment",
    "EligibilityAssessmentItem",
    "EligibilityInputType",
    "EligibilityValueSource",
    "EligibilityEntityType",
    "Guest",
    "GuestStatus",
]
