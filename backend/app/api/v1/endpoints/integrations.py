"""
Integration API Endpoints
"""
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.models.user import User, UserRole
from app.db.database import get_db
from app.services.integration import IntegrationService
from app.core.config import settings

router = APIRouter()


@router.post("/meta/webhook")
async def meta_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_hub_signature_256: str = Header(None)
) -> Any:
    """
    Webhook endpoint for Meta (Facebook) Lead Ads.
    Handles verification and lead processing.
    """
    # 1. Handle Verification (GET request from Meta)
    if request.method == "GET":
        params = request.query_params
        if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == settings.meta_verify_token:
             return int(params.get("hub.challenge"))
        return "Verification failed", 403

    # 2. Process Data (POST request)
    payload = await request.json()
    
    # Validation of signature would go here in production
    
    # Process the lead
    # Structure from Meta: entries -> changes -> value -> leadgen_id
    # We need to fetch the lead details using the ID and dealership token
    
    return {"status": "received"}


@router.post("/sheets/sync/{dealership_id}", status_code=status.HTTP_200_OK)
async def sync_google_sheet(
    dealership_id: UUID,
    data: List[Dict[str, Any]],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Trigger a manual sync of leads from a Google Sheet.
    In a real implementation, this would likely be called by a background task.
    """
    # Permission check
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id != dealership_id:
         raise HTTPException(status_code=403, detail="Not authorized")
         
    results = await IntegrationService.sync_google_sheet(db, dealership_id, data)
    return results


@router.post("/sheets/sync-remote/{dealership_id}", status_code=status.HTTP_200_OK)
async def sync_remote_google_sheet(
    dealership_id: UUID,
    spreadsheet_id: str,
    range_name: str = "A2:E100",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(deps.get_current_active_user)
) -> Any:
    """
    Fetch leads directly from a Google Sheet using stored tokens.
    """
    from app.services.google_sheets import GoogleSheetsService
    
    # Permission check
    if current_user.role != UserRole.SUPER_ADMIN and current_user.dealership_id != dealership_id:
         raise HTTPException(status_code=403, detail="Not authorized")
         
    try:
        results = await GoogleSheetsService.fetch_and_sync_leads(
            db, 
            current_user.id, 
            dealership_id, 
            spreadsheet_id, 
            range_name
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


from app.models.user import User, UserRole
