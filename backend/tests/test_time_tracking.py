"""Unit tests for BDC time-tracking overtime classification."""
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytz

from app.services.time_tracking_service import (
    OT_MULTIPLIER,
    classify_entries,
    period_bounds,
    q2,
    utilization_pct,
    _call_work_from_rows,
)
from app.schemas.time_tracking import HourCaps
from app.models.call_log import CallDirection, CallStatus


TZ = pytz.timezone("America/New_York")


def _punch(
    local_start: datetime,
    hours: float,
    rate: str = "20.00",
    over_cap_approved: bool = False,
) -> SimpleNamespace:
    start = TZ.localize(local_start) if local_start.tzinfo is None else local_start
    end = start + timedelta(hours=hours)
    return SimpleNamespace(
        clock_in_at=start.astimezone(pytz.UTC),
        clock_out_at=end.astimezone(pytz.UTC),
        hourly_rate=Decimal(rate),
        overtime_multiplier=OT_MULTIPLIER,
        over_cap_approved=over_cap_approved,
    )


class TestOvertimeClassification:
    def test_under_40_hours_all_regular(self):
        # Monday Sep 7 2026
        entries = [
            _punch(datetime(2026, 9, 7, 9, 0), 8),
            _punch(datetime(2026, 9, 8, 9, 0), 8),
            _punch(datetime(2026, 9, 9, 9, 0), 8),
        ]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end)
        assert totals.regular_hours == Decimal("24.00")
        assert totals.overtime_hours == Decimal("0.00")
        assert totals.estimated_pay == Decimal("480.00")

    def test_hours_over_40_become_overtime(self):
        entries = [
            _punch(datetime(2026, 9, 7, 9, 0), 10),
            _punch(datetime(2026, 9, 8, 9, 0), 10),
            _punch(datetime(2026, 9, 9, 9, 0), 10),
            _punch(datetime(2026, 9, 10, 9, 0), 10),
            _punch(datetime(2026, 9, 11, 9, 0), 5),  # 45 total → 40 regular + 5 OT
        ]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end)
        assert totals.regular_hours == Decimal("40.00")
        assert totals.overtime_hours == Decimal("5.00")
        # 40 * 20 + 5 * 20 * 1.5 = 800 + 150 = 950
        assert totals.estimated_pay == Decimal("950.00")

    def test_rate_snapshot_used_for_pay(self):
        entries = [
            _punch(datetime(2026, 9, 7, 9, 0), 8, "20.00"),
            _punch(datetime(2026, 9, 8, 9, 0), 8, "25.00"),
        ]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end)
        assert totals.estimated_pay == Decimal("360.00")  # 8*20 + 8*25


class TestPeriodBounds:
    def test_this_week_starts_monday(self):
        # Wednesday Sep 9 2026 15:00 ET
        now = TZ.localize(datetime(2026, 9, 9, 15, 0)).astimezone(pytz.UTC)
        start, end = period_bounds("this_week", now, TZ)
        local_start = start.astimezone(TZ)
        assert local_start.date().isoformat() == "2026-09-07"
        assert local_start.weekday() == 0
        assert q2(Decimal("1.234")) == Decimal("1.23")


class TestCallWork:
    def test_talk_time_and_utilization(self):
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 8, 0, 0)).astimezone(pytz.UTC)
        rows = [
            (
                TZ.localize(datetime(2026, 9, 7, 10, 0)).astimezone(pytz.UTC),
                1800,
                CallDirection.OUTBOUND,
                CallStatus.COMPLETED,
                None,
            ),
            (
                TZ.localize(datetime(2026, 9, 7, 11, 0)).astimezone(pytz.UTC),
                900,
                CallDirection.INBOUND,
                CallStatus.COMPLETED,
                None,
            ),
        ]
        totals, daily = _call_work_from_rows(rows, start, end, end, Decimal("8"), TZ)
        assert totals.talk_seconds == 2700
        assert totals.call_count == 2
        assert totals.inbound_count == 1
        assert totals.outbound_count == 1
        assert totals.talk_hours == Decimal("0.75")
        assert totals.utilization_pct == Decimal("9.38")
        assert list(daily.keys())[0].isoformat() == "2026-09-07"

    def test_no_clocked_hours_has_no_utilization(self):
        assert utilization_pct(Decimal("1.50"), Decimal("0")) is None


class TestHourCaps:
    def test_weekday_cap_marks_extra_unpaid(self):
        # Mon–Thu 6h, Fri–Sat 10h, week 40. Monday 8h → 6 payable + 2 unpaid.
        caps = HourCaps(
            max_hours_week=Decimal("40"),
            monday=Decimal("6"),
            tuesday=Decimal("6"),
            wednesday=Decimal("6"),
            thursday=Decimal("6"),
            friday=Decimal("10"),
            saturday=Decimal("10"),
            sunday=Decimal("0"),
        )
        entries = [_punch(datetime(2026, 9, 7, 9, 0), 8)]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, by_day = classify_entries(entries, start, end, TZ, end, daily=True, caps=caps)
        assert totals.payable_hours == Decimal("6.00")
        assert totals.unpaid_hours == Decimal("2.00")
        assert totals.total_hours == Decimal("8.00")
        assert totals.estimated_pay == Decimal("120.00")  # 6 * 20
        monday = TZ.localize(datetime(2026, 9, 7, 0, 0)).date()
        assert by_day[monday].to_breakdown().unpaid_hours == Decimal("2.00")

    def test_friday_allows_more_than_weekday(self):
        caps = HourCaps(
            max_hours_week=Decimal("40"),
            monday=Decimal("6"),
            tuesday=Decimal("6"),
            wednesday=Decimal("6"),
            thursday=Decimal("6"),
            friday=Decimal("10"),
            saturday=Decimal("10"),
            sunday=Decimal("0"),
        )
        entries = [_punch(datetime(2026, 9, 11, 9, 0), 10)]  # Friday
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end, caps=caps)
        assert totals.payable_hours == Decimal("10.00")
        assert totals.unpaid_hours == Decimal("0.00")
        assert totals.estimated_pay == Decimal("200.00")

    def test_week_cap_unpaid_even_under_daily(self):
        caps = HourCaps(max_hours_week=Decimal("10"), monday=Decimal("8"), tuesday=Decimal("8"))
        entries = [
            _punch(datetime(2026, 9, 7, 9, 0), 8),
            _punch(datetime(2026, 9, 8, 9, 0), 8),
        ]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end, caps=caps)
        assert totals.payable_hours == Decimal("10.00")
        assert totals.unpaid_hours == Decimal("6.00")
        assert totals.estimated_pay == Decimal("200.00")

    def test_approved_over_cap_is_paid(self):
        caps = HourCaps(monday=Decimal("6"))
        entries = [_punch(datetime(2026, 9, 7, 9, 0), 8, over_cap_approved=True)]
        start = TZ.localize(datetime(2026, 9, 7, 0, 0)).astimezone(pytz.UTC)
        end = TZ.localize(datetime(2026, 9, 14, 0, 0)).astimezone(pytz.UTC)
        totals, _ = classify_entries(entries, start, end, TZ, end, caps=caps)
        assert totals.payable_hours == Decimal("8.00")
        assert totals.unpaid_hours == Decimal("0.00")
        assert totals.estimated_pay == Decimal("160.00")

