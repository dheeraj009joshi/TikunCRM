"""
Pydantic schemas for BDC time tracking and payouts.
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ClockInRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ClockOutRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class SetHourlyRateRequest(BaseModel):
    hourly_rate: Decimal = Field(..., ge=0, le=10000)


class HourCaps(BaseModel):
    """Payable hour limits for one agent. Null means no cap for that slot."""
    max_hours_week: Optional[Decimal] = Field(None, ge=0, le=168)
    monday: Optional[Decimal] = Field(None, ge=0, le=24)
    tuesday: Optional[Decimal] = Field(None, ge=0, le=24)
    wednesday: Optional[Decimal] = Field(None, ge=0, le=24)
    thursday: Optional[Decimal] = Field(None, ge=0, le=24)
    friday: Optional[Decimal] = Field(None, ge=0, le=24)
    saturday: Optional[Decimal] = Field(None, ge=0, le=24)
    sunday: Optional[Decimal] = Field(None, ge=0, le=24)


class SetHourCapsRequest(HourCaps):
    pass


class ApproveOverCapRequest(BaseModel):
    approved: bool = True


class ApproveOverCapDayRequest(BaseModel):
    date: str = Field(..., min_length=10, max_length=10, description="Local calendar date YYYY-MM-DD")
    approved: bool = True
    timezone: Optional[str] = None


class TimeEntryEditRequest(BaseModel):
    clock_in_at: Optional[datetime] = None
    clock_out_at: Optional[datetime] = None
    notes: Optional[str] = Field(None, max_length=500)
    reason: str = Field(..., min_length=1, max_length=500)


class TimeEntryUserBrief(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: str

    class Config:
        from_attributes = True


class TimeEntryResponse(BaseModel):
    id: UUID
    user_id: UUID
    clock_in_at: datetime
    clock_out_at: Optional[datetime] = None
    hourly_rate: Optional[Decimal] = None
    overtime_multiplier: Decimal
    clock_in_note: Optional[str] = None
    notes: Optional[str] = None
    source: str
    is_open: bool
    duration_seconds: int
    edited_at: Optional[datetime] = None
    edit_reason: Optional[str] = None
    over_cap_approved: bool = False
    over_cap_approved_at: Optional[datetime] = None
    user: Optional[TimeEntryUserBrief] = None

    class Config:
        from_attributes = True


class TimeEntryListResponse(BaseModel):
    items: List[TimeEntryResponse]
    total: int
    page: int
    page_size: int


class HoursBreakdown(BaseModel):
    regular_hours: Decimal
    overtime_hours: Decimal
    unpaid_hours: Decimal = Decimal("0.00")
    payable_hours: Decimal = Decimal("0.00")
    total_hours: Decimal
    regular_pay: Decimal
    overtime_pay: Decimal
    estimated_pay: Decimal


class CallWorkStats(BaseModel):
    """Talk time from connected phone calls — independent of clock-in hours."""
    talk_seconds: int = 0
    talk_hours: Decimal = Decimal("0.00")
    call_count: int = 0
    inbound_count: int = 0
    outbound_count: int = 0
    avg_call_seconds: int = 0
    utilization_pct: Optional[Decimal] = None


class ShiftActivityItem(BaseModel):
    """A CRM action that happened while the agent was clocked in."""
    id: UUID
    type: str
    description: str
    created_at: datetime
    lead_id: Optional[UUID] = None
    lead_name: Optional[str] = None
    time_entry_id: Optional[UUID] = None
    meta_data: Dict[str, Any] = Field(default_factory=dict)


class ClockStatusResponse(BaseModel):
    is_clocked_in: bool
    current_entry: Optional[TimeEntryResponse] = None
    elapsed_seconds: int = 0
    hourly_rate: Optional[Decimal] = None
    overtime_multiplier: Decimal
    overtime_threshold_hours: Decimal
    rate_missing: bool
    long_shift_warning: bool
    today: HoursBreakdown
    this_week: HoursBreakdown
    this_month: HoursBreakdown
    today_calls: CallWorkStats = Field(default_factory=CallWorkStats)
    this_week_calls: CallWorkStats = Field(default_factory=CallWorkStats)
    this_month_calls: CallWorkStats = Field(default_factory=CallWorkStats)
    on_call: bool = False
    current_call_seconds: int = 0
    hour_caps: HourCaps = Field(default_factory=HourCaps)
    over_cap_warning: bool = False


class DailyPayoutRow(BaseModel):
    date: str
    weekday: str
    regular_hours: Decimal
    overtime_hours: Decimal
    unpaid_hours: Decimal = Decimal("0.00")
    payable_hours: Decimal = Decimal("0.00")
    total_hours: Decimal
    estimated_pay: Decimal
    entry_count: int
    daily_cap: Optional[Decimal] = None
    over_cap_approved: bool = False
    call_work: CallWorkStats = Field(default_factory=CallWorkStats)


class PayoutSummaryResponse(BaseModel):
    period: str
    timezone: str
    period_start: datetime
    period_end: datetime
    hourly_rate: Optional[Decimal] = None
    overtime_multiplier: Decimal
    overtime_threshold_hours: Decimal
    totals: HoursBreakdown
    hour_caps: HourCaps = Field(default_factory=HourCaps)
    call_work: CallWorkStats = Field(default_factory=CallWorkStats)
    days: List[DailyPayoutRow]
    entries: List[TimeEntryResponse]
    activities: List[ShiftActivityItem] = Field(default_factory=list)


class AgentRosterItem(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: str
    is_active: bool
    hourly_rate: Optional[Decimal] = None
    hour_caps: HourCaps = Field(default_factory=HourCaps)
    is_clocked_in: bool
    clock_in_at: Optional[datetime] = None
    elapsed_seconds: int = 0
    on_call: bool = False
    this_week: HoursBreakdown
    this_month: HoursBreakdown
    today: HoursBreakdown
    today_calls: CallWorkStats = Field(default_factory=CallWorkStats)
    this_week_calls: CallWorkStats = Field(default_factory=CallWorkStats)


class AgentRosterResponse(BaseModel):
    items: List[AgentRosterItem]
    clocked_in_count: int
    on_call_count: int = 0
    team_week: HoursBreakdown
    team_month: HoursBreakdown
    team_week_calls: CallWorkStats = Field(default_factory=CallWorkStats)
