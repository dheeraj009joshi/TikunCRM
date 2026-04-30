#!/usr/bin/env python3
"""Fix leadsource enum on production Azure database."""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def fix_enum():
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'whatsapp_inbound'"))
        await conn.execute(text("ALTER TYPE leadsource ADD VALUE IF NOT EXISTS 'sms_inbound'"))
    await engine.dispose()
    print("SUCCESS: Enum values added to leadsource!")

if __name__ == "__main__":
    asyncio.run(fix_enum())
