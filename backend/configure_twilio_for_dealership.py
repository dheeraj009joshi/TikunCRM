"""
Configure Twilio for dealership so AI calls can work.
"""
import asyncio
import sys

sys.path.insert(0, '/Users/dheeraj/Development/Work_Dheeraj/Tikuntech/LeedsCrm/backend')

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.dealership import Dealership
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.db.database import get_engine_url_and_connect_args


async def configure_twilio_for_dealership():
    """Configure Twilio credentials for the dealership."""
    
    print("Configuring Twilio for dealership...")
    print(f"Using global Twilio config from .env:")
    print(f"  Account SID: {settings.twilio_account_sid[:10]}...")
    print(f"  Phone Number: {settings.twilio_phone_number}")
    
    # Create database session
    url, connect_args = get_engine_url_and_connect_args()
    engine = create_async_engine(url, echo=False, pool_pre_ping=True, connect_args=connect_args)
    async_session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session_maker() as db:
        # Find first dealership
        result = await db.execute(select(Dealership).limit(1))
        dealership = result.scalar_one_or_none()
        
        if not dealership:
            print("❌ No dealerships found in database")
            return
        
        print(f"\n✓ Found dealership: {dealership.name} (ID: {dealership.id})")
        
        # Get or create dealership twilio config
        result = await db.execute(
            select(DealershipTwilioConfig)
            .where(DealershipTwilioConfig.dealership_id == dealership.id)
        )
        config = result.scalar_one_or_none()
        
        if not config:
            config = DealershipTwilioConfig(
                dealership_id=dealership.id
            )
            db.add(config)
            print("✓ Created new Twilio config")
        
        # Set Twilio credentials
        config.account_sid = settings.twilio_account_sid
        config.auth_token = settings.twilio_auth_token
        config.phone_number = settings.twilio_phone_number  # For SMS if needed
        config.voice_caller_id_number = settings.twilio_phone_number  # Voice caller ID
        config.twiml_app_sid = settings.twilio_twiml_app_sid
        config.api_key_sid = settings.twilio_api_key_sid
        config.api_key_secret = settings.twilio_api_key_secret
        config.voice_enabled = True  # Enable voice calling
        config.ai_outbound_enabled = True
        
        await db.commit()
        
        print(f"\n✅ Twilio configured for: {dealership.name}")
        print(f"   Account SID: {config.account_sid[:10]}...")
        print(f"   Caller ID Number: {config.voice_caller_id_number}")
        print(f"   TwiML App SID: {config.twiml_app_sid[:10] if config.twiml_app_sid else 'Not set'}...")
        print(f"   Voice Enabled: {'Yes' if config.voice_enabled else 'No'}")
        print(f"   AI Outbound: {'Enabled' if config.ai_outbound_enabled else 'Disabled'}")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(configure_twilio_for_dealership())
