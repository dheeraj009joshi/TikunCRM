"""
API v1 Router - combines all route modules
"""
from fastapi import APIRouter

from app.api.v1.endpoints import auth, users, dealerships, leads, activities, follow_ups, schedules, integrations, communications, auth_oauth, dashboard, emails, dealership_email_config, notifications, user_email_config, google_sheets
from app.api.v1.endpoints.webhooks import sendgrid as sendgrid_webhook

api_router = APIRouter()

# Include all endpoint routers
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(auth_oauth.router, prefix="/auth/oauth", tags=["OAuth"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(dealerships.router, prefix="/dealerships", tags=["Dealerships"])
api_router.include_router(leads.router, prefix="/leads", tags=["Leads"])
api_router.include_router(activities.router, prefix="/activities", tags=["Activities"])
api_router.include_router(follow_ups.router, prefix="/follow-ups", tags=["Follow-ups"])
api_router.include_router(schedules.router, prefix="/schedules", tags=["Schedules"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(integrations.router, prefix="/integrations", tags=["Integrations"])
api_router.include_router(communications.router, prefix="/communications", tags=["Communications"])
api_router.include_router(emails.router, prefix="/emails", tags=["Emails"])
api_router.include_router(dealership_email_config.router, prefix="/dealership-email", tags=["Dealership Email"])
api_router.include_router(user_email_config.router, prefix="/user-email", tags=["User Email Config"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(google_sheets.router, prefix="/google-sheets", tags=["Google Sheets Sync"])

# Webhook endpoints (no auth required - secured by signatures)
api_router.include_router(sendgrid_webhook.router, prefix="/webhooks/sendgrid", tags=["Webhooks"])
