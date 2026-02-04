"""
Delete All CRM Data Script

This script will delete all leads, activities, appointments, follow-ups, and notifications.
Leads will automatically re-sync from Google Sheets.

Usage:
    cd backend
    PYTHONPATH=. python scripts/delete_all_data.py
"""
import asyncio
import sys
from pathlib import Path

# Add backend directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import delete

from app.db.database import async_session_maker
from app.models.lead import Lead
from app.models.activity import Activity
from app.models.appointment import Appointment
from app.models.follow_up import FollowUp
from app.models.notification import Notification


async def delete_all_data():
    """Delete all CRM data"""
    print("⚠️  WARNING: This will delete ALL CRM data!")
    print("   - All leads")
    print("   - All activities")
    print("   - All appointments")
    print("   - All follow-ups")
    print("   - All notifications")
    print()
    print("   ✅ Leads will auto-sync back from Google Sheets")
    print()
    
    confirm = input("Type 'YES DELETE ALL' to confirm: ")
    if confirm != "YES DELETE ALL":
        print("❌ Deletion cancelled")
        return False
    
    print()
    print("🗑️  Deleting data...")
    print()
    
    async with async_session_maker() as db:
        # Delete in order to respect foreign keys
        print("   Deleting notifications...")
        result = await db.execute(delete(Notification))
        print(f"   ✓ Deleted {result.rowcount} notifications")
        
        print("   Deleting follow-ups...")
        result = await db.execute(delete(FollowUp))
        print(f"   ✓ Deleted {result.rowcount} follow-ups")
        
        print("   Deleting appointments...")
        result = await db.execute(delete(Appointment))
        print(f"   ✓ Deleted {result.rowcount} appointments")
        
        print("   Deleting activities...")
        result = await db.execute(delete(Activity))
        print(f"   ✓ Deleted {result.rowcount} activities")
        
        print("   Deleting leads...")
        result = await db.execute(delete(Lead))
        print(f"   ✓ Deleted {result.rowcount} leads")
        
        await db.commit()
    
    print()
    print("✅ All CRM data deleted successfully!")
    print("🔄 Leads will auto-sync from Google Sheets in the next sync cycle")
    print()
    return True


async def main():
    """Main function"""
    await delete_all_data()


if __name__ == "__main__":
    asyncio.run(main())
