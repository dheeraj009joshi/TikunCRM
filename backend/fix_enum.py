#!/usr/bin/env python3
"""Fix leadsource and notificationtype enums on production Azure database."""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def fix_enum():
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        # Fix leadsource enum
        await conn.execute(text("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'whatsapp_inbound'"))
        await conn.execute(text("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'sms_inbound'"))
        # Fix notificationtype enum (uppercase to match Python enum)
        await conn.execute(text("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'WHATSAPP_NEW_LEAD'"))
        await conn.execute(text("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'WHATSAPP_RECEIVED'"))
    await engine.dispose()
    print("SUCCESS: All enum values added!")

if __name__ == "__main__":
    asyncio.run(fix_enum())
