"""
Debug script to check WhatsApp incoming message handling.

Run this on your server to diagnose why messages aren't being logged:
    python debug_whatsapp_incoming.py
"""
import asyncio
import sys
from uuid import UUID

# Add the app to path
sys.path.insert(0, ".")

async def main():
    from app.db.database import AsyncSessionLocal
    from app.models.whatsapp_log import WhatsAppLog
    from app.models.lead import Lead
    from app.models.customer import Customer
    from app.models.dealership import Dealership
    from sqlalchemy import select, func

    print("=" * 60)
    print("WhatsApp Incoming Message Debug Tool")
    print("=" * 60)
    
    async with AsyncSessionLocal() as db:
        # 1. Check total WhatsApp logs
        result = await db.execute(select(func.count(WhatsAppLog.id)))
        total_logs = result.scalar()
        print(f"\n1. Total WhatsApp logs in database: {total_logs}")
        
        # 2. Check inbound messages specifically
        result = await db.execute(
            select(func.count(WhatsAppLog.id)).where(WhatsAppLog.direction == 'inbound')
        )
        inbound_count = result.scalar()
        print(f"2. Inbound messages: {inbound_count}")
        
        # 3. Check recent inbound messages
        print("\n3. Recent inbound messages (last 10):")
        result = await db.execute(
            select(WhatsAppLog)
            .where(WhatsAppLog.direction == 'inbound')
            .order_by(WhatsAppLog.created_at.desc())
            .limit(10)
        )
        recent = result.scalars().all()
        for msg in recent:
            print(f"   - {msg.created_at} | From: {msg.from_number} | Lead: {msg.lead_id} | Body: {msg.body[:50] if msg.body else '(no body)'}...")
        
        # 4. Check for messages from specific number
        test_number = "+918619474696"
        print(f"\n4. Messages from {test_number}:")
        normalized = "".join(c for c in test_number if c.isdigit())
        result = await db.execute(
            select(WhatsAppLog).where(
                (WhatsAppLog.from_number == test_number) |
                (WhatsAppLog.from_number.like(f"%{normalized[-10:]}%"))
            ).order_by(WhatsAppLog.created_at.desc())
        )
        msgs = result.scalars().all()
        print(f"   Found {len(msgs)} messages")
        for msg in msgs:
            print(f"   - {msg.created_at} | SID: {msg.twilio_message_sid} | Lead: {msg.lead_id} | Body: {msg.body[:30] if msg.body else '(empty)'}...")
        
        # 5. Check if lead exists for this number
        print(f"\n5. Leads with phone containing {normalized[-10:]}:")
        result = await db.execute(
            select(Lead).options(
                selectinload(Lead.customer)
            ).join(Customer).where(
                (Customer.phone.like(f"%{normalized[-10:]}%")) |
                (Customer.whatsapp.like(f"%{normalized}%"))
            )
        )
        leads = result.scalars().all()
        print(f"   Found {len(leads)} leads")
        for lead in leads:
            print(f"   - Lead ID: {lead.id} | Customer: {lead.customer.first_name if lead.customer else 'N/A'} | Phone: {lead.customer.phone if lead.customer else 'N/A'}")
        
        # 6. Check dealerships
        print("\n6. Dealerships:")
        result = await db.execute(select(Dealership))
        dealerships = result.scalars().all()
        for d in dealerships:
            print(f"   - {d.id} | {d.name}")
        
        # 7. Check Twilio config
        print("\n7. Checking Twilio config...")
        from app.models.dealership_twilio_config import DealershipTwilioConfig
        result = await db.execute(select(DealershipTwilioConfig))
        configs = result.scalars().all()
        print(f"   Found {len(configs)} dealership Twilio configs")
        for cfg in configs:
            print(f"   - Dealership: {cfg.dealership_id} | WhatsApp: {cfg.whatsapp_number}")
        
        print("\n" + "=" * 60)
        print("Debug complete. Check the output above for issues.")
        print("=" * 60)

if __name__ == "__main__":
    # Import selectinload
    from sqlalchemy.orm import selectinload
    asyncio.run(main())
