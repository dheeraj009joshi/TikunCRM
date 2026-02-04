"""
Data Export and Migration Script

This script will:
1. Export all CRM data (leads, activities, appointments, follow-ups, notes, etc.)
2. Fix timestamp inconsistencies
3. Provide functions to delete and re-import data

Usage:
    # Export data
    python data_migration.py export
    
    # Delete all data (DANGEROUS!)
    python data_migration.py delete
    
    # Re-import data
    python data_migration.py import
"""
import asyncio
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List
import sys

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

from app.db.database import async_session_maker
from app.models.lead import Lead
from app.models.activity import Activity
from app.models.appointment import Appointment
from app.models.follow_up import FollowUp
from app.models.user import User
from app.models.dealership import Dealership
from app.models.notification import Notification

# Export directory
EXPORT_DIR = Path(__file__).parent / "data_export"
EXPORT_DIR.mkdir(exist_ok=True)


async def export_data():
    """Export all CRM data to JSON files"""
    print("🔄 Starting data export...")
    
    async with async_session_maker() as db:
        # Export dealerships
        print("📊 Exporting dealerships...")
        dealerships_result = await db.execute(select(Dealership))
        dealerships = dealerships_result.scalars().all()
        dealerships_data = [
            {
                "id": str(d.id),
                "name": d.name,
                "address": d.address,
                "city": d.city,
                "state": d.state,
                "zip_code": d.zip_code,
                "phone": d.phone,
                "email": d.email,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in dealerships
        ]
        
        # Export users
        print("👥 Exporting users...")
        users_result = await db.execute(select(User))
        users = users_result.scalars().all()
        users_data = [
            {
                "id": str(u.id),
                "email": u.email,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "role": u.role.value,
                "dealership_id": str(u.dealership_id) if u.dealership_id else None,
                "phone": u.phone,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]
        
        # Export leads
        print("📋 Exporting leads...")
        leads_result = await db.execute(select(Lead))
        leads = leads_result.scalars().all()
        leads_data = [
            {
                "id": str(l.id),
                "first_name": l.first_name,
                "last_name": l.last_name,
                "email": l.email,
                "phone": l.phone,
                "status": l.status.value,
                "source": l.source,
                "dealership_id": str(l.dealership_id) if l.dealership_id else None,
                "assigned_to": str(l.assigned_to) if l.assigned_to else None,
                "created_at": l.created_at.isoformat() if l.created_at else None,
                "updated_at": l.updated_at.isoformat() if l.updated_at else None,
            }
            for l in leads
        ]
        
        # Export activities
        print("📝 Exporting activities...")
        activities_result = await db.execute(select(Activity))
        activities = activities_result.scalars().all()
        activities_data = [
            {
                "id": str(a.id),
                "lead_id": str(a.lead_id),
                "user_id": str(a.user_id) if a.user_id else None,
                "type": a.type.value,
                "description": a.description,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in activities
        ]
        
        # Export appointments
        print("📅 Exporting appointments...")
        appointments_result = await db.execute(select(Appointment))
        appointments = appointments_result.scalars().all()
        appointments_data = [
            {
                "id": str(a.id),
                "title": a.title,
                "description": a.description,
                "scheduled_at": a.scheduled_at.isoformat() if a.scheduled_at else None,
                "location": a.location,
                "lead_id": str(a.lead_id) if a.lead_id else None,
                "assigned_to": str(a.assigned_to) if a.assigned_to else None,
                "status": a.status.value,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in appointments
        ]
        
        # Export follow-ups
        print("⏰ Exporting follow-ups...")
        followups_result = await db.execute(select(FollowUp))
        followups = followups_result.scalars().all()
        followups_data = [
            {
                "id": str(f.id),
                "lead_id": str(f.lead_id),
                "assigned_to": str(f.assigned_to),
                "scheduled_at": f.scheduled_at.isoformat() if f.scheduled_at else None,
                "notes": f.notes,
                "status": f.status.value,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in followups
        ]
    
    # Create export package
    export_package = {
        "export_timestamp": datetime.utcnow().isoformat(),
        "dealerships": dealerships_data,
        "users": users_data,
        "leads": leads_data,
        "activities": activities_data,
        "appointments": appointments_data,
        "followups": followups_data,
    }
    
    # Save to JSON
    export_file = EXPORT_DIR / f"crm_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    with open(export_file, 'w') as f:
        json.dump(export_package, f, indent=2)
    
    print(f"✅ Data exported successfully to: {export_file}")
    print(f"📊 Summary:")
    print(f"   - Dealerships: {len(dealerships_data)}")
    print(f"   - Users: {len(users_data)}")
    print(f"   - Leads: {len(leads_data)}")
    print(f"   - Activities: {len(activities_data)}")
    print(f"   - Appointments: {len(appointments_data)}")
    print(f"   - Follow-ups: {len(followups_data)}")
    
    return export_file


async def fix_timestamps(export_file: Path):
    """Fix timestamp inconsistencies in exported data"""
    print(f"🔧 Fixing timestamps in {export_file}...")
    
    with open(export_file, 'r') as f:
        data = json.load(f)
    
    # Create lead_id to created_at mapping
    lead_times = {
        lead["id"]: datetime.fromisoformat(lead["created_at"])
        for lead in data["leads"]
        if lead["created_at"]
    }
    
    fixed_count = 0
    
    # Fix activities - ensure they're after lead creation
    for activity in data["activities"]:
        if activity["lead_id"] in lead_times and activity["created_at"]:
            lead_created = lead_times[activity["lead_id"]]
            activity_created = datetime.fromisoformat(activity["created_at"])
            
            # If activity is before lead creation, adjust it
            if activity_created < lead_created:
                # Set activity to 1 minute after lead creation
                new_time = lead_created + timedelta(minutes=1)
                activity["created_at"] = new_time.isoformat()
                fixed_count += 1
                print(f"   Fixed activity {activity['id']}: {activity_created} -> {new_time}")
    
    # Fix appointments - ensure they're after lead creation
    for appointment in data["appointments"]:
        if appointment["lead_id"] and appointment["lead_id"] in lead_times:
            lead_created = lead_times[appointment["lead_id"]]
            if appointment["created_at"]:
                appt_created = datetime.fromisoformat(appointment["created_at"])
                if appt_created < lead_created:
                    new_time = lead_created + timedelta(minutes=2)
                    appointment["created_at"] = new_time.isoformat()
                    fixed_count += 1
    
    # Fix follow-ups - ensure they're after lead creation
    for followup in data["followups"]:
        if followup["lead_id"] in lead_times and followup["created_at"]:
            lead_created = lead_times[followup["lead_id"]]
            fu_created = datetime.fromisoformat(followup["created_at"])
            if fu_created < lead_created:
                new_time = lead_created + timedelta(minutes=3)
                followup["created_at"] = new_time.isoformat()
                fixed_count += 1
    
    # Save fixed data
    fixed_file = EXPORT_DIR / f"crm_export_FIXED_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    with open(fixed_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"✅ Fixed {fixed_count} timestamp inconsistencies")
    print(f"💾 Saved fixed data to: {fixed_file}")
    
    return fixed_file


async def delete_all_data():
    """DANGER: Delete all CRM data (except users and dealerships)"""
    print("⚠️  WARNING: This will delete ALL CRM data!")
    print("   (Users and dealerships will be preserved)")
    
    confirm = input("Type 'DELETE ALL DATA' to confirm: ")
    if confirm != "DELETE ALL DATA":
        print("❌ Deletion cancelled")
        return False
    
    print("🗑️  Deleting data...")
    
    async with async_session_maker() as db:
        # Delete in order to respect foreign keys
        await db.execute(delete(Note))
        print("   ✓ Deleted notes")
        
        await db.execute(delete(Communication))
        print("   ✓ Deleted communications")
        
        await db.execute(delete(Notification))
        print("   ✓ Deleted notifications")
        
        await db.execute(delete(FollowUp))
        print("   ✓ Deleted follow-ups")
        
        await db.execute(delete(Appointment))
        print("   ✓ Deleted appointments")
        
        await db.execute(delete(Activity))
        print("   ✓ Deleted activities")
        
        await db.execute(delete(Lead))
        print("   ✓ Deleted leads")
        
        await db.commit()
    
    print("✅ All CRM data deleted successfully")
    return True


async def import_data(import_file: Path):
    """Import data from JSON file"""
    print(f"📥 Importing data from {import_file}...")
    
    with open(import_file, 'r') as f:
        data = json.load(f)
    
    async with async_session_maker() as db:
        # Import leads first
        print("📋 Importing leads...")
        for lead_data in data["leads"]:
            lead = Lead(
                id=lead_data["id"],
                first_name=lead_data["first_name"],
                last_name=lead_data["last_name"],
                email=lead_data["email"],
                phone=lead_data["phone"],
                status=lead_data["status"],
                source=lead_data["source"],
                dealership_id=lead_data["dealership_id"],
                assigned_to=lead_data["assigned_to"],
                created_at=datetime.fromisoformat(lead_data["created_at"]) if lead_data["created_at"] else None,
                updated_at=datetime.fromisoformat(lead_data["updated_at"]) if lead_data["updated_at"] else None,
            )
            db.add(lead)
        await db.flush()
        print(f"   ✓ Imported {len(data['leads'])} leads")
        
        # Import activities
        print("📝 Importing activities...")
        for activity_data in data["activities"]:
            activity = Activity(
                id=activity_data["id"],
                lead_id=activity_data["lead_id"],
                user_id=activity_data["user_id"],
                type=activity_data["type"],
                description=activity_data["description"],
                created_at=datetime.fromisoformat(activity_data["created_at"]) if activity_data["created_at"] else None,
            )
            db.add(activity)
        await db.flush()
        print(f"   ✓ Imported {len(data['activities'])} activities")
        
        # Import appointments
        print("📅 Importing appointments...")
        for appt_data in data["appointments"]:
            appointment = Appointment(
                id=appt_data["id"],
                title=appt_data["title"],
                description=appt_data["description"],
                scheduled_at=datetime.fromisoformat(appt_data["scheduled_at"]) if appt_data["scheduled_at"] else None,
                location=appt_data["location"],
                lead_id=appt_data["lead_id"],
                assigned_to=appt_data["assigned_to"],
                status=appt_data["status"],
                created_at=datetime.fromisoformat(appt_data["created_at"]) if appt_data["created_at"] else None,
            )
            db.add(appointment)
        await db.flush()
        print(f"   ✓ Imported {len(data['appointments'])} appointments")
        
        # Import follow-ups
        print("⏰ Importing follow-ups...")
        for fu_data in data["followups"]:
            followup = FollowUp(
                id=fu_data["id"],
                lead_id=fu_data["lead_id"],
                assigned_to=fu_data["assigned_to"],
                scheduled_at=datetime.fromisoformat(fu_data["scheduled_at"]) if fu_data["scheduled_at"] else None,
                notes=fu_data["notes"],
                status=fu_data["status"],
                created_at=datetime.fromisoformat(fu_data["created_at"]) if fu_data["created_at"] else None,
            )
            db.add(followup)
        await db.flush()
        print(f"   ✓ Imported {len(data['followups'])} follow-ups")
        
        # Import notes
        print("📌 Importing notes...")
        for note_data in data["notes"]:
            note = Note(
                id=note_data["id"],
                lead_id=note_data["lead_id"],
                user_id=note_data["user_id"],
                content=note_data["content"],
                created_at=datetime.fromisoformat(note_data["created_at"]) if note_data["created_at"] else None,
            )
            db.add(note)
        await db.flush()
        print(f"   ✓ Imported {len(data['notes'])} notes")
        
        await db.commit()
    
    print("✅ Data import completed successfully!")


async def main():
    """Main function"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python data_migration.py export         - Export all data")
        print("  python data_migration.py fix <file>     - Fix timestamps in export file")
        print("  python data_migration.py delete         - Delete all data (DANGEROUS!)")
        print("  python data_migration.py import <file>  - Import data from file")
        print("  python data_migration.py full           - Full migration (export, fix, delete, import)")
        return
    
    command = sys.argv[1]
    
    if command == "export":
        await export_data()
    
    elif command == "fix":
        if len(sys.argv) < 3:
            print("❌ Please provide export file path")
            return
        export_file = Path(sys.argv[2])
        await fix_timestamps(export_file)
    
    elif command == "delete":
        await delete_all_data()
    
    elif command == "import":
        if len(sys.argv) < 3:
            print("❌ Please provide import file path")
            return
        import_file = Path(sys.argv[2])
        await import_data(import_file)
    
    elif command == "full":
        print("🚀 Starting full data migration...")
        print()
        
        # Step 1: Export
        export_file = await export_data()
        print()
        
        # Step 2: Fix timestamps
        fixed_file = await fix_timestamps(export_file)
        print()
        
        # Step 3: Delete
        deleted = await delete_all_data()
        if not deleted:
            print("❌ Migration cancelled")
            return
        print()
        
        # Step 4: Import
        await import_data(fixed_file)
        print()
        
        print("🎉 Full migration completed successfully!")
    
    else:
        print(f"❌ Unknown command: {command}")


if __name__ == "__main__":
    asyncio.run(main())
