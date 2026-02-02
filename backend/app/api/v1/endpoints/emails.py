"""
Email Endpoints - Templates and Sending
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.permissions import Permission, UserRole
from app.db.database import get_db
from app.models.user import User
from app.models.lead import Lead
from app.models.email_template import EmailTemplate, TemplateCategory
from app.schemas.email_template import (
    EmailTemplateCreate,
    EmailTemplateUpdate,
    EmailTemplateResponse,
    EmailTemplateListResponse,
    EmailComposeRequest,
    EmailSendResponse,
    EmailPreviewRequest,
    EmailPreviewResponse
)
from app.services.email_sender import EmailService

router = APIRouter()


# ============== Email Templates ==============

@router.get("/templates", response_model=EmailTemplateListResponse)
async def list_email_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: Optional[TemplateCategory] = None,
    search: Optional[str] = None
) -> Any:
    """
    List email templates available to the user.
    Users can see:
    - System templates (is_system=True)
    - Dealership templates (if in same dealership)
    - Their own templates
    """
    query = select(EmailTemplate).where(EmailTemplate.is_active == True)
    
    # Filter by visibility
    if current_user.role == UserRole.SUPER_ADMIN:
        # Super admin sees all templates
        pass
    else:
        # Other users see system, their dealership's, and their own templates
        visibility_filter = or_(
            EmailTemplate.is_system == True,
            EmailTemplate.created_by == current_user.id,
            and_(
                EmailTemplate.dealership_id == current_user.dealership_id,
                EmailTemplate.dealership_id != None
            )
        )
        query = query.where(visibility_filter)
    
    # Filter by category
    if category:
        query = query.where(EmailTemplate.category == category)
    
    # Search
    if search:
        search_filter = or_(
            EmailTemplate.name.ilike(f"%{search}%"),
            EmailTemplate.subject.ilike(f"%{search}%"),
            EmailTemplate.description.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
    
    # Count total
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Paginate and order
    query = query.order_by(desc(EmailTemplate.updated_at))
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    templates = result.scalars().all()
    
    return {
        "items": templates,
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.post("/templates", response_model=EmailTemplateResponse)
async def create_email_template(
    template_in: EmailTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Create a new email template.
    """
    template = EmailTemplate(
        name=template_in.name,
        description=template_in.description,
        category=template_in.category,
        subject=template_in.subject,
        body_text=template_in.body_text,
        body_html=template_in.body_html,
        available_variables=template_in.available_variables,
        is_system=False,
        dealership_id=current_user.dealership_id,
        created_by=current_user.id
    )
    
    db.add(template)
    await db.flush()
    await db.refresh(template)
    
    return template


@router.get("/templates/{template_id}", response_model=EmailTemplateResponse)
async def get_email_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get a specific email template.
    """
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Check visibility
    if not template.is_system and current_user.role != UserRole.SUPER_ADMIN:
        if template.created_by != current_user.id and template.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to view this template")
    
    return template


@router.put("/templates/{template_id}", response_model=EmailTemplateResponse)
async def update_email_template(
    template_id: UUID,
    template_in: EmailTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Update an email template.
    Only the creator or super admin can update.
    """
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    # Check permission
    if template.is_system and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Cannot modify system templates")
    
    if template.created_by != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to modify this template")
    
    # Update fields
    update_data = template_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    
    await db.flush()
    await db.refresh(template)
    
    return template


@router.delete("/templates/{template_id}")
async def delete_email_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Delete (deactivate) an email template.
    """
    result = await db.execute(
        select(EmailTemplate).where(EmailTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    
    if template.is_system and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Cannot delete system templates")
    
    if template.created_by != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized to delete this template")
    
    # Soft delete
    template.is_active = False
    await db.flush()
    
    return {"message": "Template deleted successfully"}


# ============== Email Variables ==============

@router.get("/variables")
async def get_template_variables() -> Dict[str, str]:
    """
    Get list of available template variables.
    """
    return EmailService.get_available_variables()


# ============== Email Compose & Send ==============

@router.post("/preview", response_model=EmailPreviewResponse)
async def preview_email(
    preview_in: EmailPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Preview an email with template variables replaced.
    """
    subject = preview_in.subject
    body_text = preview_in.body_text
    body_html = preview_in.body_html
    
    # If using a template, fetch it
    if preview_in.template_id:
        result = await db.execute(
            select(EmailTemplate).where(EmailTemplate.id == preview_in.template_id)
        )
        template = result.scalar_one_or_none()
        if template:
            subject = subject or template.subject
            body_text = body_text or template.body_text
            body_html = body_html or template.body_html
    
    preview = await EmailService.preview_email(
        db,
        subject=subject or "",
        body_text=body_text,
        body_html=body_html,
        lead_id=preview_in.lead_id,
        user=current_user
    )
    
    return preview


@router.post("/send", response_model=EmailSendResponse)
async def send_email(
    email_in: EmailComposeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Compose and send an email.
    """
    subject = email_in.subject
    body_text = email_in.body_text
    body_html = email_in.body_html
    
    # If using a template, fetch and merge
    if email_in.template_id:
        result = await db.execute(
            select(EmailTemplate).where(EmailTemplate.id == email_in.template_id)
        )
        template = result.scalar_one_or_none()
        if template:
            subject = subject or template.subject
            body_text = body_text or template.body_text
            body_html = body_html or template.body_html
    
    result = await EmailService.send_email(
        db,
        from_user=current_user,
        to_email=email_in.to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        cc_emails=email_in.cc_emails,
        bcc_emails=email_in.bcc_emails,
        lead_id=email_in.lead_id,
        template_id=email_in.template_id
    )
    
    return result


@router.get("/lead/{lead_id}/history")
async def get_lead_email_history(
    lead_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
) -> Any:
    """
    Get email history for a specific lead.
    """
    from app.models.email_log import EmailLog
    
    # Verify lead exists and user has access
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Check access
    if current_user.role == UserRole.SALESPERSON:
        if lead.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this lead's emails")
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if lead.dealership_id != current_user.dealership_id:
            raise HTTPException(status_code=403, detail="Not authorized to view this lead's emails")
    
    # Query emails
    query = select(EmailLog).where(EmailLog.lead_id == lead_id)
    
    # Count
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Paginate
    query = query.order_by(desc(EmailLog.created_at))
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    emails = result.scalars().all()
    
    # Format response
    items = []
    for email in emails:
        items.append({
            "id": email.id,
            "direction": email.direction.value,
            "from_email": email.from_email,
            "to_email": email.to_email,
            "subject": email.subject,
            "body": email.body_text,
            "body_html": email.body_html,
            "sent_at": email.sent_at,
            "created_at": email.created_at,
            "is_read": email.is_read
        })
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size
    }


# ============== Template Categories ==============

@router.get("/categories")
async def get_template_categories() -> List[Dict[str, str]]:
    """
    Get list of template categories.
    """
    return [
        {"value": cat.value, "label": cat.value.replace("_", " ").title()}
        for cat in TemplateCategory
    ]


@router.get("/config/status")
async def get_email_config_status(
    current_user: User = Depends(deps.get_current_active_user)
) -> Dict[str, Any]:
    """
    Check email provider configuration status.
    """
    status = EmailService.get_provider_status()
    
    return {
        "provider": status["provider"],
        "is_configured": status["is_configured"],
        "from_email": status["from_email"],
        "from_name": status["from_name"],
        "message": (
            f"Email provider ({status['provider']}) is configured and ready to send emails"
            if status["is_configured"]
            else f"Email provider ({status['provider']}) not configured. Emails will be logged but not delivered."
        ),
        "supported_providers": ["smtp", "sendgrid", "mailgun", "aws_ses"]
    }


# ============== Email Inbox / Communications ==============

@router.get("/inbox")
async def get_email_inbox(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    direction: Optional[str] = None,  # "sent", "received", or None for all
    search: Optional[str] = None,
    unread_only: bool = False
) -> Any:
    """
    Get user's email inbox with all sent and received emails.
    - Super Admin sees all emails
    - Dealership Owner/Admin sees emails from their dealership
    - Salesperson sees emails they sent OR emails for leads assigned to them
    """
    from app.models.email_log import EmailLog, EmailDirection
    
    query = select(EmailLog)
    
    # RBAC filtering - need to include both sent emails (by user_id) and received emails (by lead assignment)
    if current_user.role == UserRole.SALESPERSON:
        # Emails sent by this user OR emails for leads assigned to this user
        from app.models.lead import Lead
        user_leads = select(Lead.id).where(Lead.assigned_to == current_user.id)
        query = query.where(
            or_(
                EmailLog.user_id == current_user.id,  # Sent by this user
                EmailLog.lead_id.in_(user_leads)  # For leads assigned to this user
            )
        )
    elif current_user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        # Emails from users in their dealership OR for leads in their dealership
        from app.models.user import User as UserModel
        from app.models.lead import Lead
        dealership_users = select(UserModel.id).where(
            UserModel.dealership_id == current_user.dealership_id
        )
        dealership_leads = select(Lead.id).where(
            Lead.dealership_id == current_user.dealership_id
        )
        query = query.where(
            or_(
                EmailLog.user_id.in_(dealership_users),  # Sent by dealership users
                EmailLog.lead_id.in_(dealership_leads)  # For dealership leads
            )
        )
    # Super Admin sees all emails (no filter)
    
    # Direction filter
    if direction == "sent":
        query = query.where(EmailLog.direction == EmailDirection.SENT)
    elif direction == "received":
        query = query.where(EmailLog.direction == EmailDirection.RECEIVED)
    
    # Unread filter
    if unread_only:
        query = query.where(EmailLog.is_read == False)
    
    # Search filter
    if search:
        search_filter = or_(
            EmailLog.subject.ilike(f"%{search}%"),
            EmailLog.from_email.ilike(f"%{search}%"),
            EmailLog.to_email.ilike(f"%{search}%"),
            EmailLog.body_text.ilike(f"%{search}%")
        )
        query = query.where(search_filter)
    
    # Count
    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0
    
    # Count unread
    unread_query = select(func.count()).select_from(
        query.where(EmailLog.is_read == False).subquery()
    )
    unread_result = await db.execute(unread_query)
    unread_count = unread_result.scalar() or 0
    
    # Paginate and order
    query = query.order_by(desc(EmailLog.created_at))
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    emails = result.scalars().all()
    
    # Format response with lead info
    items = []
    for email in emails:
        email_data = {
            "id": str(email.id),
            "direction": email.direction.value,
            "from_email": email.from_email,
            "to_email": email.to_email,
            "cc_emails": email.cc_emails,
            "subject": email.subject,
            "body": email.body_text,  # Use body_text field
            "body_html": email.body_html,
            "gmail_thread_id": email.gmail_thread_id,
            "sent_at": email.sent_at.isoformat() if email.sent_at else None,
            "received_at": email.received_at.isoformat() if email.received_at else None,
            "created_at": email.created_at.isoformat(),
            "is_read": email.is_read,
            "lead_id": str(email.lead_id) if email.lead_id else None,
            "user_id": str(email.user_id) if email.user_id else None,
            "lead": None,
            "sender_user": None
        }
        
        # Get lead info if exists
        if email.lead_id:
            lead_result = await db.execute(select(Lead).where(Lead.id == email.lead_id))
            lead = lead_result.scalar_one_or_none()
            if lead:
                email_data["lead"] = {
                    "id": str(lead.id),
                    "first_name": lead.first_name,
                    "last_name": lead.last_name,
                    "email": lead.email
                }
        
        # Get sender user info
        if email.user_id:
            user_result = await db.execute(select(User).where(User.id == email.user_id))
            sender = user_result.scalar_one_or_none()
            if sender:
                email_data["sender_user"] = {
                    "id": str(sender.id),
                    "first_name": sender.first_name,
                    "last_name": sender.last_name,
                    "email": sender.email
                }
        
        items.append(email_data)
    
    return {
        "items": items,
        "total": total,
        "unread_count": unread_count,
        "page": page,
        "page_size": page_size
    }


# IMPORTANT: Static routes must come before parameterized routes
@router.get("/inbox/stats")
async def get_email_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get email statistics for the current user.
    """
    from app.models.email_log import EmailLog, EmailDirection
    from app.models.lead import Lead
    
    # Build base filter based on role
    if current_user.role == UserRole.SALESPERSON:
        # Emails sent by this user OR emails for leads assigned to this user
        user_leads = select(Lead.id).where(Lead.assigned_to == current_user.id)
        base_filter = or_(
            EmailLog.user_id == current_user.id,
            EmailLog.lead_id.in_(user_leads)
        )
    elif current_user.role in (UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER):
        from app.models.user import User as UserModel
        dealership_users = select(UserModel.id).where(
            UserModel.dealership_id == current_user.dealership_id
        )
        dealership_leads = select(Lead.id).where(
            Lead.dealership_id == current_user.dealership_id
        )
        base_filter = or_(
            EmailLog.user_id.in_(dealership_users),
            EmailLog.lead_id.in_(dealership_leads)
        )
    else:
        # Super Admin sees all - use a truthy condition
        base_filter = EmailLog.id.isnot(None)
    
    # Total sent
    sent_query = select(func.count(EmailLog.id)).where(
        and_(EmailLog.direction == EmailDirection.SENT, base_filter)
    )
    sent_result = await db.execute(sent_query)
    total_sent = sent_result.scalar() or 0
    
    # Total received
    received_query = select(func.count(EmailLog.id)).where(
        and_(EmailLog.direction == EmailDirection.RECEIVED, base_filter)
    )
    received_result = await db.execute(received_query)
    total_received = received_result.scalar() or 0
    
    # Unread count - ONLY for RECEIVED emails (sent emails don't need "read" tracking)
    unread_query = select(func.count(EmailLog.id)).where(
        and_(
            EmailLog.is_read == False,
            EmailLog.direction == EmailDirection.RECEIVED,
            base_filter
        )
    )
    unread_result = await db.execute(unread_query)
    unread_count = unread_result.scalar() or 0
    
    return {
        "total_sent": total_sent,
        "total_received": total_received,
        "unread_count": unread_count,
        "total": total_sent + total_received
    }


@router.get("/inbox/thread/{thread_id}")
async def get_email_thread(
    thread_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get all emails in a thread (conversation).
    Thread is identified by gmail_thread_id or grouped by subject + lead_id.
    """
    from app.models.email_log import EmailLog
    
    # First try to find by gmail_thread_id
    query = select(EmailLog).where(EmailLog.gmail_thread_id == thread_id)
    result = await db.execute(query)
    emails = result.scalars().all()
    
    if not emails:
        # Try to find the original email by ID and get related emails
        try:
            email_uuid = UUID(thread_id)
            original_result = await db.execute(
                select(EmailLog).where(EmailLog.id == email_uuid)
            )
            original = original_result.scalar_one_or_none()
            
            if original and original.lead_id:
                # Get all emails with same lead and similar subject
                base_subject = original.subject.replace("Re: ", "").replace("RE: ", "").strip()
                query = select(EmailLog).where(
                    and_(
                        EmailLog.lead_id == original.lead_id,
                        or_(
                            EmailLog.subject == base_subject,
                            EmailLog.subject == f"Re: {base_subject}",
                            EmailLog.subject == f"RE: {base_subject}"
                        )
                    )
                ).order_by(EmailLog.created_at)
                result = await db.execute(query)
                emails = result.scalars().all()
        except ValueError:
            pass
    
    if not emails:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    # Format response
    items = []
    lead_info = None
    
    for email in emails:
        email_data = {
            "id": str(email.id),
            "direction": email.direction.value,
            "from_email": email.from_email,
            "to_email": email.to_email,
            "subject": email.subject,
            "body": email.body_text,
            "body_html": email.body_html,
            "created_at": email.created_at.isoformat(),
            "is_read": email.is_read,
            "sender_user": None
        }
        
        if email.user_id:
            user_result = await db.execute(select(User).where(User.id == email.user_id))
            sender = user_result.scalar_one_or_none()
            if sender:
                email_data["sender_user"] = {
                    "id": str(sender.id),
                    "first_name": sender.first_name,
                    "last_name": sender.last_name,
                    "email": sender.email
                }
        
        items.append(email_data)
        
        if not lead_info and email.lead_id:
            lead_result = await db.execute(select(Lead).where(Lead.id == email.lead_id))
            lead = lead_result.scalar_one_or_none()
            if lead:
                lead_info = {
                    "id": str(lead.id),
                    "first_name": lead.first_name,
                    "last_name": lead.last_name,
                    "email": lead.email
                }
    
    return {
        "thread_id": thread_id,
        "subject": emails[0].subject if emails else "",
        "lead": lead_info,
        "emails": items,
        "total_count": len(items)
    }


@router.get("/inbox/{email_id}")
async def get_email_detail(
    email_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Get a specific email with full details.
    """
    from app.models.email_log import EmailLog
    
    result = await db.execute(select(EmailLog).where(EmailLog.id == email_id))
    email = result.scalar_one_or_none()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Check access
    if current_user.role == UserRole.SALESPERSON:
        if email.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this email")
    elif current_user.role in [UserRole.DEALERSHIP_ADMIN, UserRole.DEALERSHIP_OWNER]:
        if email.user_id:
            user_result = await db.execute(select(User).where(User.id == email.user_id))
            sender = user_result.scalar_one_or_none()
            if sender and sender.dealership_id != current_user.dealership_id:
                raise HTTPException(status_code=403, detail="Not authorized to view this email")
    
    # Mark as read
    if not email.is_read:
        email.is_read = True
        await db.flush()
    
    email_data = {
        "id": str(email.id),
        "direction": email.direction.value,
        "from_email": email.from_email,
        "to_email": email.to_email,
        "cc_emails": email.cc_emails,
        "bcc_emails": email.bcc_emails,
        "subject": email.subject,
        "body": email.body_text,
        "body_html": email.body_html,
        "gmail_message_id": email.gmail_message_id,
        "gmail_thread_id": email.gmail_thread_id,
        "attachments": email.attachments,
        "sent_at": email.sent_at.isoformat() if email.sent_at else None,
        "received_at": email.received_at.isoformat() if email.received_at else None,
        "created_at": email.created_at.isoformat(),
        "is_read": email.is_read,
        "lead_id": str(email.lead_id) if email.lead_id else None,
        "user_id": str(email.user_id) if email.user_id else None,
        "lead": None,
        "sender_user": None
    }
    
    # Get lead info
    if email.lead_id:
        lead_result = await db.execute(select(Lead).where(Lead.id == email.lead_id))
        lead = lead_result.scalar_one_or_none()
        if lead:
            email_data["lead"] = {
                "id": str(lead.id),
                "first_name": lead.first_name,
                "last_name": lead.last_name,
                "email": lead.email,
                "phone": lead.phone
            }
    
    # Get sender user info
    if email.user_id:
        user_result = await db.execute(select(User).where(User.id == email.user_id))
        sender = user_result.scalar_one_or_none()
        if sender:
            email_data["sender_user"] = {
                "id": str(sender.id),
                "first_name": sender.first_name,
                "last_name": sender.last_name,
                "email": sender.email,
                "role": sender.role.value
            }
    
    return email_data


@router.patch("/inbox/{email_id}/read")
async def mark_email_read(
    email_id: UUID,
    is_read: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Mark an email as read or unread.
    """
    from app.models.email_log import EmailLog
    
    result = await db.execute(select(EmailLog).where(EmailLog.id == email_id))
    email = result.scalar_one_or_none()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    email.is_read = is_read
    await db.flush()
    
    return {"message": "Email marked as " + ("read" if is_read else "unread")}


@router.post("/inbox/reply")
async def reply_to_email(
    original_email_id: UUID,
    body_text: str,
    body_html: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Reply to an existing email.
    """
    from app.models.email_log import EmailLog
    
    # Get original email
    result = await db.execute(select(EmailLog).where(EmailLog.id == original_email_id))
    original = result.scalar_one_or_none()
    
    if not original:
        raise HTTPException(status_code=404, detail="Original email not found")
    
    # Determine reply recipient
    to_email = original.from_email if original.direction.value == "received" else original.to_email
    
    # Build reply subject
    subject = original.subject
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"
    
    # Send reply
    send_result = await EmailService.send_email(
        db,
        from_user=current_user,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        lead_id=original.lead_id
    )
    
    return send_result
