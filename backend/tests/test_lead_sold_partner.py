"""Sold-to partner is snapshotted at conversion and independent of later sent-to changes."""
from uuid import uuid4

from app.models.lead import Lead


def test_snapshot_sold_partner_copies_current_sent_to() -> None:
    lead = Lead()
    sent = uuid4()
    lead.partner_store_id = sent
    lead.snapshot_sold_partner()
    assert lead.sold_partner_store_id == sent


def test_later_sent_to_change_does_not_overwrite_sold_to() -> None:
    lead = Lead()
    original = uuid4()
    later = uuid4()
    lead.partner_store_id = original
    lead.snapshot_sold_partner()
    lead.partner_store_id = later
    lead.snapshot_sold_partner(only_if_empty=True)
    assert lead.sold_partner_store_id == original
    assert lead.partner_store_id == later


def test_fill_sold_partner_if_converted_only_when_sold() -> None:
    lead = Lead()
    partner = uuid4()
    lead.partner_store_id = partner
    lead.fill_sold_partner_if_converted()
    assert lead.sold_partner_store_id is None

    lead.outcome = "converted"
    lead.fill_sold_partner_if_converted()
    assert lead.sold_partner_store_id == partner
