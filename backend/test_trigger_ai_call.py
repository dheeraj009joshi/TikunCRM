"""
Manual test script to trigger an AI outbound call.
This bypasses API authentication and directly triggers a call using the service layer.
"""
import asyncio
import sys
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Add backend to path
sys.path.insert(0, '/Users/dheeraj/Development/Work_Dheeraj/Tikuntech/LeedsCrm/backend')

from app.core.config import settings
from app.models.lead import Lead
from app.models.customer import Customer
from app.models.dealership import Dealership
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.services.ai_outbound_service import maybe_enqueue_ai_outbound, initiate_twilio_call
from app.db.database import get_engine_url_and_connect_args


async def trigger_test_call(phone_number: str):
    """
    Create a test lead and trigger an AI outbound call.
    
    Args:
        phone_number: Phone number to call (e.g. "+917877424770")
    """
    print("=" * 60)
    print("AI OUTBOUND CALL TEST")
    print("=" * 60)
    print(f"\n📞 Target Phone: {phone_number}")
    print(f"🔑 Deepgram API Key: {'✓ Set' if settings.deepgram_api_key else '✗ Missing'}")
    print(f"🔑 OpenAI API Key: {'✓ Set' if settings.openai_api_key else '✗ Missing'}")
    print(f"🔊 AI Outbound Enabled: {settings.ai_outbound_enabled}")
    print(f"🌙 Quiet Hours: {settings.ai_outbound_quiet_hours_start}:00 - {settings.ai_outbound_quiet_hours_end}:00")
    print()
    
    # Create database session
    url, connect_args = get_engine_url_and_connect_args()
    engine = create_async_engine(url, echo=False, pool_pre_ping=True, connect_args=connect_args)
    async_session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session_maker() as db:
        # Step 1: Find a dealership with AI outbound enabled
        print("🔍 Step 1: Finding dealership with AI outbound enabled...")
        
        result = await db.execute(
            select(Dealership)
            .join(DealershipTwilioConfig)
            .where(DealershipTwilioConfig.ai_outbound_enabled == True)
            .limit(1)
        )
        dealership = result.scalar_one_or_none()
        
        if not dealership:
            print("❌ No dealership found with AI outbound enabled.")
            print("💡 Enable AI outbound for a dealership in dealership_twilio_configs table.")
            return
        
        print(f"✓ Found dealership: {dealership.name} (ID: {dealership.id})")
        
        # Step 2: Get or create test customer
        print("\n🔍 Step 2: Finding or creating test customer...")
        
        # Try to find existing customer with this phone
        result = await db.execute(
            select(Customer).where(Customer.phone == phone_number)
        )
        test_customer = result.scalar_one_or_none()
        
        if test_customer:
            print(f"✓ Found existing customer: {test_customer.first_name} {test_customer.last_name} (ID: {test_customer.id})")
        else:
            test_customer = Customer(
                id=uuid4(),
                first_name="AI Test",
                last_name="Call",
                phone=phone_number,
                email=f"aitest+{uuid4().hex[:8]}@example.com"  # Unique email to avoid conflicts
            )
            db.add(test_customer)
            await db.flush()
            print(f"✓ Created new customer: {test_customer.first_name} {test_customer.last_name}")
        
        # Step 3: Create a test lead
        print("\n🔍 Step 3: Creating test lead...")
        
        # Get a default lead stage for this dealership or global
        from app.models.lead_stage import LeadStage
        stage_result = await db.execute(
            select(LeadStage)
            .where(
                (LeadStage.dealership_id == dealership.id) | 
                (LeadStage.dealership_id == None)
            )
            .order_by(LeadStage.order)
            .limit(1)
        )
        lead_stage = stage_result.scalar_one_or_none()
        
        if not lead_stage:
            print("❌ No lead stages found. Please seed the database first.")
            return
        
        test_lead = Lead(
            id=uuid4(),
            dealership_id=dealership.id,
            customer_id=test_customer.id,
            stage_id=lead_stage.id,
            source="manual",  # Use valid LeadSource enum value
            interested_in="Test Vehicle - Honda City"
        )
        db.add(test_lead)
        await db.commit()
        
        print(f"✓ Created lead: {test_lead.id}")
        
        # Step 4: Check if AI outbound should be triggered
        print("\n🔍 Step 4: Checking AI outbound eligibility...")
        
        enqueue_result = await maybe_enqueue_ai_outbound(db, test_lead.id)
        
        print(f"   Result: {enqueue_result}")
        
        if enqueue_result != "pending":
            print(f"\n❌ Call not triggered. Reason: {enqueue_result}")
            print("\n💡 Possible reasons:")
            print("   - AI_OUTBOUND_ENABLED is false")
            print("   - Currently in quiet hours")
            print("   - Twilio not configured")
            print("   - Invalid phone number")
            return
        
        print("✓ Call enqueued successfully!")
        
        # Step 5: Find the AI outbound call record
        print("\n🔍 Step 5: Finding AI outbound call record...")
        
        from app.models.ai_outbound_call import AiOutboundCall
        result = await db.execute(
            select(AiOutboundCall)
            .where(AiOutboundCall.lead_id == test_lead.id)
        )
        ai_call = result.scalar_one_or_none()
        
        if not ai_call:
            print("❌ AI outbound call record not found")
            return
        
        print(f"✓ Found AI call record: {ai_call.id}")
        print(f"   Status: {ai_call.status}")
        print(f"   Phone: {ai_call.customer_phone}")
        
        # Step 6: Initiate the Twilio call
        print("\n🔍 Step 6: Initiating Twilio call...")
        
        success = await initiate_twilio_call(db, ai_call.id)
        
        if success:
            # Reload to get updated info
            await db.refresh(ai_call)
            print(f"\n✅ SUCCESS! Call initiated!")
            print(f"   Twilio Call SID: {ai_call.twilio_call_sid}")
            print(f"   Status: {ai_call.status}")
            print(f"\n📱 The AI agent should now be calling {phone_number}")
            print(f"   Monitor the call in Twilio Console: https://console.twilio.com")
            print(f"\n🎯 Test Details:")
            print(f"   Lead ID: {test_lead.id}")
            print(f"   AI Call ID: {ai_call.id}")
        else:
            print(f"\n❌ Failed to initiate call")
            print(f"   Check backend logs for details")
    
    await engine.dispose()
    print("\n" + "=" * 60)


if __name__ == "__main__":
    # Test phone number
    test_phone = "+14709099027"
    
    print("\n⚠️  WARNING: This will make a real phone call using your Twilio account!")
    print(f"⚠️  Target: {test_phone}")
    print("\nStarting in 3 seconds... Press Ctrl+C to cancel\n")
    
    import time
    try:
        for i in range(3, 0, -1):
            print(f"   {i}...")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user")
        sys.exit(0)
    
    print()
    asyncio.run(trigger_test_call(test_phone))
