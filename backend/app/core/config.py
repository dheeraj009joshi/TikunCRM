"""
Application Configuration using Pydantic Settings
"""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )
    
    # Application
    app_name: str = "TikunCRM"
    app_env: str = "development"
    debug: bool = True
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/leedscrm"
    
    # JWT Settings
    secret_key: str = "your-super-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200  # 30 days (1 month)
    refresh_token_expire_days: int = 60  # 60 days (2 months) to allow refresh
    
    # CORS
    cors_origins: str = "http://localhost:3000"
    
    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/google/callback"
    
    # Meta OAuth
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/meta/callback"
    
    # Frontend URL (for email links, password reset, etc.)
    frontend_url: str = "https://tikuncrm.com"
    # Backend public URL (for Twilio webhooks, etc.). Defaults to localhost in dev.
    backend_url: str = "http://localhost:8000"
    
    # Email Provider Settings
    # Options: "smtp", "sendgrid", "mailgun", "aws_ses"
    email_provider: str = "smtp"
    
    # SMTP Settings (fallback/default)
    smtp_host: str = "smtp.hostinger.com"
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    smtp_use_ssl: bool = True  # For port 465
    
    # Default sender (used when sending on behalf of users)
    email_from_address: str = ""  # e.g., noreply@yourcompany.com
    email_from_name: str = "TikunCRM"
    
    # SendGrid (Recommended for production)
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = ""  # Verified sender email
    sendgrid_from_name: str = "TikunCRM"
    sendgrid_inbound_domain: str = ""  # e.g., inbound.yourcrm.com
    sendgrid_webhook_key: str = ""  # For webhook signature verification
    
    # Mailgun
    mailgun_api_key: str = ""
    mailgun_domain: str = ""
    
    # AWS SES
    aws_ses_access_key: str = ""
    aws_ses_secret_key: str = ""
    aws_ses_region: str = "us-east-1"
    
    @property
    def is_sendgrid_configured(self) -> bool:
        """Check if SendGrid is properly configured"""
        return bool(self.sendgrid_api_key and self.sendgrid_from_email)
    
    # Twilio SMS Settings
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""  # The Twilio phone number to send from (e.g., +1234567890)
    sms_notifications_enabled: bool = False
    
    # Twilio WhatsApp (same account; number is often different from SMS, e.g. sandbox)
    twilio_whatsapp_number: str = ""  # e.g. +14155238886 for sandbox
    whatsapp_enabled: bool = False

    # Twilio Voice Settings (WebRTC Softphone)
    twilio_twiml_app_sid: str = ""  # TwiML Application SID for voice
    twilio_api_key_sid: str = ""     # API Key SID for Access Tokens
    twilio_api_key_secret: str = ""  # API Key Secret
    voice_enabled: bool = False
    
    # Azure Blob Storage (for call recordings)
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "call-recordings"
    # Azure Blob Storage - Stips documents (lead/customer documents)
    azure_storage_container_stips: str = "lead-stips"
    
    @property
    def is_twilio_configured(self) -> bool:
        """Check if Twilio SMS is properly configured"""
        return bool(
            self.twilio_account_sid and 
            self.twilio_auth_token and 
            self.twilio_phone_number and
            self.sms_notifications_enabled
        )
    
    @property
    def is_whatsapp_configured(self) -> bool:
        """Check if Twilio WhatsApp is configured"""
        return bool(
            self.twilio_account_sid
            and self.twilio_auth_token
            and self.twilio_whatsapp_number
            and self.whatsapp_enabled
        )

    @property
    def is_twilio_voice_configured(self) -> bool:
        """Check if Twilio Voice is properly configured for WebRTC"""
        return bool(
            self.twilio_account_sid and 
            self.twilio_auth_token and 
            self.twilio_phone_number and
            self.twilio_twiml_app_sid and
            self.twilio_api_key_sid and
            self.twilio_api_key_secret and
            self.voice_enabled
        )
    
    @property
    def is_azure_storage_configured(self) -> bool:
        """Check if Azure Blob Storage is configured"""
        return bool(self.azure_storage_connection_string)

    @property
    def is_azure_stips_configured(self) -> bool:
        """Check if Azure Blob Storage is configured for Stips documents"""
        return bool(self.azure_storage_connection_string and self.azure_storage_container_stips)

    # Firebase Cloud Messaging (FCM) HTTP V1 - for push notifications
    # Path to the service account JSON file from Firebase Console (Project Settings > Service accounts)
    fcm_service_account_path: str = ""  # e.g. /path/to/firebase-service-account.json
    # Or set GOOGLE_APPLICATION_CREDENTIALS env var to the same path
    fcm_project_id: str = ""  # Optional: Firebase project ID (can be read from JSON if not set)

    @property
    def is_fcm_configured(self) -> bool:
        """Check if FCM is configured (service account path or GOOGLE_APPLICATION_CREDENTIALS)"""
        import os
        path = self.fcm_service_account_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        return bool(path and os.path.isfile(path))

    @property
    def is_push_configured(self) -> bool:
        """Check if push notifications are configured (FCM only)"""
        return self.is_fcm_configured


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


settings = get_settings()
