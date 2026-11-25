"""
Tests for note reminders: reading a lead's notes and suggesting callbacks.

The LLM is replaced with a fake; everything else (date handling, quote checks,
redaction, storage, the API) runs for real on a throwaway SQLite database.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.api import deps
from app.api.v1.endpoints import note_reminders as note_reminders_api
from app.core.config import settings
from app.core.permissions import UserRole
from app.db.database import get_db
from app.models.activity import Activity, ActivityType
from app.models.customer import Customer
from app.models.dealership import Dealership
from app.models.follow_up import FollowUp, FollowUpStatus
from app.models.lead import Lead
from app.models.note_reminder import NoteReminder, NoteReminderScan
from app.models.user import User
from app.services import note_reminders_service as svc

NY = ZoneInfo("America/New_York")
# Wed Nov 18 2026, 11:27 New York time / Fri Nov 20 2026, 16:30 New York time
NOTE1_AT = datetime(2026, 11, 18, 11, 27, tzinfo=NY).astimezone(timezone.utc)
NOTE2_AT = datetime(2026, 11, 20, 16, 30, tzinfo=NY).astimezone(timezone.utc)
NOW = datetime(2026, 11, 20, 16, 35, tzinfo=NY).astimezone(timezone.utc)

NOTE1 = "looking for tacoma has license has social has down payment 2k has credit 670 he let me know Friday 5pm"
NOTE2 = "@Kerelis Menes follow up with this customer today as well."

REMINDER_FRIDAY = {
    "note": "n1",
    "quote": "he let me know Friday 5pm",
    "action": "Call back: he decides on the Tacoma",
    "date": "2026-11-20",
    "time": "17:00",
    "for_mentioned": False,
}
REMINDER_TODAY = {
    "note": "n2",
    "quote": "follow up with this customer today",
    "action": "Follow up with the customer today",
    "date": "2026-11-20",
    "time": None,
    "for_mentioned": True,
}


def output(*reminders):
    return json.dumps({"reminders": list(reminders)})


@compiles(JSONB, "sqlite")
def _jsonb_as_json_on_sqlite(type_, compiler, **kw):
    return "JSON"


@pytest.fixture
async def db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'notes.db'}")
    tables = [m.__table__ for m in (Activity, Customer, Dealership, FollowUp, Lead, NoteReminder, NoteReminderScan, User)]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Activity.metadata.create_all(c, tables=tables))
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


@pytest.fixture
def world():
    return SimpleNamespace(
        dealership_id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        kerelis_id=uuid.uuid4(),
        manager_id=uuid.uuid4(),
        lead_id=uuid.uuid4(),
    )


DEFAULT_NOTES = ((NOTE1, NOTE1_AT, "Kerelis Menes", None), (NOTE2, NOTE2_AT, "J Brown", "kerelis"))


async def _seed(db, w, notes=DEFAULT_NOTES):
    db.add(Dealership(id=w.dealership_id, name="Test Motors", timezone="America/New_York"))
    for uid, first in ((w.owner_id, "Olivia"), (w.kerelis_id, "Kerelis")):
        db.add(User(id=uid, email=f"{first.lower()}@example.com", password_hash="x", first_name=first, last_name="Rep"))
    lead = Lead(
        id=w.lead_id,
        customer_id=uuid.uuid4(),
        stage_id=uuid.uuid4(),
        dealership_id=w.dealership_id,
        assigned_to=w.owner_id,
    )
    db.add(lead)
    for content, at, author, mention in notes:
        await _add_note(db, w, content, at, author, mention)
    await db.commit()
    return lead


async def _add_note(db, w, content, at, author="Kerelis Menes", mention=None):
    meta = {"content": content, "performer_name": author}
    if mention == "kerelis":
        meta["mentioned_users"] = [{"id": str(w.kerelis_id), "name": "Kerelis Menes"}]
        meta["mentioned_user_ids"] = [str(w.kerelis_id)]
    act = Activity(
        type=ActivityType.NOTE_ADDED,
        description=f"Note added by {author}",
        lead_id=w.lead_id,
        dealership_id=w.dealership_id,
        meta_data=meta,
        created_at=at,
    )
    db.add(act)
    await db.flush()
    return act


@pytest.fixture
def llm(monkeypatch):
    """Fake model. Set state.reply; every call's messages are recorded."""
    state = SimpleNamespace(reply=output(REMINDER_FRIDAY, REMINDER_TODAY), calls=[], fail=False)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")

    async def fake(messages):
        state.calls.append(messages)
        if state.fail:
            raise TimeoutError("model timed out")
        return state.reply

    monkeypatch.setattr(svc, "_call_llm", fake)
    return state


# ------------------------------------------------------------- redaction ----

class TestRedact:
    def test_phone_numbers_and_emails_are_removed(self):
        text = "call him at (305) 555-1234 or +1 786 555 0000, email henry.m@gmail.com"
        out = svc.redact(text)
        assert "555" not in out and "gmail" not in out
        assert out.count("[phone]") == 2 and "[email]" in out

    def test_local_seven_digit_number_is_removed(self):
        assert svc.redact("cell 555-1234 ok") == "cell [phone] ok"

    def test_dates_mentions_and_small_numbers_are_kept(self):
        text = "@Kerelis Menes he comes 11-21-2026 at 5pm, credit 670, 2k down"
        assert svc.redact(text) == text


# ------------------------------------------------------- checking output ----

def _notes(w):
    return [
        {"id": uuid.uuid4(), "created_at": NOTE1_AT, "author": "Kerelis Menes", "content": NOTE1, "mentioned": []},
        {
            "id": uuid.uuid4(),
            "created_at": NOTE2_AT,
            "author": "J Brown",
            "content": NOTE2,
            "mentioned": [{"id": str(w.kerelis_id), "name": "Kerelis Menes"}],
        },
    ]


class TestParseOutput:
    def test_weekday_and_time_become_a_local_time(self, world):
        notes = _notes(world)
        [r] = svc.parse_output(output(REMINDER_FRIDAY), notes, NY, world.owner_id)
        assert r["due_at"] == datetime(2026, 11, 20, 17, 0, tzinfo=NY).astimezone(timezone.utc)
        assert r["time_given"] is True
        assert r["assignee_user_id"] == world.owner_id
        assert r["source_activity_id"] == notes[0]["id"]

    def test_today_without_a_time_is_end_of_day_and_goes_to_the_mentioned_rep(self, world):
        notes = _notes(world)
        notes[1]["created_at"] = datetime(2026, 11, 20, 14, 7, tzinfo=NY).astimezone(timezone.utc)
        [r] = svc.parse_output(output(REMINDER_TODAY), notes, NY, world.owner_id)
        assert r["due_at"] == datetime(2026, 11, 20, 17, 0, tzinfo=NY).astimezone(timezone.utc)
        assert r["time_given"] is False
        assert r["assignee_user_id"] == world.kerelis_id

    def test_late_note_today_without_time_is_an_hour_later(self, world):
        notes = _notes(world)
        notes[1]["created_at"] = datetime(2026, 11, 20, 18, 30, tzinfo=NY).astimezone(timezone.utc)
        [r] = svc.parse_output(output(REMINDER_TODAY), notes, NY, world.owner_id)
        assert r["due_at"] == datetime(2026, 11, 20, 19, 30, tzinfo=NY).astimezone(timezone.utc)

    def test_another_day_without_time_defaults_to_ten(self, world):
        reminder = {**REMINDER_FRIDAY, "date": "2026-11-21", "time": None}
        [r] = svc.parse_output(output(reminder), _notes(world), NY, world.owner_id)
        assert r["due_at"] == datetime(2026, 11, 21, 10, 0, tzinfo=NY).astimezone(timezone.utc)

    def test_mentioned_flag_without_a_mention_stays_with_the_owner(self, world):
        reminder = {**REMINDER_FRIDAY, "for_mentioned": True}
        [r] = svc.parse_output(output(reminder), _notes(world), NY, world.owner_id)
        assert r["assignee_user_id"] == world.owner_id

    @pytest.mark.parametrize(
        "change",
        [
            {"quote": "he will come Saturday at noon"},  # not in the note
            {"note": "n9"},  # no such note
            {"date": "2026-11-17"},  # before the note was written
            {"date": "2027-06-01"},  # too far ahead
            {"date": "Friday"},  # not a date
            {"action": "   "},
        ],
    )
    def test_unsupported_reminders_are_dropped(self, world, change):
        assert svc.parse_output(output({**REMINDER_FRIDAY, **change}), _notes(world), NY, world.owner_id) == []

    def test_quote_matching_ignores_case_and_spacing(self, world):
        reminder = {**REMINDER_FRIDAY, "quote": "He  let me know\nFRIDAY 5pm"}
        assert len(svc.parse_output(output(reminder), _notes(world), NY, world.owner_id)) == 1

    def test_bad_time_falls_back_to_default(self, world):
        [r] = svc.parse_output(output({**REMINDER_FRIDAY, "time": "5pm"}), _notes(world), NY, world.owner_id)
        assert r["time_given"] is False

    def test_unreadable_output_gives_nothing(self, world):
        assert svc.parse_output("not json", _notes(world), NY, world.owner_id) == []
        assert svc.parse_output('{"reminders": "x"}', _notes(world), NY, world.owner_id) == []

    def test_duplicates_collapse_and_list_is_capped(self, world):
        many = [REMINDER_FRIDAY] * 3 + [{**REMINDER_FRIDAY, "time": f"{h:02d}:00"} for h in range(8, 16)]
        kept = svc.parse_output(output(*many), _notes(world), NY, world.owner_id)
        assert len(kept) == svc.MAX_REMINDERS
        assert len({k["due_at"] for k in kept}) == len(kept)


# ------------------------------------------------------- scanning a lead ----

class TestScan:
    async def test_reads_notes_and_lists_suggestions(self, db, world, llm):
        lead = await _seed(db, world)
        assert (await svc.list_for_lead(db, lead, now=NOW))["stale"] is True

        assert await svc.scan_lead(db, lead, now=NOW) is True
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)

        assert out["stale"] is False and out["error"] is False
        # Friday 5pm (from Wednesday's note) and "today" with no time (17:30, an hour after the
        # 16:30 note) are half an hour apart: one card, led by the one with a stated time.
        [card] = out["reminders"]
        assert card["action"] == "Call back: he decides on the Tacoma"
        assert card["time_given"] is True and card["quote"] == "he let me know Friday 5pm"
        assert card["assignee_name"] == "Olivia Rep"
        assert not card["overdue"] and not card["already_scheduled"]
        [also] = card["also"]
        assert also["quote"] == "follow up with this customer today" and also["note_author"] == "J Brown"

    async def test_reminders_far_apart_stay_separate(self, db, world, llm):
        lead = await _seed(db, world)
        llm.reply = output(REMINDER_TODAY, {**REMINDER_FRIDAY, "date": "2026-11-23"})
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)
        assert [r["action"] for r in out["reminders"]] == [
            "Follow up with the customer today",
            "Call back: he decides on the Tacoma",
        ]
        today = out["reminders"][0]
        assert today["assignee_name"] == "Kerelis Rep" and today["note_author"] == "J Brown"
        assert all(r["also"] == [] for r in out["reminders"])

    async def test_prompt_uses_note_dates_in_dealership_time(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        user_msg = llm.calls[0][1]["content"]
        assert "America/New_York" in user_msg and "Today is Friday 2026-11-20" in user_msg
        assert "written Wednesday 2026-11-18 11:27 | by Kerelis Menes" in user_msg
        assert "mentions: Kerelis Menes" in user_msg

    async def test_phone_numbers_are_not_sent_to_the_model(self, db, world, llm):
        lead = await _seed(db, world, notes=(("call back 305-555-1234 tomorrow, email a@b.com", NOTE1_AT, "K", None),))
        await svc.scan_lead(db, lead, now=NOW)
        sent = json.dumps(llm.calls[0])
        assert "555-1234" not in sent and "a@b.com" not in sent

    async def test_unchanged_notes_are_not_read_twice(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        assert await svc.scan_lead(db, lead, now=NOW) is False
        assert len(llm.calls) == 1

    async def test_new_note_makes_it_stale_and_dropped_reminders_are_superseded(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()

        await _add_note(db, world, "talked to him, he bought a camry elsewhere", NOW)
        await db.commit()
        assert (await svc.list_for_lead(db, lead, now=NOW))["stale"] is True

        llm.reply = output()
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)
        assert out["reminders"] == [] and out["stale"] is False
        statuses = (await db.execute(select(NoteReminder.status))).scalars().all()
        assert sorted(statuses) == ["superseded", "superseded"]

    async def test_rescan_keeps_decisions(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        row = (await db.execute(select(NoteReminder).order_by(NoteReminder.due_at))).scalars().first()
        await svc.decide(db, row, SimpleNamespace(id=world.manager_id), accept=False)
        await db.commit()

        await svc.scan_lead(db, lead, force=True, now=NOW)
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)
        assert len(out["reminders"]) == 1  # the dismissed one doesn't come back
        assert len((await db.execute(select(NoteReminder))).scalars().all()) == 2

    async def test_existing_follow_up_marks_reminder_already_scheduled(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        db.add(
            FollowUp(
                lead_id=world.lead_id,
                assigned_to=world.owner_id,
                scheduled_at=datetime(2026, 11, 20, 14, 0, tzinfo=NY).astimezone(timezone.utc),
                status=FollowUpStatus.PENDING,
            )
        )
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)
        # 14:00 is within 3 hours of 5pm, so the card is already on the follow-up list
        [card] = out["reminders"]
        assert card["already_scheduled"] is True

    async def test_overdue_and_hidden_when_long_past(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        later = NOW + timedelta(days=2)
        assert all(r["overdue"] for r in (await svc.list_for_lead(db, lead, now=later))["reminders"])
        assert (await svc.list_for_lead(db, lead, now=NOW + timedelta(days=40)))["reminders"] == []

    async def test_model_failure_is_recorded_and_retried(self, db, world, llm):
        lead = await _seed(db, world)
        llm.fail = True
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        out = await svc.list_for_lead(db, lead, now=NOW)
        assert out["error"] is True and out["stale"] is True and out["reminders"] == []

        llm.fail = False
        assert await svc.scan_lead(db, lead, now=NOW) is True
        await db.commit()
        [card] = (await svc.list_for_lead(db, lead, now=NOW))["reminders"]
        assert len(card["also"]) == 1

    async def test_no_notes_means_no_model_call(self, db, world, llm):
        lead = await _seed(db, world, notes=())
        await svc.scan_lead(db, lead, now=NOW)
        assert llm.calls == []
        assert (await svc.list_for_lead(db, lead, now=NOW))["stale"] is False

    async def test_no_key_raises(self, db, world, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "")
        lead = await _seed(db, world)
        with pytest.raises(svc.NoteRemindersUnavailable):
            await svc.scan_lead(db, lead, now=NOW)

    async def test_scan_records_model_and_prompt_version(self, db, world, llm):
        lead = await _seed(db, world)
        await svc.scan_lead(db, lead, now=NOW)
        await db.commit()
        row = (await db.execute(select(NoteReminder))).scalars().first()
        assert row.prompt_version == svc.PROMPT_VERSION and row.llm_model == settings.call_review_model


# ------------------------------------------------------------------ API ----

@pytest.fixture
def api(db, world, monkeypatch):
    app = FastAPI()
    app.include_router(note_reminders_api.router, prefix="/note-reminders")
    state = SimpleNamespace(user=SimpleNamespace(id=world.manager_id, role=UserRole.DEALERSHIP_ADMIN), allowed=True)

    async def _db():
        yield db

    async def _user():
        return state.user

    async def _can_access(db_, user, dealership_id, assigned_to=None):
        return state.allowed

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[deps.get_current_active_user] = _user
    monkeypatch.setattr(note_reminders_api, "user_can_access_lead", _can_access)
    state.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    return state


class TestApi:
    async def test_scan_then_accept_and_dismiss(self, db, world, llm, api):
        await _seed(db, world)
        r = await api.client.get(f"/note-reminders/leads/{world.lead_id}")
        assert r.status_code == 200 and r.json()["stale"] is True

        r = await api.client.post(f"/note-reminders/leads/{world.lead_id}/scan")
        assert r.status_code == 200
        [card] = r.json()["reminders"]
        also_id = card["also"][0]["id"]

        fu = FollowUp(
            lead_id=world.lead_id,
            assigned_to=world.kerelis_id,
            scheduled_at=datetime.fromisoformat(card["due_at"]),
            status=FollowUpStatus.PENDING,
        )
        db.add(fu)
        await db.commit()
        # Adding the card links the one follow-up to every reminder on it
        for rid in (card["id"], also_id):
            r = await api.client.post(f"/note-reminders/{rid}/accept", json={"follow_up_id": str(fu.id)})
            assert r.status_code == 200 and r.json()["status"] == "accepted"

        r = await api.client.post(f"/note-reminders/{also_id}/dismiss")
        assert r.status_code == 409

        r = await api.client.get(f"/note-reminders/leads/{world.lead_id}")
        assert r.json()["reminders"] == []
        stored = (await db.execute(select(NoteReminder))).scalars().all()
        assert {s.follow_up_id for s in stored} == {fu.id} and {s.decided_by for s in stored} == {world.manager_id}

    async def test_dismiss(self, db, world, llm, api):
        await _seed(db, world)
        [card] = (await api.client.post(f"/note-reminders/leads/{world.lead_id}/scan")).json()["reminders"]
        r = await api.client.post(f"/note-reminders/{card['id']}/dismiss")
        assert r.status_code == 200 and r.json()["status"] == "dismissed"
        # The other reminder on the card is still waiting, now on its own
        [left] = (await api.client.get(f"/note-reminders/leads/{world.lead_id}")).json()["reminders"]
        assert left["id"] == card["also"][0]["id"]

    async def test_accept_rejects_a_follow_up_on_another_lead(self, db, world, llm, api):
        await _seed(db, world)
        reminders = (await api.client.post(f"/note-reminders/leads/{world.lead_id}/scan")).json()["reminders"]
        other = FollowUp(lead_id=uuid.uuid4(), assigned_to=world.owner_id, scheduled_at=NOW, status=FollowUpStatus.PENDING)
        db.add(other)
        await db.commit()
        r = await api.client.post(f"/note-reminders/{reminders[0]['id']}/accept", json={"follow_up_id": str(other.id)})
        assert r.status_code == 409

    async def test_no_access_is_403(self, db, world, llm, api):
        await _seed(db, world)
        api.allowed = False
        assert (await api.client.get(f"/note-reminders/leads/{world.lead_id}")).status_code == 403
        assert (await api.client.post(f"/note-reminders/leads/{world.lead_id}/scan")).status_code == 403

    async def test_unknown_lead_is_404(self, api):
        assert (await api.client.get(f"/note-reminders/leads/{uuid.uuid4()}")).status_code == 404

    async def test_no_key_is_503(self, db, world, api, monkeypatch):
        monkeypatch.setattr(settings, "openai_api_key", "")
        await _seed(db, world)
        r = await api.client.post(f"/note-reminders/leads/{world.lead_id}/scan")
        assert r.status_code == 503 and "OPENAI_API_KEY" in r.json()["detail"]
        assert (await api.client.get(f"/note-reminders/leads/{world.lead_id}")).json()["available"] is False
