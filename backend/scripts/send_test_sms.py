"""
Send a test SMS to a given number using Twilio credentials from backend/.env.
Run from backend directory: python -m scripts.send_test_sms
Or: python scripts/send_test_sms.py (from backend)
"""
import asyncio
import logging
import os
import sys

# Load .env from backend directory
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(_backend_dir)
sys.path.insert(0, _backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_dir, ".env"))
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TO_NUMBER = "+14709099027"
MESSAGE = "Test from TikunCRM: SMS notifications are working."


async def send_sms_via_twilio():
    """Use Twilio REST API directly so we don't need the full app stack."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    from_phone = os.environ.get("TWILIO_PHONE_NUMBER", "").strip()

    if not account_sid or not auth_token or not from_phone:
        logger.error(
            "Missing Twilio config in .env. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER"
        )
        return False

    try:
        from twilio.rest import Client
    except ImportError:
        logger.error("Twilio not installed. Run: pip install twilio")
        return False

    client = Client(account_sid, auth_token)
    # Twilio client.messages.create is sync; run in executor to not block
    loop = asyncio.get_event_loop()
    msg = await loop.run_in_executor(
        None,
        lambda: client.messages.create(
            body=MESSAGE[:1600],
            from_=from_phone,
            to=TO_NUMBER,
        ),
    )
    logger.info("SUCCESS: SMS sent. SID=%s to=%s", msg.sid, TO_NUMBER)
    return True


async def main():
    logger.info("Sending test SMS to %s...", TO_NUMBER)
    try:
        ok = await send_sms_via_twilio()
        if not ok:
            sys.exit(1)
    except Exception as e:
        logger.exception("Failed to send SMS: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
