"""
Meta (Facebook) Ads Integration Service
"""
import hmac
import hashlib
from typing import Any, Dict, Optional
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.integration import IntegrationService


class MetaAdsService:
    """Service for interacting with Meta Lead Ads API"""

    @staticmethod
    def verify_webhook_signature(payload: str, signature: str) -> bool:
        """Verify the signature from Meta to ensure authenticity"""
        if not settings.meta_app_secret:
            return True # In development if secret not set
            
        expected_signature = hmac.new(
            settings.meta_app_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(f"sha256={expected_signature}", signature)

    @staticmethod
    async def fetch_lead_details(leadgen_id: str, access_token: str) -> Dict[str, Any]:
        """Fetch full lead details from Meta using the leadgen_id"""
        url = f"https://graph.facebook.com/v19.0/{leadgen_id}"
        params = {"access_token": access_token}
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            # Map field_data to a flat dict
            # Meta structure: field_data: [{"name": "email", "values": ["..."]}, ...]
            field_data = data.get("field_data", [])
            flat_data = {item["name"]: item["values"][0] for item in field_data if item.get("values")}
            flat_data["meta_id"] = data.get("id")
            flat_data["created_time"] = data.get("created_time")
            
            return flat_data

    @staticmethod
    async def handle_lead_webhook(
        db: AsyncSession,
        dealership_id: UUID,
        leadgen_id: str,
        page_access_token: Optional[str] = None
    ) -> Any:
        """Process a lead from a webhook event"""
        # In production, we'd fetch the dealership's Meta credentials from DB
        # For now, use a placeholder or settings if applicable
        token = page_access_token or settings.meta_app_secret # Placeholder logic
        
        try:
            lead_details = await MetaAdsService.fetch_lead_details(leadgen_id, token)
            return await IntegrationService.process_meta_lead(db, dealership_id, lead_details)
        except Exception as e:
            # Log error
            print(f"Error processing Meta lead: {e}")
            return None
