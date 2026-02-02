"""
User Email Configuration Endpoints
Each user manages their own Hostinger email credentials (used for both sending and receiving)
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import smtplib
import imaplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.db.database import get_db
from app.api.deps import get_current_user
from app.core.security import verify_password
from app.core.encryption import encrypt_value, decrypt_value
from app.models.user import User
from app.schemas.user import (
    UserEmailConfigUpdate,
    UserEmailConfigResponse,
    ViewEmailPasswordRequest,
    ViewEmailPasswordResponse,
    TestEmailConfigRequest,
)

router = APIRouter()

# Hostinger defaults
HOSTINGER_SMTP_HOST = "smtp.hostinger.com"
HOSTINGER_SMTP_PORT = 465
HOSTINGER_IMAP_HOST = "imap.hostinger.com"
HOSTINGER_IMAP_PORT = 993


@router.get("/config", response_model=UserEmailConfigResponse)
async def get_email_config(
    current_user: User = Depends(get_current_user),
):
    """Get current user's email configuration"""
    return UserEmailConfigResponse(
        email=current_user.smtp_email,
        email_config_verified=current_user.email_config_verified,
        has_password=current_user.smtp_password_encrypted is not None,
        last_sync_at=current_user.imap_last_sync_at,
    )


@router.post("/config", response_model=UserEmailConfigResponse)
async def save_email_config(
    config: UserEmailConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save user's email configuration (same credentials used for SMTP and IMAP)"""
    # Encrypt password
    encrypted_password = encrypt_value(config.password)
    
    # Update SMTP settings (sending)
    current_user.smtp_email = config.email
    current_user.smtp_host = HOSTINGER_SMTP_HOST
    current_user.smtp_port = HOSTINGER_SMTP_PORT
    current_user.smtp_password_encrypted = encrypted_password
    current_user.smtp_use_ssl = True
    
    # Update IMAP settings (receiving) - same credentials
    current_user.imap_host = HOSTINGER_IMAP_HOST
    current_user.imap_port = HOSTINGER_IMAP_PORT
    current_user.imap_password_encrypted = encrypted_password  # Same password
    current_user.imap_use_ssl = True
    
    # Reset verification status
    current_user.email_config_verified = False
    
    # Also update legacy field
    current_user.dealership_email = config.email
    
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    
    return UserEmailConfigResponse(
        email=current_user.smtp_email,
        email_config_verified=current_user.email_config_verified,
        has_password=True,
        last_sync_at=current_user.imap_last_sync_at,
    )


@router.post("/view-password", response_model=ViewEmailPasswordResponse)
async def view_email_password(
    request: ViewEmailPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """View email password - requires account password verification"""
    # Verify user's account password
    if not verify_password(request.account_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid account password"
        )
    
    if not current_user.smtp_password_encrypted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No email password configured"
        )
    
    # Decrypt and return password
    decrypted_password = decrypt_value(current_user.smtp_password_encrypted)
    
    return ViewEmailPasswordResponse(password=decrypted_password)


@router.post("/test")
async def test_email_config(
    request: TestEmailConfigRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Test email configuration (tests both SMTP sending and IMAP connection)"""
    # Validate config exists
    if not current_user.smtp_email or not current_user.smtp_password_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email not configured. Please save your email and password first."
        )
    
    # Decrypt password
    try:
        password = decrypt_value(current_user.smtp_password_encrypted)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decrypt password. Please re-save your configuration."
        )
    
    results = {"smtp": None, "imap": None}
    
    # Test SMTP (sending)
    try:
        msg = MIMEMultipart()
        msg['From'] = f"{current_user.full_name} <{current_user.smtp_email}>"
        msg['To'] = request.test_email
        msg['Subject'] = "CRM Email Configuration Test"
        
        body = f"""
        <html>
        <body>
            <h2>Email Configuration Test Successful!</h2>
            <p>Your Hostinger email is working correctly with the CRM.</p>
            <hr>
            <p><strong>Email:</strong> {current_user.smtp_email}</p>
            <p style="color: #666; font-size: 12px;">This is an automated test from your CRM system.</p>
        </body>
        </html>
        """
        msg.attach(MIMEText(body, 'html'))
        
        server = smtplib.SMTP_SSL(HOSTINGER_SMTP_HOST, HOSTINGER_SMTP_PORT, timeout=30)
        server.login(current_user.smtp_email, password)
        server.send_message(msg)
        server.quit()
        
        results["smtp"] = {"success": True, "message": "Email sent successfully"}
        
    except smtplib.SMTPAuthenticationError:
        results["smtp"] = {"success": False, "message": "Authentication failed - check email/password"}
    except smtplib.SMTPConnectError:
        results["smtp"] = {"success": False, "message": "Could not connect to SMTP server"}
    except Exception as e:
        results["smtp"] = {"success": False, "message": str(e)}
    
    # Test IMAP (receiving)
    try:
        imap = imaplib.IMAP4_SSL(HOSTINGER_IMAP_HOST, HOSTINGER_IMAP_PORT)
        imap.login(current_user.smtp_email, password)
        imap.select('INBOX')
        imap.logout()
        
        results["imap"] = {"success": True, "message": "IMAP connection successful"}
        
    except imaplib.IMAP4.error as e:
        results["imap"] = {"success": False, "message": f"IMAP error: {str(e)}"}
    except Exception as e:
        results["imap"] = {"success": False, "message": str(e)}
    
    # Mark as verified if both passed
    all_success = results["smtp"]["success"] and results["imap"]["success"]
    if all_success:
        current_user.email_config_verified = True
        db.add(current_user)
        await db.commit()
    
    return {
        "success": all_success,
        "message": "All tests passed!" if all_success else "Some tests failed",
        "details": {
            "sending": results["smtp"],
            "receiving": results["imap"]
        }
    }


@router.delete("/config")
async def delete_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete user's email configuration"""
    current_user.smtp_email = None
    current_user.smtp_host = HOSTINGER_SMTP_HOST
    current_user.smtp_port = HOSTINGER_SMTP_PORT
    current_user.smtp_password_encrypted = None
    current_user.smtp_use_ssl = True
    current_user.email_config_verified = False
    
    current_user.imap_host = HOSTINGER_IMAP_HOST
    current_user.imap_port = HOSTINGER_IMAP_PORT
    current_user.imap_password_encrypted = None
    current_user.imap_use_ssl = True
    current_user.imap_last_sync_at = None
    
    current_user.dealership_email = None
    
    db.add(current_user)
    await db.commit()
    
    return {"message": "Email configuration deleted successfully"}


@router.post("/sync")
async def sync_inbox_now(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger inbox sync for current user"""
    from app.services.user_imap_service import sync_user_inbox
    
    if not current_user.smtp_email or not current_user.smtp_password_encrypted:
        return {
            "success": False,
            "message": "Email not configured. Please save your credentials first."
        }
    
    try:
        stats = await sync_user_inbox(db, current_user)
        return {
            "success": True,
            "message": f"Synced {stats['emails_fetched']} emails, {stats['emails_matched']} matched to leads",
            "stats": stats
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Sync failed: {str(e)}"
        }
