"""
Google Sheets Integration Service
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from googleapiclient.discovery import build
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.google_auth import GoogleAuthService
from app.services.integration import IntegrationService


class GoogleSheetsService:
    """Service for interacting with Google Sheets API"""

    @staticmethod
    async def fetch_and_sync_leads(
        db: AsyncSession,
        user_id: UUID,
        dealership_id: UUID,
        spreadsheet_id: str,
        range_name: str = "A2:E100"
    ) -> Dict[str, int]:
        """Fetch rows from a sheet and sync them as leads"""
        creds = await GoogleAuthService.get_credentials(db, user_id)
        if not creds:
            raise Exception("Google account not connected")

        service = build("sheets", "v4", credentials=creds)
        sheet = service.spreadsheets()
        result = sheet.values().get(spreadsheetId=spreadsheet_id, range=range_name).execute()
        values = result.get("values", [])

        if not values:
            return {"created": 0, "updated": 0}

        # Convert simple list of lists to dict list
        # Mapping: 0=First, 1=Last, 2=Email, 3=Phone, 4=Notes
        leads_data = []
        for row in values:
            if len(row) < 3: continue
            leads_data.append({
                "first_name": row[0],
                "last_name": row[1] if len(row) > 1 else "",
                "email": row[2],
                "phone": row[3] if len(row) > 3 else None,
                "notes": row[4] if len(row) > 4 else ""
            })

        return await IntegrationService.sync_google_sheet(db, dealership_id, leads_data)
