"""
Google Sheets Lead Sync Service

Fetches leads from Google Sheets and adds new ones to the database.
Supports dynamic sync sources configured via LeadSyncSource model.
"""
import logging
import csv
import io
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Set, Tuple

from dateutil import parser as dateutil_parser
import httpx

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, selectinload
from sqlalchemy import select, text

from app.models.lead import Lead, LeadSource
from app.models.customer import Customer
from app.services.customer_service import CustomerService
from app.services.lead_stage_service import LeadStageService
from app.models.dealership import Dealership
from app.models.activity import Activity, ActivityType
from app.models.lead_sync_source import LeadSyncSource
from app.models.campaign_mapping import CampaignMapping
from app.core.config import settings
from app.core.timezone import utc_now
from app.db.database import get_engine_url_and_connect_args

logger = logging.getLogger(__name__)

# Legacy hardcoded configuration (for backward compatibility)
LEGACY_GOOGLE_SHEET_ID = "1_7Qdzgjj9Ye5V7ZW0_gYblqU8V9pkbjDjkahTl8O4kI"
LEGACY_GOOGLE_SHEET_GID = "0"


def get_sync_session_maker():
    """Create a dedicated engine and session maker for sync operations."""
    from sqlalchemy.pool import NullPool
    url, connect_args = get_engine_url_and_connect_args()
    engine = create_async_engine(
        url,
        echo=False,
        poolclass=NullPool,
        connect_args=connect_args,
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
    
    cleaned = ''.join(c for c in phone if c.isdigit() or c == '+')
    return cleaned if cleaned else None


def _get_first_non_empty(row: Dict[str, str], *keys: str) -> Optional[str]:
    """Get first non-empty value from row for any of the given keys."""
    for k in keys:
        v = (row.get(k) or '').strip()
        if v:
            return v
    row_lower_to_key = {key.lower(): key for key in row}
    for k in keys:
        kl = k.lower()
        if kl in row_lower_to_key:
            v = (row.get(row_lower_to_key[kl]) or '').strip()
            if v:
                return v
    return None


def _parse_created_time(created_time_str: str) -> Optional[datetime]:
    """Parse created_time string to timezone-aware datetime."""
    if not (created_time_str or "").strip():
        return None
    try:
        dt = dateutil_parser.parse(created_time_str.strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def find_matching_campaign(
    campaign_name: str,
    mappings: List[CampaignMapping]
) -> Optional[CampaignMapping]:
    """Find the first matching campaign mapping for a given campaign name."""
    if not campaign_name or not mappings:
        return None
    
    sorted_mappings = sorted(mappings, key=lambda m: m.priority)
    
    for mapping in sorted_mappings:
        if not mapping.is_active:
            continue
        if mapping.matches(campaign_name):
            return mapping
    
    return None


def parse_sheet_row(
    row: Dict[str, str],
    headers: List[str],
    sync_source: Optional[LeadSyncSource] = None,
    campaign_mappings: Optional[List[CampaignMapping]] = None,
) -> Optional[Dict[str, Any]]:
    """Parse a single row from the Google Sheet into lead data."""
    try:
        full_name = row.get('full_name', '').strip()
        if not full_name:
            return None
        
        phone = row.get('phone_number', '')
        phone = clean_phone(phone)
        if not phone:
            return None
        
        first_name, last_name = parse_full_name(full_name)
        
        lead_id_col = row.get('lead_id_col', '').strip()
        if lead_id_col.startswith('l:'):
            sheet_lead_id = lead_id_col
            external_id = lead_id_col
        else:
            sheet_lead_id = None
            external_id = f"sheet:{phone}"
        
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
        
        location = row.get('location', '').strip()
        origin = row.get('origin', '').strip()
        sheet_status = row.get('lead_status', 'CREATED').strip()
        platform = row.get('platform', '').strip()
        
        campaign_name = (
            row.get('campaign_name', '') or row.get('Campaign', '') or 
            row.get('campaign', '') or row.get('Lead Type', '') or row.get('lead_type', '')
        ).strip()
        campaign_id = row.get('campaign_id', '').strip()
        ad_name = row.get('ad_name', '').strip()
        ad_id = row.get('ad_id', '').strip()
        adset_name = row.get('adset_name', '').strip()
        adset_id = row.get('adset_id', '').strip()
        form_name = row.get('form_name', '').strip()
        form_id = row.get('form_id', '').strip()
        is_organic = row.get('is_organic', '').strip()
        created_time = row.get('created_time', '').strip()
        
        # Find matching campaign mapping
        matched_mapping = None
        source_display = None
        target_dealership_id = None
        
        if campaign_mappings:
            matched_mapping = find_matching_campaign(campaign_name, campaign_mappings)
            if matched_mapping:
                source_display = matched_mapping.display_name
                target_dealership_id = matched_mapping.dealership_id
        
        # Fall back to sync source default dealership
        if not target_dealership_id and sync_source:
            target_dealership_id = sync_source.default_dealership_id
            if not source_display and sync_source.default_campaign_display:
                source_display = sync_source.default_campaign_display
        
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
        
        if source_display:
            meta_data['source_display'] = source_display
        
        # Parse financial columns
        downpayment = _get_first_non_empty(
            row, 'downpayment', 'down_payment', 'Down Payment', 'Down payment', 'down payment'
        )
        loan_amount = _get_first_non_empty(
            row, 'loan_amount', 'Loan Amount', 'Loan amount', 'loan amount'
        )
        vehicle_price = _get_first_non_empty(
            row, 'vehicle_price', 'Vehicle Price', 'Vehicle price', 'vehicle price', 'price'
        )
        if downpayment:
            meta_data['downpayment'] = downpayment
        if loan_amount:
            meta_data['loan_amount'] = loan_amount
        if vehicle_price:
            meta_data['vehicle_price'] = vehicle_price
        
        created_at = None
        if platform.lower() in ('fb', 'ig'):
            parsed = _parse_created_time(created_time)
            if parsed:
                created_at = parsed
        
        return {
            'external_id': external_id,
            'first_name': first_name,
            'last_name': last_name,
            'phone': phone,
            'source': LeadSource.GOOGLE_SHEETS,
            'notes': notes,
            'meta_data': meta_data,
            'created_at': created_at,
            'campaign_name_raw': campaign_name,
            'matched_mapping': matched_mapping,
            'target_dealership_id': target_dealership_id,
        }
        
    except Exception as e:
        logger.error(f"Error parsing sheet row: {e}")
        return None


async def fetch_sheet_data_from_url(export_url: str) -> tuple[List[Dict[str, str]], List[str]]:
    """Fetch data from a Google Sheet URL."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(export_url, follow_redirects=True)
            response.raise_for_status()
            
            content = response.text
            reader = csv.reader(io.StringIO(content))
            
            headers = next(reader, [])
            if not headers:
                logger.warning("No headers found in Google Sheet")
                return [], []
            
            rows = []
            for row_values in reader:
                if not row_values:
                    continue
                    
                row_dict = {}
                for i, value in enumerate(row_values):
                    if i == 0:
                        row_dict['lead_id_col'] = value.strip() if value else ''
                    elif i < len(headers):
                        header = headers[i]
                        if header and header not in row_dict:
                            row_dict[header] = value.strip() if value else ''
                
                rows.append(row_dict)
            
            logger.info(f"Fetched {len(rows)} rows from Google Sheet with {len(headers)} columns")
            return rows, headers
            
    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching Google Sheet: {e}")
        return [], []
    except Exception as e:
        logger.error(f"Error fetching Google Sheet: {e}")
        return [], []


async def fetch_sheet_data() -> tuple[List[Dict[str, str]], List[str]]:
    """Legacy function for backward compatibility."""
    export_url = f"https://docs.google.com/spreadsheets/d/{LEGACY_GOOGLE_SHEET_ID}/export?format=csv&gid={LEGACY_GOOGLE_SHEET_GID}"
    return await fetch_sheet_data_from_url(export_url)


async def fetch_sheet_data_raw(sheet_id: str, sheet_gid: str = "0") -> List[Dict[str, str]]:
    """
    Fetch raw data from a Google Sheet by sheet ID and GID.
    Used for previewing sheets before creating a sync source.
    Returns list of row dictionaries.
    """
    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={sheet_gid}"
    rows, headers = await fetch_sheet_data_from_url(export_url)
    return rows


async def get_existing_external_ids(session: AsyncSession) -> Set[str]:
    """Get all existing external_ids in one query."""
    result = await session.execute(
        select(Lead.external_id).where(Lead.external_id.isnot(None))
    )
    return {row[0] for row in result.fetchall()}


async def get_existing_leads_by_external_id(
    session: AsyncSession, external_ids: Set[str]
) -> Dict[str, Lead]:
    """Get existing leads by external_id."""
    if not external_ids:
        return {}
    result = await session.execute(
        select(Lead).where(Lead.external_id.in_(external_ids))
    )
    leads = result.scalars().all()
    return {lead.external_id: lead for lead in leads}


async def get_existing_phones(session: AsyncSession) -> Set[str]:
    """Get all existing phone numbers from customers who have leads."""
    result = await session.execute(
        select(Customer.phone).join(Lead, Lead.customer_id == Customer.id).where(Customer.phone.isnot(None))
    )
    return {row[0] for row in result.fetchall()}


def _empty_sync_result(error: Optional[str] = None) -> Dict[str, Any]:
    return {
        "sheet_total_rows": 0,
        "sheet_valid_leads": 0,
        "new_added": 0,
        "new_leads": 0,
        "leads_updated": 0,
        "updated_leads": 0,
        "duplicates_skipped": 0,
        "skipped_leads": 0,
        "skipped_invalid": 0,
        "error": error,
        "errors": [error] if error else [],
    }


async def sync_leads_from_source(source: LeadSyncSource) -> Dict[str, Any]:
    """
    Sync leads from a specific LeadSyncSource.
    Returns stats about the sync operation.
    """
    logger.info(f"Starting sync for source: {source.name} (id: {source.id})")
    
    sync_session_maker = get_sync_session_maker()
    
    try:
        # Fetch data from sheet
        rows, headers = await fetch_sheet_data_from_url(source.export_url)
        
        if not rows:
            logger.info(f"No data fetched from source {source.name}")
            return _empty_sync_result("No data from sheet")
        
        sheet_total_rows = len(rows)
        
        async with sync_session_maker() as session:
            try:
                # Merge source into this session so updates (last_synced_at, etc.) are persisted
                source = await session.merge(source)
                
                # Get campaign mappings for this source
                mappings_result = await session.execute(
                    select(CampaignMapping).where(
                        CampaignMapping.sync_source_id == source.id,
                        CampaignMapping.is_active == True
                    ).order_by(CampaignMapping.priority)
                )
                campaign_mappings = list(mappings_result.scalars().all())
                
                # Parse all rows
                parsed_leads = []
                skipped_invalid = 0
                
                for row in rows:
                    lead_data = parse_sheet_row(row, headers, source, campaign_mappings)
                    if lead_data:
                        parsed_leads.append(lead_data)
                    else:
                        skipped_invalid += 1
                
                sheet_valid_leads = len(parsed_leads)
                if not parsed_leads:
                    logger.info(f"No valid leads to process from source {source.name}")
                    return {
                        "sheet_total_rows": sheet_total_rows,
                        "sheet_valid_leads": 0,
                        "new_added": 0,
                        "new_leads": 0,
                        "leads_updated": 0,
                        "updated_leads": 0,
                        "duplicates_skipped": 0,
                        "skipped_leads": 0,
                        "skipped_invalid": skipped_invalid,
                        "error": None,
                        "errors": [],
                    }
                
                # Check for duplicates
                sheet_external_ids = {ld["external_id"] for ld in parsed_leads}
                existing_leads_map = await get_existing_leads_by_external_id(session, sheet_external_ids)
                existing_phones = await get_existing_phones(session)
                
                tracked_external_ids: Set[str] = set()
                tracked_phones: Set[str] = set()
                
                new_leads_data: List[Dict[str, Any]] = []
                updated_count = 0
                duplicate_count = 0
                
                for lead_data in parsed_leads:
                    ext_id = lead_data["external_id"]
                    phone = lead_data.get("phone")
                    
                    if ext_id in existing_leads_map:
                        # Update existing lead
                        lead = existing_leads_map[ext_id]
                        if lead_data.get("created_at"):
                            lead.created_at = lead_data["created_at"]
                        lead.meta_data = {**(lead.meta_data or {}), **lead_data["meta_data"]}
                        # Update sync source reference if not set
                        if not lead.sync_source_id:
                            lead.sync_source_id = source.id
                        # Always update source_campaign_raw from sheet data
                        if lead_data.get("campaign_name_raw"):
                            lead.source_campaign_raw = lead_data["campaign_name_raw"]
                        # Update campaign mapping if not set and increment count
                        matched_mapping = lead_data.get("matched_mapping")
                        if matched_mapping and not lead.campaign_mapping_id:
                            lead.campaign_mapping_id = matched_mapping.id
                            matched_mapping.leads_matched += 1
                        updated_count += 1
                    elif ext_id in tracked_external_ids or (phone and phone in tracked_phones):
                        duplicate_count += 1
                    elif phone and phone in existing_phones:
                        duplicate_count += 1
                    else:
                        new_leads_data.append(lead_data)
                        if ext_id:
                            tracked_external_ids.add(ext_id)
                        if phone:
                            tracked_phones.add(phone)
                
                # Create new leads
                created_leads = []
                if new_leads_data:
                    for lead_data in new_leads_data:
                        target_dealership_id = lead_data.get("target_dealership_id") or source.default_dealership_id
                        
                        default_stage = await LeadStageService.get_default_stage(session, target_dealership_id)
                        
                        customer, _ = await CustomerService.find_or_create(
                            session,
                            phone=lead_data['phone'],
                            email=None,
                            first_name=lead_data['first_name'],
                            last_name=lead_data['last_name'],
                            source="google_sheets",
                        )
                        
                        matched_mapping = lead_data.get("matched_mapping")
                        
                        lead_kwargs: Dict[str, Any] = {
                            "customer_id": customer.id,
                            "stage_id": default_stage.id,
                            "source": lead_data["source"],
                            "notes": lead_data["notes"],
                            "meta_data": lead_data["meta_data"],
                            "external_id": lead_data["external_id"],
                            "dealership_id": target_dealership_id,
                            "assigned_to": None,
                            "created_by": None,
                            "sync_source_id": source.id,
                            "campaign_mapping_id": matched_mapping.id if matched_mapping else None,
                            "source_campaign_raw": lead_data.get("campaign_name_raw"),
                        }
                        
                        if lead_data.get("created_at"):
                            lead_kwargs["created_at"] = lead_data["created_at"]
                        
                        new_lead = Lead(**lead_kwargs)
                        session.add(new_lead)
                        created_leads.append(new_lead)
                        
                        # Update mapping stats
                        if matched_mapping:
                            matched_mapping.leads_matched += 1
                    
                    await session.flush()
                    
                    # Create activities
                    for lead in created_leads:
                        activity = Activity(
                            type=ActivityType.LEAD_CREATED,
                            description=f"Lead created from {source.display_name} sync",
                            user_id=None,
                            lead_id=lead.id,
                            dealership_id=lead.dealership_id,
                            meta_data={
                                "source": "google_sheets",
                                "sync_source_id": str(source.id),
                                "sync_source_name": source.name,
                                "external_id": lead.external_id,
                            }
                        )
                        session.add(activity)
                
                # Update sync source stats
                source.last_synced_at = utc_now()
                source.last_sync_lead_count = len(created_leads)
                source.total_leads_synced += len(created_leads)
                source.last_sync_error = None
                
                await session.commit()
                
                # Emit notifications for new leads
                if created_leads:
                    for lead in created_leads:
                        try:
                            from app.services.notification_service import (
                                emit_lead_created,
                                notify_lead_assigned_to_dealership_background,
                            )
                            source_display = (lead.meta_data or {}).get("source_display") or source.display_name
                            await emit_lead_created(
                                str(lead.id),
                                str(lead.dealership_id) if lead.dealership_id else None,
                                {
                                    "first_name": lead.first_name,
                                    "last_name": lead.last_name,
                                    "phone": lead.phone,
                                    "source": source_display,
                                }
                            )
                            
                            if lead.dealership_id:
                                lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "New Lead"
                                await notify_lead_assigned_to_dealership_background(
                                    lead_id=lead.id,
                                    lead_name=lead_name,
                                    dealership_id=lead.dealership_id,
                                    source=source_display,
                                )
                        except Exception as e:
                            logger.warning(f"Failed to emit notification for lead {lead.id}: {e}")
                    
                    try:
                        from app.services.notification_service import emit_badges_refresh
                        await emit_badges_refresh(unassigned=True)
                    except Exception as e:
                        logger.warning(f"Failed to emit badges refresh: {e}")
                
                result = {
                    "sheet_total_rows": sheet_total_rows,
                    "sheet_valid_leads": sheet_valid_leads,
                    "new_added": len(created_leads),
                    "new_leads": len(created_leads),
                    "leads_updated": updated_count,
                    "updated_leads": updated_count,
                    "duplicates_skipped": duplicate_count,
                    "skipped_leads": duplicate_count,
                    "skipped_invalid": skipped_invalid,
                    "error": None,
                    "errors": [],
                }
                
                logger.info(
                    f"Sync complete for {source.name}: "
                    f"{len(created_leads)} new, {updated_count} updated, "
                    f"{duplicate_count} duplicates, {skipped_invalid} invalid"
                )
                
                return result
                
            except Exception as e:
                await session.rollback()
                logger.error(f"Sync failed for source {source.name}: {e}")
                
                # Update error status
                async with sync_session_maker() as error_session:
                    source_update = await error_session.get(LeadSyncSource, source.id)
                    if source_update:
                        source_update.last_sync_error = str(e)
                        await error_session.commit()
                
                raise
    
    except Exception as e:
        logger.error(f"Sync failed for source {source.name}: {e}")
        return _empty_sync_result(str(e))


async def fetch_sheet_preview(source: LeadSyncSource, limit: int = 10) -> Dict[str, Any]:
    """Fetch preview data from a sync source sheet."""
    try:
        rows, headers = await fetch_sheet_data_from_url(source.export_url)
        
        if not rows:
            return {
                "total_rows": 0,
                "sample_rows": [],
                "unique_campaigns": [],
                "unmapped_campaigns": [],
            }
        
        # Get campaign mappings
        sync_session_maker = get_sync_session_maker()
        async with sync_session_maker() as session:
            mappings_result = await session.execute(
                select(CampaignMapping).where(
                    CampaignMapping.sync_source_id == source.id,
                    CampaignMapping.is_active == True
                )
            )
            campaign_mappings = list(mappings_result.scalars().all())
        
        # Extract unique campaigns
        campaigns = set()
        for row in rows:
            campaign_name = (
                row.get('campaign_name', '') or row.get('Campaign', '') or 
                row.get('campaign', '') or row.get('Lead Type', '') or row.get('lead_type', '')
            ).strip()
            if campaign_name:
                campaigns.add(campaign_name)
        
        # Find unmapped campaigns
        unmapped = []
        for campaign in campaigns:
            mapping = find_matching_campaign(campaign, campaign_mappings)
            if not mapping:
                unmapped.append(campaign)
        
        # Build sample rows
        sample_rows = []
        for i, row in enumerate(rows[:limit]):
            full_name = row.get('full_name', '').strip()
            phone = clean_phone(row.get('phone_number', ''))
            email = row.get('email', '').strip()
            campaign_name = (
                row.get('campaign_name', '') or row.get('Campaign', '') or 
                row.get('campaign', '') or row.get('Lead Type', '') or row.get('lead_type', '')
            ).strip()
            
            matched_mapping = find_matching_campaign(campaign_name, campaign_mappings)
            
            sample_rows.append({
                "row_number": i + 2,  # Account for header row
                "full_name": full_name or None,
                "phone": phone,
                "email": email or None,
                "campaign_name": campaign_name or None,
                "matched_mapping": matched_mapping.display_name if matched_mapping else None,
                "target_dealership": None,  # Would need to fetch dealership name
            })
        
        return {
            "total_rows": len(rows),
            "sample_rows": sample_rows,
            "unique_campaigns": sorted(list(campaigns)),
            "unmapped_campaigns": sorted(unmapped),
        }
    
    except Exception as e:
        logger.error(f"Preview failed for source {source.name}: {e}")
        raise


async def sync_google_sheet_leads() -> Dict[str, Any]:
    """
    Main sync function - syncs from all active sources.
    Returns combined stats.
    """
    logger.info("Starting Google Sheet lead sync (all sources)...")
    
    sync_session_maker = get_sync_session_maker()
    
    try:
        async with sync_session_maker() as session:
            # Get all active sync sources
            result = await session.execute(
                select(LeadSyncSource).where(LeadSyncSource.is_active == True)
            )
            sources = result.scalars().all()
        
        if not sources:
            logger.info("No active sync sources configured - using legacy sync")
            return await _legacy_sync_google_sheet_leads()
        
        # Sync each source
        total_stats = {
            "sheet_total_rows": 0,
            "sheet_valid_leads": 0,
            "new_added": 0,
            "leads_updated": 0,
            "duplicates_skipped": 0,
            "skipped_invalid": 0,
            "sources_synced": 0,
            "errors": [],
        }
        
        for source in sources:
            try:
                stats = await sync_leads_from_source(source)
                total_stats["sheet_total_rows"] += stats.get("sheet_total_rows", 0)
                total_stats["sheet_valid_leads"] += stats.get("sheet_valid_leads", 0)
                total_stats["new_added"] += stats.get("new_added", 0)
                total_stats["leads_updated"] += stats.get("leads_updated", 0)
                total_stats["duplicates_skipped"] += stats.get("duplicates_skipped", 0)
                total_stats["skipped_invalid"] += stats.get("skipped_invalid", 0)
                total_stats["sources_synced"] += 1
                
                if stats.get("error"):
                    total_stats["errors"].append(f"{source.name}: {stats['error']}")
            
            except Exception as e:
                logger.error(f"Failed to sync source {source.name}: {e}")
                total_stats["errors"].append(f"{source.name}: {str(e)}")
        
        logger.info(f"Sync complete: {total_stats['sources_synced']} sources, {total_stats['new_added']} new leads")
        
        return total_stats
    
    except Exception as e:
        logger.error(f"Google Sheet sync failed: {e}")
        return _empty_sync_result(str(e))


async def _legacy_sync_google_sheet_leads() -> Dict[str, Any]:
    """
    Legacy sync function for backward compatibility.
    Used when no LeadSyncSource is configured.
    """
    logger.info("Running legacy Google Sheet sync...")
    
    try:
        rows, headers = await fetch_sheet_data()
        
        if not rows:
            return _empty_sync_result("No data from sheet")
        
        sheet_total_rows = len(rows)
        
        parsed_leads = []
        skipped_invalid = 0
        
        for row in rows:
            lead_data = parse_sheet_row(row, headers, None, None)
            if lead_data:
                parsed_leads.append(lead_data)
            else:
                skipped_invalid += 1
        
        sheet_valid_leads = len(parsed_leads)
        if not parsed_leads:
            return {
                "sheet_total_rows": sheet_total_rows,
                "sheet_valid_leads": 0,
                "new_added": 0,
                "leads_updated": 0,
                "duplicates_skipped": 0,
                "skipped_invalid": skipped_invalid,
                "error": None,
            }
        
        sync_session_maker = get_sync_session_maker()
        
        new_leads_count = 0
        updated_count = 0
        duplicate_count = 0
        
        async with sync_session_maker() as session:
            try:
                # Look up Toyota South Atlanta dealership
                toyota_south_result = await session.execute(
                    select(Dealership).where(
                        Dealership.name.ilike("%Toyota South Atlanta%")
                    )
                )
                toyota_south = toyota_south_result.scalar_one_or_none()
                target_dealership_id = toyota_south.id if toyota_south else None
                
                sheet_external_ids = {ld["external_id"] for ld in parsed_leads}
                existing_leads_map = await get_existing_leads_by_external_id(session, sheet_external_ids)
                existing_phones = await get_existing_phones(session)
                tracked_external_ids: Set[str] = set()
                tracked_phones: Set[str] = set()
                
                new_leads: List[Dict[str, Any]] = []
                for lead_data in parsed_leads:
                    ext_id = lead_data["external_id"]
                    phone = lead_data.get("phone")
                    
                    if ext_id in existing_leads_map:
                        lead = existing_leads_map[ext_id]
                        if lead_data.get("created_at"):
                            lead.created_at = lead_data["created_at"]
                        lead.meta_data = {**(lead.meta_data or {}), **lead_data["meta_data"]}
                        updated_count += 1
                    elif ext_id in tracked_external_ids or (phone and phone in tracked_phones):
                        duplicate_count += 1
                    elif phone and phone in existing_phones:
                        duplicate_count += 1
                    else:
                        new_leads.append(lead_data)
                        if ext_id:
                            tracked_external_ids.add(ext_id)
                        if phone:
                            tracked_phones.add(phone)
                
                created_leads = []
                if new_leads:
                    default_stage = await LeadStageService.get_default_stage(session, target_dealership_id)
                    
                    for lead_data in new_leads:
                        customer, _ = await CustomerService.find_or_create(
                            session,
                            phone=lead_data['phone'],
                            email=None,
                            first_name=lead_data['first_name'],
                            last_name=lead_data['last_name'],
                            source="google_sheets",
                        )
                        
                        lead_kwargs: Dict[str, Any] = {
                            "customer_id": customer.id,
                            "stage_id": default_stage.id,
                            "source": lead_data["source"],
                            "notes": lead_data["notes"],
                            "meta_data": lead_data["meta_data"],
                            "external_id": lead_data["external_id"],
                            "dealership_id": target_dealership_id,
                            "assigned_to": None,
                            "created_by": None,
                        }
                        if lead_data.get("created_at"):
                            lead_kwargs["created_at"] = lead_data["created_at"]
                        
                        new_lead = Lead(**lead_kwargs)
                        session.add(new_lead)
                        created_leads.append(new_lead)
                    
                    await session.flush()
                    
                    for lead in created_leads:
                        activity = Activity(
                            type=ActivityType.LEAD_CREATED,
                            description="Lead created from Google Sheets import",
                            user_id=None,
                            lead_id=lead.id,
                            dealership_id=lead.dealership_id,
                            meta_data={
                                "source": "google_sheets",
                                "external_id": lead.external_id,
                            }
                        )
                        session.add(activity)
                    
                    new_leads_count = len(new_leads)
                
                await session.commit()
                
                # Emit notifications
                if created_leads:
                    for lead in created_leads:
                        try:
                            from app.services.notification_service import (
                                emit_lead_created,
                                notify_lead_assigned_to_dealership_background,
                            )
                            source_display = (lead.meta_data or {}).get("source_display") or "google_sheets"
                            await emit_lead_created(
                                str(lead.id),
                                str(lead.dealership_id) if lead.dealership_id else None,
                                {
                                    "first_name": lead.first_name,
                                    "last_name": lead.last_name,
                                    "phone": lead.phone,
                                    "source": source_display,
                                }
                            )
                            
                            if lead.dealership_id:
                                lead_name = f"{lead.first_name} {lead.last_name or ''}".strip() or "New Lead"
                                await notify_lead_assigned_to_dealership_background(
                                    lead_id=lead.id,
                                    lead_name=lead_name,
                                    dealership_id=lead.dealership_id,
                                    source=source_display,
                                )
                        except Exception as e:
                            logger.warning(f"Failed to emit notification for lead {lead.id}: {e}")
                    
                    if new_leads_count > 0:
                        try:
                            from app.services.notification_service import emit_badges_refresh
                            await emit_badges_refresh(unassigned=True)
                        except Exception as e:
                            logger.warning(f"Failed to emit badges refresh: {e}")
                
            except Exception as e:
                await session.rollback()
                raise
        
        return {
            "sheet_total_rows": sheet_total_rows,
            "sheet_valid_leads": sheet_valid_leads,
            "new_added": new_leads_count,
            "leads_updated": updated_count,
            "duplicates_skipped": duplicate_count,
            "skipped_invalid": skipped_invalid,
            "error": None,
        }
    
    except Exception as e:
        logger.error(f"Legacy Google Sheet sync failed: {e}")
        return _empty_sync_result(str(e))


async def send_new_lead_notifications(session: AsyncSession, leads: List[Lead], dealership_id: str):
    """Send notifications for new leads to all dealership team members."""
    try:
        from app.services.notification_service import NotificationService
        
        notification_service = NotificationService(session)
        
        for lead in leads:
            try:
                lead_name = f"{lead.first_name} {lead.last_name or ''}".strip()
                lead_source = (lead.meta_data or {}).get("source_display") or "google_sheets"
                await notification_service.notify_new_lead_to_dealership(
                    dealership_id=dealership_id,
                    lead_name=lead_name,
                    lead_id=lead.id,
                    lead_source=lead_source
                )
            except Exception as e:
                logger.error(f"Failed to send notifications for lead {lead.id}: {e}")
        
    except Exception as e:
        logger.error(f"Failed to send new lead notifications: {e}")
