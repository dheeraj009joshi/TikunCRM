"""
API endpoints for Dealership Email Configuration
Only Dealership Admins (and Super Admins) can manage email settings
"""
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.dealership_email_config import DealershipEmailConfig
from app.schemas.dealership_email_config import (
    DealershipEmailConfigCreate,
    DealershipEmailConfigUpdate,
    DealershipEmailConfigResponse,
    EmailTestRequest,
    EmailTestResponse,
    EmailConfigStatusResponse,
)

router = APIRouter()


async def get_user_dealership_id(current_user: User) -> str:
    """Get the dealership ID for the current user"""
    if current_user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Super Admins must specify a dealership_id"
        )
    
    if not current_user.dealership_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not associated with a dealership"
        )
    
    return current_user.dealership_id


@router.get("/status", response_model=EmailConfigStatusResponse)
async def get_email_config_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Get the status of email configuration for the current user's dealership.
    Available to Dealership Admins and Super Admins.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    config = result.scalar_one_or_none()
    
    if not config:
        return EmailConfigStatusResponse(
            has_config=False,
            is_verified=False,
            is_active=False
        )
    
    return EmailConfigStatusResponse(
        has_config=True,
        is_verified=config.is_verified,
        is_active=config.is_active,
        smtp_host=config.smtp_host,
        last_sync_at=config.last_sync_at
    )


@router.get("/config", response_model=DealershipEmailConfigResponse)
async def get_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Get the email configuration for the current user's dealership.
    Available to Dealership Admins and Super Admins.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email configuration not found for this dealership"
        )
    
    return config


@router.post("/config", response_model=DealershipEmailConfigResponse)
async def create_or_update_email_config(
    config_data: DealershipEmailConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Create or update email configuration for the current user's dealership.
    Available to Dealership Admins and Super Admins.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    # Check if config already exists
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    existing_config = result.scalar_one_or_none()
    
    if existing_config:
        # Update existing config
        existing_config.smtp_host = config_data.smtp_host
        existing_config.smtp_port = config_data.smtp_port
        existing_config.smtp_username = config_data.smtp_username
        existing_config.smtp_use_ssl = config_data.smtp_use_ssl
        existing_config.smtp_use_tls = config_data.smtp_use_tls
        
        # Only update passwords if provided (non-empty)
        if config_data.smtp_password:
            existing_config.smtp_password = config_data.smtp_password
            existing_config.is_verified = False  # Reset verification on password change
        
        existing_config.imap_host = config_data.imap_host
        existing_config.imap_port = config_data.imap_port
        existing_config.imap_username = config_data.imap_username or config_data.smtp_username
        existing_config.imap_use_ssl = config_data.imap_use_ssl
        
        # Only update IMAP password if provided
        if config_data.imap_password:
            existing_config.imap_password = config_data.imap_password
        elif config_data.smtp_password and not existing_config._imap_password:
            # If SMTP password changed and no existing IMAP password, use SMTP password
            existing_config.imap_password = config_data.smtp_password
        
        existing_config.from_name = config_data.from_name
        
        await db.commit()
        await db.refresh(existing_config)
        return existing_config
    
    # Create new config
    new_config = DealershipEmailConfig(
        dealership_id=dealership_id,
        smtp_host=config_data.smtp_host,
        smtp_port=config_data.smtp_port,
        smtp_username=config_data.smtp_username,
        smtp_use_ssl=config_data.smtp_use_ssl,
        smtp_use_tls=config_data.smtp_use_tls,
        imap_host=config_data.imap_host,
        imap_port=config_data.imap_port,
        imap_username=config_data.imap_username or config_data.smtp_username,
        imap_use_ssl=config_data.imap_use_ssl,
        from_name=config_data.from_name,
    )
    
    # Set passwords via property setters (handles encryption)
    new_config.smtp_password = config_data.smtp_password
    new_config.imap_password = config_data.imap_password or config_data.smtp_password
    
    db.add(new_config)
    await db.commit()
    await db.refresh(new_config)
    
    return new_config


@router.patch("/config", response_model=DealershipEmailConfigResponse)
async def partial_update_email_config(
    config_data: DealershipEmailConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Partially update email configuration.
    Available to Dealership Admins and Super Admins.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email configuration not found. Create one first."
        )
    
    update_data = config_data.model_dump(exclude_unset=True)
    
    # Handle password updates separately (uses property setter for encryption)
    smtp_password = update_data.pop("smtp_password", None)
    imap_password = update_data.pop("imap_password", None)
    
    for field, value in update_data.items():
        setattr(config, field, value)
    
    if smtp_password:
        config.smtp_password = smtp_password
        config.is_verified = False  # Reset verification on password change
    
    if imap_password:
        config.imap_password = imap_password
    
    await db.commit()
    await db.refresh(config)
    
    return config


@router.delete("/config", status_code=status.HTTP_204_NO_CONTENT)
async def delete_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> None:
    """
    Delete email configuration for the dealership.
    Available to Dealership Admins and Super Admins.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email configuration not found"
        )
    
    await db.delete(config)
    await db.commit()


@router.post("/test", response_model=EmailTestResponse)
async def test_email_config(
    test_data: EmailTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Test the email configuration by sending a test email.
    This also marks the configuration as verified if successful.
    """
    dealership_id = await get_user_dealership_id(current_user)
    
    result = await db.execute(
        select(DealershipEmailConfig).where(
            DealershipEmailConfig.dealership_id == dealership_id
        )
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email configuration not found. Create one first."
        )
    
    try:
        # Create test email
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "TikunCRM - Email Configuration Test"
        msg["From"] = f"{config.from_name or 'TikunCRM'} <{config.smtp_username}>"
        msg["To"] = test_data.test_email
        
        text_content = f"""
Hello,

This is a test email from TikunCRM to verify your email configuration.

If you received this email, your SMTP settings are working correctly!

Configuration details:
- SMTP Host: {config.smtp_host}
- SMTP Port: {config.smtp_port}
- Username: {config.smtp_username}
- SSL: {'Yes' if config.smtp_use_ssl else 'No'}
- TLS: {'Yes' if config.smtp_use_tls else 'No'}

Best regards,
TikunCRM
        """
        
        html_content = f"""
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <h2 style="color: #2563eb;">TikunCRM - Email Configuration Test</h2>
    <p>Hello,</p>
    <p>This is a test email from TikunCRM to verify your email configuration.</p>
    <p style="color: #16a34a; font-weight: bold;">
        If you received this email, your SMTP settings are working correctly!
    </p>
    <h3>Configuration Details:</h3>
    <ul>
        <li><strong>SMTP Host:</strong> {config.smtp_host}</li>
        <li><strong>SMTP Port:</strong> {config.smtp_port}</li>
        <li><strong>Username:</strong> {config.smtp_username}</li>
        <li><strong>SSL:</strong> {'Yes' if config.smtp_use_ssl else 'No'}</li>
        <li><strong>TLS:</strong> {'Yes' if config.smtp_use_tls else 'No'}</li>
    </ul>
    <p>Best regards,<br>TikunCRM</p>
</body>
</html>
        """
        
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))
        
        # Get decrypted password
        password = config.smtp_password
        
        # Connect and send
        if config.smtp_use_ssl:
            # SSL connection (port 465)
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, context=context) as server:
                server.login(config.smtp_username, password)
                server.send_message(msg)
        else:
            # TLS connection (port 587)
            with smtplib.SMTP(config.smtp_host, config.smtp_port) as server:
                if config.smtp_use_tls:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                server.login(config.smtp_username, password)
                server.send_message(msg)
        
        # Mark as verified
        config.is_verified = True
        await db.commit()
        
        return EmailTestResponse(
            success=True,
            message=f"Test email sent successfully to {test_data.test_email}",
            details="Email configuration has been verified and is ready to use."
        )
        
    except smtplib.SMTPAuthenticationError as e:
        return EmailTestResponse(
            success=False,
            message="Authentication failed",
            details=f"Please check your username and password. Error: {str(e)}"
        )
    except smtplib.SMTPConnectError as e:
        return EmailTestResponse(
            success=False,
            message="Connection failed",
            details=f"Could not connect to SMTP server. Check host and port. Error: {str(e)}"
        )
    except smtplib.SMTPException as e:
        return EmailTestResponse(
            success=False,
            message="SMTP error occurred",
            details=str(e)
        )
    except Exception as e:
        return EmailTestResponse(
            success=False,
            message="An error occurred",
            details=str(e)
        )
