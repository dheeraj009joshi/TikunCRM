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
)


TZ = pytz.timezone("America/New_York")


def _punch(local_start: datetime, hours: float, rate: str = "20.00") -> SimpleNamespace:
    start = TZ.localize(local_start) if local_start.tzinfo is None else local_start
    end = start + timedelta(hours=hours)
    return SimpleNamespace(
        clock_in_at=start.astimezone(pytz.UTC),
        clock_out_at=end.astimezone(pytz.UTC),
        hourly_rate=Decimal(rate),
        overtime_multiplier=OT_MULTIPLIER,
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
