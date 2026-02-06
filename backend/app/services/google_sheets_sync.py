"""
Google Sheets Lead Sync Service

Fetches leads from a Google Sheet and adds new ones to the database.
Uses the public CSV export feature (no API key needed for public sheets).
"""
import logging
import csv
import io
from datetime import datetime
from typing import Optional, List, Dict, Any, Set
import httpx

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, text

from app.models.lead import Lead, LeadSource, LeadStatus
from app.models.dealership import Dealership
from app.models.activity import Activity, ActivityType
from app.core.config import settings

logger = logging.getLogger(__name__)

# Google Sheet configuration
GOOGLE_SHEET_ID = "1_7Qdzgjj9Ye5V7ZW0_gYblqU8V9pkbjDjkahTl8O4kI"
GOOGLE_SHEET_GID = "0"

# Export URL format for public Google Sheets
SHEET_EXPORT_URL = f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/export?format=csv&gid={GOOGLE_SHEET_GID}"


def get_sync_session_maker():
    """Create a dedicated engine and session maker for sync operations."""
    from sqlalchemy.pool import NullPool
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        poolclass=NullPool,  # Use NullPool for background tasks
    )
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def parse_full_name(full_name: str) -> tuple[str, Optional[str]]:
    """Parse full name into first name and last name."""
    if not full_name:
        return "Unknown", None
    
    parts = full_name.strip().split(maxsplit=1)
    first_name = parts[0] if parts else "Unknown"
    last_name = parts[1] if len(parts) > 1 else None
    
    return first_name, last_name


def clean_phone(phone: str) -> Optional[str]:
    """Clean phone number - remove prefix 'p:' if present."""
    if not phone:
        return None
    
    phone = phone.strip()
    if phone.startswith("p:"):
        phone = phone[2:]
    
    # Remove any non-phone characters except + and digits
    cleaned = ''.join(c for c in phone if c.isdigit() or c == '+')
    return cleaned if cleaned else None


def parse_sheet_row(row: Dict[str, str], headers: List[str]) -> Optional[Dict[str, Any]]:
    """
    Parse a single row from the Google Sheet into lead data.
    
    Column names from the sheet:
    - lead_id_col: First column containing lead ID like l:xxxxx (mapped by fetch_sheet_data)
    - created_time: Timestamp
    - ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name: Ad info
    - form_id, form_name: Form info
    - is_organic: Boolean
    - platform: 'fb' or 'ig'
    - full_name: Customer name (REQUIRED)
    - phone_number: Phone with 'p:' prefix like 'p:+14708454461' (REQUIRED)
    - lead_status: Status like 'CREATED'
    - notes: Notes
    - 3rd Follow Up, 4th Follow Up: Follow-up notes
    - appt: Appointment info
    - location: Customer location
    - origin: Country of origin
    """
    try:
        # Get full name (exact column name: 'full_name') - REQUIRED
        full_name = row.get('full_name', '').strip()
        
        if not full_name:
            return None
        
        # Get phone number - REQUIRED for deduplication
        phone = row.get('phone_number', '')
        phone = clean_phone(phone)
        
        if not phone:
            return None
        
        first_name, last_name = parse_full_name(full_name)
        
        # Get lead ID from first column (stored as 'lead_id_col' by fetch_sheet_data)
        lead_id_col = row.get('lead_id_col', '').strip()
        
        if lead_id_col.startswith('l:'):
            sheet_lead_id = lead_id_col
            external_id = lead_id_col  # Use the l:xxx ID as external_id
        else:
            sheet_lead_id = None
            external_id = f"sheet:{phone}"  # Fallback to phone-based ID
        
        # Get notes - combine relevant columns
        notes_parts = []
        
        if row.get('notes'):
            notes_parts.append(f"Notes: {row['notes']}")
        if row.get('Second Follow Up'):
            notes_parts.append(f"2nd Follow Up: {row['Second Follow Up']}")
        if row.get('3rd Follow Up'):
            notes_parts.append(f"3rd Follow Up: {row['3rd Follow Up']}")
        if row.get('4th Follow Up'):
            notes_parts.append(f"4th Follow Up: {row['4th Follow Up']}")
        if row.get('appt'):
            notes_parts.append(f"Appt: {row['appt']}")
        
        notes = ' | '.join(notes_parts) if notes_parts else None
        
        # Get location and origin
        location = row.get('location', '').strip()
        origin = row.get('origin', '').strip()
        
        # Get lead status from sheet
        sheet_status = row.get('lead_status', 'CREATED').strip()
        
        # Get platform (fb, ig)
        platform = row.get('platform', '').strip()
        
        # Get campaign info
        campaign_name = row.get('campaign_name', '').strip()
        campaign_id = row.get('campaign_id', '').strip()
        ad_name = row.get('ad_name', '').strip()
        ad_id = row.get('ad_id', '').strip()
        adset_name = row.get('adset_name', '').strip()
        adset_id = row.get('adset_id', '').strip()
        form_name = row.get('form_name', '').strip()
        form_id = row.get('form_id', '').strip()
        is_organic = row.get('is_organic', '').strip()
        
        # Get created time
        created_time = row.get('created_time', '').strip()
        
        # Build metadata with all relevant info
        meta_data = {
            'sheet_lead_id': sheet_lead_id,
            'platform': platform,
            'campaign_name': campaign_name,
            'campaign_id': campaign_id,
            'ad_name': ad_name,
            'ad_id': ad_id,
            'adset_name': adset_name,
            'adset_id': adset_id,
            'form_name': form_name,
            'form_id': form_id,
            'is_organic': is_organic,
            'location': location,
            'origin': origin,
            'sheet_status': sheet_status,
            'created_time': created_time,
        }
        
        return {
            'external_id': external_id,
            'first_name': first_name,
            'last_name': last_name,
            'phone': phone,
            'source': LeadSource.GOOGLE_SHEETS,
            'status': LeadStatus.NEW,
            'notes': notes,
            'meta_data': meta_data,
        }
        
    except Exception as e:
        logger.error(f"Error parsing sheet row: {e}")
        return None


async def fetch_sheet_data() -> tuple[List[Dict[str, str]], List[str]]:
    """
    Fetch data from Google Sheet using CSV export.
    Returns tuple of (list of row dictionaries, list of headers).
    
    NOTE: We use csv.reader instead of DictReader because the sheet has multiple
    columns with empty headers, and DictReader overwrites values for duplicate keys.
    The first column (lead ID like l:xxxxx) must be captured separately.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(SHEET_EXPORT_URL, follow_redirects=True)
            response.raise_for_status()
            
            # Parse CSV using regular reader to handle duplicate empty headers
            content = response.text
            reader = csv.reader(io.StringIO(content))
            
            # Get headers from first row
            headers = next(reader, [])
            if not headers:
                logger.warning("No headers found in Google Sheet")
                return [], []
            
            # Build rows as dictionaries, keeping first column as special key 'lead_id_col'
            rows = []
            for row_values in reader:
                if not row_values:
                    continue
                    
                # Build row dict - use headers for column names
                row_dict = {}
                for i, value in enumerate(row_values):
                    if i == 0:
                        # First column is always the lead ID, store with special key
                        row_dict['lead_id_col'] = value.strip() if value else ''
                    elif i < len(headers):
                        header = headers[i]
                        # Only store if we don't already have this header (avoid duplicates)
                        if header and header not in row_dict:
                            row_dict[header] = value.strip() if value else ''
                
                rows.append(row_dict)
            
            logger.info(f"Fetched {len(rows)} rows from Google Sheet with {len(headers)} columns")
            logger.debug(f"Headers: {headers}")
            return rows, headers
            
    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching Google Sheet: {e}")
        return [], []
    except Exception as e:
        logger.error(f"Error fetching Google Sheet: {e}")
        return [], []


async def get_existing_external_ids(session: AsyncSession) -> Set[str]:
    """Get all existing external_ids in one query."""
    result = await session.execute(
        select(Lead.external_id).where(Lead.external_id.isnot(None))
    )
    return {row[0] for row in result.fetchall()}


async def get_existing_phones(session: AsyncSession) -> Set[str]:
    """Get all existing phone numbers in one query."""
    result = await session.execute(
        select(Lead.phone).where(Lead.phone.isnot(None))
    )
    return {row[0] for row in result.fetchall()}


async def sync_google_sheet_leads():
    """
    Main sync function - fetches leads from Google Sheet and adds new ones.
    This is called by the scheduler every minute.
    Uses a dedicated database connection to avoid conflicts with the main app.
    """
    logger.info("Starting Google Sheet lead sync...")
    
    try:
        # Fetch data from sheet first (no DB needed)
        rows, headers = await fetch_sheet_data()
        
        if not rows:
            logger.info("No data fetched from Google Sheet")
            return
        
        # Parse all rows first (no DB needed)
        parsed_leads = []
        skipped_count = 0
        
        for row in rows:
            lead_data = parse_sheet_row(row, headers)
            if lead_data:
                parsed_leads.append(lead_data)
            else:
                skipped_count += 1
        
        if not parsed_leads:
            logger.info(f"No valid leads to process ({skipped_count} skipped)")
            return
        
        # Now do DB operations with dedicated session
        sync_session_maker = get_sync_session_maker()
        
        new_leads_count = 0
        duplicate_count = 0
        
        async with sync_session_maker() as session:
            try:
                # Look up Toyota South Atlanta dealership for auto-assignment
                # Use ILIKE for case-insensitive matching and TRIM to handle trailing spaces
                toyota_south_result = await session.execute(
                    select(Dealership).where(
                        Dealership.name.ilike("%Toyota South Atlanta%")
                    )
                )
                toyota_south = toyota_south_result.scalar_one_or_none()
                if not toyota_south:
                    logger.warning("Toyota South Atlanta dealership not found - leads will be unassigned")
                else:
                    logger.info(f"Auto-assigning leads to dealership: {toyota_south.name} (id: {toyota_south.id})")
                
                # Get all existing external_ids and phones in batch
                existing_external_ids = await get_existing_external_ids(session)
                existing_phones = await get_existing_phones(session)
                
                # Filter out duplicates
                new_leads = []
                for lead_data in parsed_leads:
                    # Check external_id
                    if lead_data['external_id'] in existing_external_ids:
                        duplicate_count += 1
                        continue
                    
                    # Check phone
                    if lead_data['phone'] and lead_data['phone'] in existing_phones:
                        duplicate_count += 1
                        continue
                    
                    # Add to new leads list and track to avoid duplicates within batch
                    new_leads.append(lead_data)
                    if lead_data['external_id']:
                        existing_external_ids.add(lead_data['external_id'])
                    if lead_data['phone']:
                        existing_phones.add(lead_data['phone'])
                
                # Batch insert new leads
                created_leads = []
                if new_leads:
                    # Determine dealership_id for all leads (Toyota South if found)
                    target_dealership_id = toyota_south.id if toyota_south else None
                    
                    for lead_data in new_leads:
                        new_lead = Lead(
                            first_name=lead_data['first_name'],
                            last_name=lead_data['last_name'],
                            phone=lead_data['phone'],
                            source=lead_data['source'],
                            status=lead_data['status'],
                            notes=lead_data['notes'],
                            meta_data=lead_data['meta_data'],
                            external_id=lead_data['external_id'],
                            dealership_id=target_dealership_id,
                            assigned_to=None,
                            created_by=None,
                        )
                        session.add(new_lead)
                        created_leads.append(new_lead)
                    
                    # Flush to get lead IDs before creating activities
                    await session.flush()
                    
                    # Create LEAD_CREATED activity for each lead (system activity)
                    for lead in created_leads:
                        activity = Activity(
                            type=ActivityType.LEAD_CREATED,
                            description="Lead created from Google Sheets import",
                            user_id=None,  # System activity
                            lead_id=lead.id,
                            dealership_id=lead.dealership_id,
                            meta_data={
                                "source": "google_sheets",
                                "external_id": lead.external_id,
                                "auto_assigned_dealership": toyota_south.name if toyota_south else None
                            }
                        )
                        session.add(activity)
                    
                    await session.commit()
                    new_leads_count = len(new_leads)
                    
                    # Emit WebSocket events and send notifications for each new lead
                    for lead in created_leads:
                        try:
                            from app.services.notification_service import (
                                emit_lead_created, 
                                emit_badges_refresh,
                                notify_lead_assigned_to_dealership_background,
                            )
                            await emit_lead_created(
                                str(lead.id),
                                str(lead.dealership_id) if lead.dealership_id else None,
                                {
                                    "first_name": lead.first_name,
                                    "last_name": lead.last_name,
                                    "phone": lead.phone,
                                    "source": lead.source.value if lead.source else None,
                                }
                            )
                            
                            # Send notification to all dealership members
                            if lead.dealership_id:
                                lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "New Lead"
                                source_display = lead.source.value if lead.source else "google_sheets"
                                await notify_lead_assigned_to_dealership_background(
                                    lead_id=lead.id,
                                    lead_name=lead_name,
                                    dealership_id=lead.dealership_id,
                                    source=source_display,
                                )
                        except Exception as e:
                            logger.warning(f"Failed to emit WebSocket event for lead {lead.id}: {e}")
                    
                    # Emit badges refresh event so sidebar counts update
                    if new_leads_count > 0:
                        try:
                            from app.services.notification_service import emit_badges_refresh
                            await emit_badges_refresh(unassigned=True)
                        except Exception as e:
                            logger.warning(f"Failed to emit badges refresh: {e}")
                    
                    # Send notifications for new leads to dealership team
                    if new_leads_count > 0 and toyota_south:
                        await send_new_lead_notifications(session, created_leads, toyota_south.id)
                
            except Exception as e:
                await session.rollback()
                raise
        
        logger.info(
            f"Google Sheet sync complete: "
            f"{new_leads_count} new leads added, "
            f"{duplicate_count + skipped_count} skipped (duplicates/invalid)"
        )
        
    except Exception as e:
        logger.error(f"Google Sheet sync failed: {e}")
        # Don't re-raise - let scheduler continue


async def send_new_lead_notifications(session: AsyncSession, leads: List[Lead], dealership_id: str):
    """
    Send comprehensive notifications for new leads to all dealership team members.
    Uses multi-channel notification service (push + SMS).
    """
    try:
        from app.services.notification_service import NotificationService
        
        notification_service = NotificationService(session)
        
        for lead in leads:
            try:
                lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                
                # Use the new notification service method to broadcast to all dealership members
                await notification_service.notify_new_lead_to_dealership(
                    dealership_id=dealership_id,
                    lead_name=lead_name,
                    lead_id=lead.id,
                    lead_source="google_sheets"
                )
                
                logger.info(f"Sent new lead notifications for lead {lead.id} to dealership {dealership_id}")
                
            except Exception as e:
                logger.error(f"Failed to send notifications for lead {lead.id}: {e}")
        
    except Exception as e:
        logger.error(f"Failed to send new lead notifications: {e}")


async def send_new_lead_sms_notifications(session: AsyncSession, leads: List[Lead]):
    """
    DEPRECATED: Use send_new_lead_notifications instead.
    This function is kept for backward compatibility but will be removed in future versions.
    """
    logger.warning("send_new_lead_sms_notifications is deprecated. Use send_new_lead_notifications instead.")

