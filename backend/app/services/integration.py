"""
Integration Service Layer
"""
import httpx
import json
from typing import Any, Dict, List, Optional
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.lead import Lead, LeadSource, LeadStatus
from app.models.dealership import Dealership
from app.services.activity import ActivityService
from app.models.activity import ActivityType


class IntegrationService:
    """Service for handling external data integrations (Meta, Google Sheets)"""

    @staticmethod
    async def process_meta_lead(
        db: AsyncSession,
        dealership_id: UUID,
        lead_data: Dict[str, Any]
    ) -> Lead:
        """
        Process a new lead from Meta Lead Ads.
        """
        # Extract fields from Meta structure (example)
        first_name = lead_data.get("first_name", "Unknown")
        last_name = lead_data.get("last_name", "")
        email = lead_data.get("email")
        phone = lead_data.get("phone_number")
        
        # Check for existing lead in this dealership (deduplication)
        # Note: In production, use more robust matching (normalize phone, etc)
        existing_query = select(Lead).where(
            Lead.dealership_id == dealership_id,
            (Lead.email == email) | (Lead.phone == phone)
        )
        result = await db.execute(existing_query)
        existing_lead = result.scalar_one_or_none()
        
        if existing_lead:
            # Update existing lead activity
            await ActivityService.log_activity(
                db,
                activity_type=ActivityType.NOTE_ADDED,
                description="Lead attempted to re-submit form via Meta Ads",
                lead_id=existing_lead.id,
                dealership_id=dealership_id,
                meta_data={"meta_data": lead_data}
            )
            return existing_lead

        # Create new lead
        new_lead = Lead(
            first_name=first_name,
            last_name=last_name,
            email=email,
            phone=phone,
            source=LeadSource.META_ADS,
            status=LeadStatus.NEW,
            dealership_id=dealership_id,
            meta_data=lead_data
        )
        
        db.add(new_lead)
        await db.flush()
        
        # Log activity
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.LEAD_CREATED,
            description="Lead captured via Meta Lead Ads",
            lead_id=new_lead.id,
            dealership_id=dealership_id,
            meta_data={"form_id": lead_data.get("form_id")}
        )
        
        # Trigger assignment logic here (omitted for now)
        return new_lead

    @staticmethod
    async def sync_google_sheet(
        db: AsyncSession,
        dealership_id: UUID,
        sheet_data: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        """
        Sync leads from a Google Sheet.
        Expects a list of dictionaries mapping headers to values.
        """
        created_count = 0
        updated_count = 0
        
        for row in sheet_data:
            email = row.get("email")
            phone = row.get("phone")
            
            if not email and not phone:
                continue
                
            # Deduplication logic similar to Meta ads
            existing_query = select(Lead).where(
                Lead.dealership_id == dealership_id,
                (Lead.email == email) | (Lead.phone == phone)
            )
            result = await db.execute(existing_query)
            existing_lead = result.scalar_one_or_none()
            
            if existing_lead:
                updated_count += 1
                continue # For now, skip updates to avoid overwriting salesperson notes
                
            new_lead = Lead(
                first_name=row.get("first_name", "Sheet Lead"),
                last_name=row.get("last_name", ""),
                email=email,
                phone=phone,
                source=LeadSource.GOOGLE_SHEETS,
                status=LeadStatus.NEW,
                dealership_id=dealership_id,
                meta_data=row
            )
            
            db.add(new_lead)
            created_count += 1
            
        await db.flush()
        return {"created": created_count, "updated": updated_count}
