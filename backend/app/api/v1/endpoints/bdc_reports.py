"""
BDC export report endpoints — flexible lead filtering with guest QR codes.
"""
import logging
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.api.v1.endpoints.reports import require_reports_access
from app.core.timezone import utc_now
from app.db.database import get_db
from app.models.user import User
from app.services.bdc_report_service import BdcReportFilters, BdcReportService

logger = logging.getLogger(__name__)

router = APIRouter()


class BdcReportRowResponse(BaseModel):
    lead_id: str
    full_name: str
    email: str
    phone: str
    stage: str
    source: str
    lead_created: str
    dealership: str
    bdc_agent: str
    salesperson: str
    is_active: bool
    converted_at: str
    latest_appt_status: str
    latest_appt_date: str
    appt_count: int
    showroom_check_in: str
    lead_trust_score: Optional[float] = None
    guest_trust_score: Optional[float] = None
    guest_qr_url: str
    guest_auto_generated: bool


class BdcReportPreviewResponse(BaseModel):
    total: int
    items: List[BdcReportRowResponse]
    auto_generated_count: int
    missing_guest_count: int


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _build_filters(
    *,
    dealership_id: Optional[UUID],
    all_dealerships: bool,
    bdc_agent_id: Optional[UUID],
    assigned_to: Optional[UUID],
    stage_id: Optional[UUID],
    source: Optional[str],
    is_active: Optional[bool],
    search: Optional[str],
    lead_date_from: Optional[str],
    lead_date_to: Optional[str],
    sold_date_from: Optional[str],
    sold_date_to: Optional[str],
    appointment_date_from: Optional[str],
    appointment_date_to: Optional[str],
    appointment_statuses: Optional[str],
    appointment_funnel: Optional[str],
    has_appointment: Optional[bool],
    sold_only: bool,
    converted_only: bool,
) -> BdcReportFilters:
    statuses: List[str] = []
    if appointment_statuses:
        statuses = [s.strip() for s in appointment_statuses.split(",") if s.strip()]
    return BdcReportFilters(
        dealership_id=dealership_id,
        all_dealerships=all_dealerships,
        bdc_agent_id=bdc_agent_id,
        assigned_to=assigned_to,
        stage_id=stage_id,
        source=source,
        is_active=is_active,
        search=search,
        lead_date_from=_parse_dt(lead_date_from),
        lead_date_to=_parse_dt(lead_date_to),
        sold_date_from=_parse_dt(sold_date_from),
        sold_date_to=_parse_dt(sold_date_to),
        appointment_date_from=_parse_dt(appointment_date_from),
        appointment_date_to=_parse_dt(appointment_date_to),
        appointment_statuses=statuses,
        appointment_funnel=appointment_funnel,
        has_appointment=has_appointment,
        sold_only=sold_only,
        converted_only=converted_only,
    )


@router.get("/preview", response_model=BdcReportPreviewResponse)
async def preview_bdc_report(
    dealership_id: Optional[UUID] = Query(None),
    all_dealerships: bool = Query(False, description="Export across all accessible dealerships"),
    bdc_agent_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    lead_date_from: Optional[str] = Query(None),
    lead_date_to: Optional[str] = Query(None),
    sold_date_from: Optional[str] = Query(None),
    sold_date_to: Optional[str] = Query(None),
    appointment_date_from: Optional[str] = Query(None),
    appointment_date_to: Optional[str] = Query(None),
    appointment_statuses: Optional[str] = Query(None, description="Comma-separated appointment statuses"),
    appointment_funnel: Optional[str] = Query(
        None,
        description="scheduled | show_up | completed | sold | no_show | cancelled",
    ),
    has_appointment: Optional[bool] = Query(None),
    sold_only: bool = Query(False),
    converted_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_reports_access),
) -> Any:
    """Preview filtered leads before export (does not create guest profiles)."""
    filters = _build_filters(
        dealership_id=dealership_id,
        all_dealerships=all_dealerships,
        bdc_agent_id=bdc_agent_id,
        assigned_to=assigned_to,
        stage_id=stage_id,
        source=source,
        is_active=is_active,
        search=search,
        lead_date_from=lead_date_from,
        lead_date_to=lead_date_to,
        sold_date_from=sold_date_from,
        sold_date_to=sold_date_to,
        appointment_date_from=appointment_date_from,
        appointment_date_to=appointment_date_to,
        appointment_statuses=appointment_statuses,
        appointment_funnel=appointment_funnel,
        has_appointment=has_appointment,
        sold_only=sold_only,
        converted_only=converted_only,
    )
    try:
        rows, total = await BdcReportService.fetch_rows(
            db, current_user, filters, limit=limit, ensure_guests=False
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    items = [BdcReportRowResponse(**BdcReportService.row_to_dict(r)) for r in rows]
    missing_count = sum(1 for r in rows if not r.guest_qr_url)
    return BdcReportPreviewResponse(
        total=total,
        items=items,
        auto_generated_count=missing_count,
        missing_guest_count=missing_count,
    )


@router.get("/export")
async def export_bdc_report(
    dealership_id: Optional[UUID] = Query(None),
    all_dealerships: bool = Query(False, description="Export across all accessible dealerships"),
    bdc_agent_id: Optional[UUID] = Query(None),
    assigned_to: Optional[UUID] = Query(None),
    stage_id: Optional[UUID] = Query(None),
    source: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    lead_date_from: Optional[str] = Query(None),
    lead_date_to: Optional[str] = Query(None),
    sold_date_from: Optional[str] = Query(None),
    sold_date_to: Optional[str] = Query(None),
    appointment_date_from: Optional[str] = Query(None),
    appointment_date_to: Optional[str] = Query(None),
    appointment_statuses: Optional[str] = Query(None),
    appointment_funnel: Optional[str] = Query(None),
    has_appointment: Optional[bool] = Query(None),
    sold_only: bool = Query(False),
    converted_only: bool = Query(False),
    format: str = Query("zip", description="zip (pdf+xlsx+qr pngs), pdf, or xlsx"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_reports_access),
) -> Response:
    """Export filtered leads with guest QR codes. Auto-creates missing guest profiles."""
    filters = _build_filters(
        dealership_id=dealership_id,
        all_dealerships=all_dealerships,
        bdc_agent_id=bdc_agent_id,
        assigned_to=assigned_to,
        stage_id=stage_id,
        source=source,
        is_active=is_active,
        search=search,
        lead_date_from=lead_date_from,
        lead_date_to=lead_date_to,
        sold_date_from=sold_date_from,
        sold_date_to=sold_date_to,
        appointment_date_from=appointment_date_from,
        appointment_date_to=appointment_date_to,
        appointment_statuses=appointment_statuses,
        appointment_funnel=appointment_funnel,
        has_appointment=has_appointment,
        sold_only=sold_only,
        converted_only=converted_only,
    )
    try:
        rows, _ = await BdcReportService.fetch_rows(
            db, current_user, filters, limit=None, ensure_guests=True
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    stamp = utc_now().strftime("%Y%m%d_%H%M%S")
    if format == "pdf":
        content = BdcReportService.build_pdf(rows)
        filename = f"bdc-report_{stamp}.pdf"
        media_type = "application/pdf"
    elif format == "xlsx":
        content = BdcReportService.build_xlsx(rows)
        filename = f"bdc-report_{stamp}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        content = BdcReportService.build_zip(rows)
        filename = f"bdc-report_{stamp}.zip"
        media_type = "application/zip"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
