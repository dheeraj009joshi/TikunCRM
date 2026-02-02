"""
Database Seed Script - Demo Data for Multi-Level CRM

This script creates demo data including:
- 1 Super Admin
- 3 Dealerships with Admins
- 5 Salespersons per dealership
- 100+ sample leads across various statuses

Usage:
    python -m scripts.seed_demo

Or from project root:
    cd backend && python -m scripts.seed_demo
"""

import asyncio
import random
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user import User
from app.models.dealership import Dealership
from app.models.lead import Lead, LeadStatus, LeadSource
from app.models.activity import Activity, ActivityType
from app.core.permissions import UserRole
from app.db.database import Base


# Demo data
DEALERSHIPS = [
    {
        "name": "Premium Motors North",
        "address": "123 Auto Mall Drive",
        "city": "Chicago",
        "state": "IL",
        "country": "USA",
        "postal_code": "60601",
        "phone": "+1 312 555 0100",
        "email": "north@premiummotors.com",
    },
    {
        "name": "Premium Motors Downtown",
        "address": "456 Michigan Ave",
        "city": "Chicago",
        "state": "IL",
        "country": "USA",
        "postal_code": "60611",
        "phone": "+1 312 555 0200",
        "email": "downtown@premiummotors.com",
    },
    {
        "name": "Premium Motors South",
        "address": "789 Lakeside Blvd",
        "city": "Chicago",
        "state": "IL",
        "country": "USA",
        "postal_code": "60616",
        "phone": "+1 312 555 0300",
        "email": "south@premiummotors.com",
    },
]

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
    "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Lisa", "Daniel", "Nancy",
    "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
    "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle"
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson"
]

INTERESTS = [
    "2024 BMW X5 m60i",
    "2024 Mercedes-Benz GLC 300",
    "2024 Audi Q7 Premium",
    "2024 Lexus RX 350",
    "2024 Porsche Cayenne",
    "2024 Tesla Model X",
    "2024 Range Rover Sport",
    "2024 BMW 5 Series",
    "2024 Mercedes-Benz E-Class",
    "2024 Audi A6",
]

BUDGET_RANGES = [
    "$40,000 - $50,000",
    "$50,000 - $60,000",
    "$60,000 - $75,000",
    "$75,000 - $90,000",
    "$90,000 - $110,000",
    "$110,000 - $130,000",
]

SALESPERSON_NAMES = [
    ("Sarah", "Jenkins"),
    ("Michael", "Chen"),
    ("Emily", "Rodriguez"),
    ("James", "Wilson"),
    ("Amanda", "Taylor"),
    ("David", "Brown"),
    ("Jessica", "Martinez"),
    ("Ryan", "Anderson"),
    ("Nicole", "Thompson"),
    ("Brandon", "Garcia"),
    ("Stephanie", "Lee"),
    ("Kevin", "White"),
    ("Rachel", "Harris"),
    ("Justin", "Clark"),
    ("Megan", "Lewis"),
]


def random_phone():
    """Generate a random phone number"""
    return f"+1 {random.randint(200, 999)} {random.randint(100, 999)} {random.randint(1000, 9999)}"


def random_email(first_name: str, last_name: str) -> str:
    """Generate a random email"""
    domains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"]
    return f"{first_name.lower()}.{last_name.lower()}{random.randint(1, 99)}@{random.choice(domains)}"


def random_date(days_back: int = 60) -> datetime:
    """Generate a random date within the past N days"""
    return datetime.utcnow() - timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59)
    )


async def seed_database():
    """Main seed function"""
    # Create async engine and session
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        print("Starting database seeding...")
        
        # 1. Create Super Admin
        print("\n[1/5] Creating Super Admin...")
        super_admin = User(
            id=uuid4(),
            email="admin@leedscrm.com",
            password_hash=get_password_hash("admin123"),
            first_name="System",
            last_name="Administrator",
            phone="+1 800 555 0000",
            role=UserRole.SUPER_ADMIN,
            dealership_id=None,
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        session.add(super_admin)
        print(f"   Created: {super_admin.email} (password: admin123)")
        
        # 2. Create Dealerships
        print("\n[2/5] Creating Dealerships...")
        dealership_objects = []
        for d_data in DEALERSHIPS:
            dealership = Dealership(
                id=uuid4(),
                name=d_data["name"],
                address=d_data["address"],
                city=d_data["city"],
                state=d_data["state"],
                country=d_data["country"],
                postal_code=d_data["postal_code"],
                phone=d_data["phone"],
                email=d_data["email"],
                config={},
                working_hours={
                    "monday": {"start": "09:00", "end": "18:00", "is_open": True},
                    "tuesday": {"start": "09:00", "end": "18:00", "is_open": True},
                    "wednesday": {"start": "09:00", "end": "18:00", "is_open": True},
                    "thursday": {"start": "09:00", "end": "18:00", "is_open": True},
                    "friday": {"start": "09:00", "end": "18:00", "is_open": True},
                    "saturday": {"start": "10:00", "end": "16:00", "is_open": True},
                    "sunday": {"start": "00:00", "end": "00:00", "is_open": False},
                },
                lead_assignment_rules={
                    "auto_assign": True,
                    "round_robin": True,
                    "max_leads_per_salesperson": 50
                },
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            session.add(dealership)
            dealership_objects.append(dealership)
            print(f"   Created: {dealership.name}")
        
        # 3. Create Dealership Admins
        print("\n[3/5] Creating Dealership Admins...")
        dealership_admins = []
        admin_names = [("John", "Mitchell"), ("Lisa", "Parker"), ("Robert", "Williams")]
        
        for i, dealership in enumerate(dealership_objects):
            first, last = admin_names[i]
            admin = User(
                id=uuid4(),
                email=f"{first.lower()}.{last.lower()}@premiummotors.com",
                password_hash=get_password_hash("dealer123"),
                first_name=first,
                last_name=last,
                phone=random_phone(),
                role=UserRole.DEALERSHIP_ADMIN,
                dealership_id=dealership.id,
                is_active=True,
                is_verified=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            session.add(admin)
            dealership_admins.append(admin)
            print(f"   Created: {admin.email} for {dealership.name} (password: dealer123)")
        
        # 4. Create Salespersons
        print("\n[4/5] Creating Salespersons (5 per dealership)...")
        salespersons_by_dealership = {}
        name_index = 0
        
        for dealership in dealership_objects:
            salespersons_by_dealership[dealership.id] = []
            
            for _ in range(5):
                first, last = SALESPERSON_NAMES[name_index % len(SALESPERSON_NAMES)]
                name_index += 1
                
                salesperson = User(
                    id=uuid4(),
                    email=f"{first.lower()}.{last.lower()}{name_index}@premiummotors.com",
                    password_hash=get_password_hash("sales123"),
                    first_name=first,
                    last_name=last,
                    phone=random_phone(),
                    role=UserRole.SALESPERSON,
                    dealership_id=dealership.id,
                    is_active=True,
                    is_verified=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(salesperson)
                salespersons_by_dealership[dealership.id].append(salesperson)
            
            print(f"   Created 5 salespersons for {dealership.name} (password: sales123)")
        
        # 5. Create Leads
        print("\n[5/5] Creating Leads...")
        leads_created = 0
        
        # Status distribution
        status_weights = {
            LeadStatus.NEW: 15,
            LeadStatus.CONTACTED: 20,
            LeadStatus.FOLLOW_UP: 25,
            LeadStatus.INTERESTED: 15,
            LeadStatus.NOT_INTERESTED: 10,
            LeadStatus.CONVERTED: 10,
            LeadStatus.LOST: 5,
        }
        statuses = list(status_weights.keys())
        weights = list(status_weights.values())
        
        # Source distribution
        sources = [LeadSource.META_ADS, LeadSource.GOOGLE_SHEETS, LeadSource.MANUAL, 
                   LeadSource.WEBSITE, LeadSource.REFERRAL, LeadSource.WALK_IN]
        
        # Create unassigned leads (for Super Admin pool)
        print("   Creating 20 unassigned leads...")
        for _ in range(20):
            first_name = random.choice(FIRST_NAMES)
            last_name = random.choice(LAST_NAMES)
            
            lead = Lead(
                id=uuid4(),
                first_name=first_name,
                last_name=last_name,
                email=random_email(first_name, last_name),
                phone=random_phone(),
                source=random.choice(sources),
                status=LeadStatus.NEW,
                dealership_id=None,  # Unassigned
                assigned_to=None,
                created_by=super_admin.id,
                notes="Lead from external source, pending dealership assignment.",
                meta_data={"source_campaign": "General Marketing"},
                interested_in=random.choice(INTERESTS),
                budget_range=random.choice(BUDGET_RANGES),
                created_at=random_date(30),
                updated_at=datetime.utcnow()
            )
            session.add(lead)
            leads_created += 1
        
        # Create leads per dealership
        for dealership in dealership_objects:
            salespersons = salespersons_by_dealership[dealership.id]
            
            # Leads assigned to dealership but not to salesperson
            print(f"   Creating 10 unassigned-to-salesperson leads for {dealership.name}...")
            for _ in range(10):
                first_name = random.choice(FIRST_NAMES)
                last_name = random.choice(LAST_NAMES)
                
                lead = Lead(
                    id=uuid4(),
                    first_name=first_name,
                    last_name=last_name,
                    email=random_email(first_name, last_name),
                    phone=random_phone(),
                    source=random.choice(sources),
                    status=LeadStatus.NEW,
                    dealership_id=dealership.id,
                    assigned_to=None,  # Not assigned to salesperson yet
                    notes="Awaiting salesperson assignment.",
                    meta_data={},
                    interested_in=random.choice(INTERESTS),
                    budget_range=random.choice(BUDGET_RANGES),
                    created_at=random_date(14),
                    updated_at=datetime.utcnow()
                )
                session.add(lead)
                leads_created += 1
            
            # Leads assigned to salespersons
            leads_per_salesperson = 10
            print(f"   Creating {leads_per_salesperson * len(salespersons)} assigned leads for {dealership.name}...")
            
            for salesperson in salespersons:
                for _ in range(leads_per_salesperson):
                    first_name = random.choice(FIRST_NAMES)
                    last_name = random.choice(LAST_NAMES)
                    status = random.choices(statuses, weights=weights)[0]
                    created_at = random_date(60)
                    
                    lead = Lead(
                        id=uuid4(),
                        first_name=first_name,
                        last_name=last_name,
                        email=random_email(first_name, last_name),
                        phone=random_phone(),
                        source=random.choice(sources),
                        status=status,
                        dealership_id=dealership.id,
                        assigned_to=salesperson.id,
                        created_by=salesperson.id,
                        notes=f"Assigned to {salesperson.first_name} {salesperson.last_name}",
                        meta_data={},
                        interested_in=random.choice(INTERESTS),
                        budget_range=random.choice(BUDGET_RANGES),
                        first_contacted_at=created_at + timedelta(hours=random.randint(1, 48)) if status != LeadStatus.NEW else None,
                        last_contacted_at=created_at + timedelta(days=random.randint(1, 7)) if status not in [LeadStatus.NEW, LeadStatus.LOST] else None,
                        converted_at=datetime.utcnow() - timedelta(days=random.randint(1, 14)) if status == LeadStatus.CONVERTED else None,
                        created_at=created_at,
                        updated_at=datetime.utcnow()
                    )
                    session.add(lead)
                    leads_created += 1
                    
                    # Add activity for lead creation
                    activity = Activity(
                        id=uuid4(),
                        type=ActivityType.LEAD_CREATED,
                        description=f"Lead created",
                        user_id=salesperson.id,
                        lead_id=lead.id,
                        dealership_id=dealership.id,
                        meta_data={"source": lead.source.value},
                        created_at=created_at
                    )
                    session.add(activity)
        
        # Commit all changes
        await session.commit()
        
        print("\n" + "=" * 50)
        print("SEEDING COMPLETE!")
        print("=" * 50)
        print(f"\nCreated:")
        print(f"  - 1 Super Admin")
        print(f"  - {len(dealership_objects)} Dealerships")
        print(f"  - {len(dealership_admins)} Dealership Admins")
        print(f"  - {sum(len(s) for s in salespersons_by_dealership.values())} Salespersons")
        print(f"  - {leads_created} Leads")
        print(f"\nLogin Credentials:")
        print(f"  Super Admin:       admin@leedscrm.com / admin123")
        print(f"  Dealership Admin:  john.mitchell@premiummotors.com / dealer123")
        print(f"  Salesperson:       sarah.jenkins1@premiummotors.com / sales123")
        print()


if __name__ == "__main__":
    asyncio.run(seed_database())
