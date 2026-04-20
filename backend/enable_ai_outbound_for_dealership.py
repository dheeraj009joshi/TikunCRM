"""
Enable AI outbound calling for the first dealership in the database.
"""
import asyncio
import sys

sys.path.insert(0, '/Users/dheeraj/Development/Work_Dheeraj/Tikuntech/LeedsCrm/backend')

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.dealership import Dealership
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.db.database import get_engine_url_and_connect_args


async def enable_ai_outbound():
    """Enable AI outbound for the first dealership."""
    
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
        
        print(f"✓ Found dealership: {dealership.name} (ID: {dealership.id})")
        
        # Check if dealership has twilio config
        result = await db.execute(
            select(DealershipTwilioConfig)
            .where(DealershipTwilioConfig.dealership_id == dealership.id)
        )
        config = result.scalar_one_or_none()
        
        if config:
            # Update existing config
            config.ai_outbound_enabled = True
            print(f"✓ Enabled AI outbound for existing config")
        else:
            # Create new config with minimal settings (will fall back to global)
            config = DealershipTwilioConfig(
                dealership_id=dealership.id,
                ai_outbound_enabled=True
            )
            db.add(config)
            print(f"✓ Created new config with AI outbound enabled")
        
        await db.commit()
        print(f"\n✅ AI outbound calling is now enabled for: {dealership.name}")
        print(f"   Dealership ID: {dealership.id}")
        print(f"   Timezone: {dealership.timezone}")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(enable_ai_outbound())
