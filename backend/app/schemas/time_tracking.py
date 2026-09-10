"""
Pydantic schemas for BDC time tracking and payouts.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ClockInRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ClockOutRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class SetHourlyRateRequest(BaseModel):
    hourly_rate: Decimal = Field(..., ge=0, le=10000)


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
    total_hours: Decimal
    regular_pay: Decimal
    overtime_pay: Decimal
    estimated_pay: Decimal


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


class DailyPayoutRow(BaseModel):
    date: str
    weekday: str
    regular_hours: Decimal
    overtime_hours: Decimal
    total_hours: Decimal
    estimated_pay: Decimal
    entry_count: int


class PayoutSummaryResponse(BaseModel):
    period: str
    timezone: str
    period_start: datetime
    period_end: datetime
    hourly_rate: Optional[Decimal] = None
    overtime_multiplier: Decimal
    overtime_threshold_hours: Decimal
    totals: HoursBreakdown
    days: List[DailyPayoutRow]
    entries: List[TimeEntryResponse]


class AgentRosterItem(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: str
    is_active: bool
    hourly_rate: Optional[Decimal] = None
    is_clocked_in: bool
    clock_in_at: Optional[datetime] = None
    elapsed_seconds: int = 0
    this_week: HoursBreakdown
    this_month: HoursBreakdown
    today: HoursBreakdown


class AgentRosterResponse(BaseModel):
    items: List[AgentRosterItem]
    clocked_in_count: int
    team_week: HoursBreakdown
    team_month: HoursBreakdown
