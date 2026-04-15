"""
Apply global Twilio settings from .env to a dealership's DealershipTwilioConfig row.

Usage (from backend directory):
    python -m scripts.sync_twilio_env_to_dealership

Optional env:
    SYNC_TWILIO_DEALERSHIP_MATCH=Toyota South Atlanta   # single substring, case-insensitive
    Or omit to match any name containing Toyota, South, and Atlanta (e.g. Toyota South Atlanta).
"""
import asyncio
import os
import sys

from sqlalchemy import select, and_

from app.db.database import async_session_maker
from app.core.config import get_settings
from app.models.dealership import Dealership
from app.models.dealership_twilio_config import DealershipTwilioConfig


async def main() -> None:
    s = get_settings()

    if not (s.twilio_account_sid and s.twilio_auth_token):
        print("ERROR: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in backend/.env", file=sys.stderr)
        sys.exit(1)

    async with async_session_maker() as session:
        explicit = os.environ.get("SYNC_TWILIO_DEALERSHIP_MATCH", "").strip()
        if explicit:
            r = await session.execute(select(Dealership).where(Dealership.name.ilike(f"%{explicit}%")))
        else:
            r = await session.execute(
                select(Dealership).where(
                    and_(
                        Dealership.name.ilike("%Toyota%"),
                        Dealership.name.ilike("%South%"),
                        Dealership.name.ilike("%Atlanta%"),
                    )
                )
            )
        candidates = r.scalars().all()
        if not candidates:
            hint = explicit or "Toyota + South + Atlanta"
            print(f"ERROR: No dealership found (match: {hint})", file=sys.stderr)
            sys.exit(1)
        if len(candidates) > 1:
            print("ERROR: Multiple dealerships matched; set SYNC_TWILIO_DEALERSHIP_MATCH to a unique substring:", file=sys.stderr)
            for d in candidates:
                print(f"  - {d.name} ({d.id})", file=sys.stderr)
            sys.exit(1)
        dealership = candidates[0]

        r2 = await session.execute(
            select(DealershipTwilioConfig).where(DealershipTwilioConfig.dealership_id == dealership.id)
        )
        row = r2.scalar_one_or_none()
        if not row:
            row = DealershipTwilioConfig(dealership_id=dealership.id)
            session.add(row)

        row.account_sid = s.twilio_account_sid or None
        row.auth_token = s.twilio_auth_token
        # Enable channels when credentials exist in env (dealership row stores the same account)
        row.sms_enabled = bool(s.twilio_phone_number and s.twilio_account_sid and s.twilio_auth_token)
        row.sms_from_number = (s.twilio_phone_number or "").strip() or None
        row.whatsapp_enabled = bool(s.twilio_whatsapp_number and s.twilio_account_sid and s.twilio_auth_token)
        wa = (s.twilio_whatsapp_number or "").strip()
        if wa and not wa.startswith("whatsapp:"):
            wa = f"whatsapp:{wa}"
        row.whatsapp_from_number = wa or None
        row.voice_enabled = bool(
            s.voice_enabled
            and s.twilio_twiml_app_sid
            and s.twilio_api_key_sid
            and s.twilio_api_key_secret
        )
        row.twilio_twiml_app_sid = (s.twilio_twiml_app_sid or "").strip() or None
        row.twilio_api_key_sid = (s.twilio_api_key_sid or "").strip() or None
        if s.twilio_api_key_secret:
            row.twilio_api_key_secret = s.twilio_api_key_secret
        row.voice_caller_id_number = (s.twilio_phone_number or "").strip() or None

        await session.commit()
        print(f"Updated Twilio config for dealership: {dealership.name} (id={dealership.id})")
        print(
            f"  sms_enabled={row.sms_enabled} whatsapp_enabled={row.whatsapp_enabled} voice_enabled={row.voice_enabled}"
        )


if __name__ == "__main__":
    asyncio.run(main())
