#!/usr/bin/env python3
"""
Send a test "New Lead" push notification to all dealership members.
This simulates exactly what happens when a new lead comes in.
Usage: python scripts/send_test_notification.py
"""
import asyncio
import sys
import os

# Add the backend directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from uuid import uuid4
from sqlalchemy import select
from app.db.database import async_session_maker
from app.models.user import User
from app.models.dealership import Dealership
from app.models.fcm_token import FCMToken
from app.services.fcm_service import FCMService, InvalidFCMTokenError
from app.core.config import settings


async def send_test_new_lead_notification():
    """
    Send a test 'New Lead' notification to ALL dealership members.
    This replicates the exact flow when a new lead comes in:
    - Notifies all active users in each dealership (owner, admin, salesperson)
    """
    
    print("=" * 70)
    print("TikunCRM - Test New Lead Notification (Dealership Broadcast)")
    print("=" * 70)
    
    # Check FCM configuration
    if not settings.is_fcm_configured:
        print("\n[ERROR] Firebase credentials not configured!")
        print("Set FCM_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS in your .env file")
        return
    
    fcm_service = FCMService()
    if not fcm_service.is_configured:
        print("\n[ERROR] FCM service not properly configured!")
        return
    
    print("\n[OK] FCM service is configured")
    
    async with async_session_maker() as db:
        # Get all dealerships
        dealership_result = await db.execute(select(Dealership).where(Dealership.is_active == True))
        dealerships = dealership_result.scalars().all()
        
        if not dealerships:
            print("\n[WARNING] No active dealerships found!")
            return
        
        print(f"\n[INFO] Found {len(dealerships)} active dealership(s)")
        
        total_success = 0
        total_fail = 0
        total_users_notified = 0
        
        # First, notify all SUPER_ADMINs (they see all leads across all dealerships)
        from app.models.user import UserRole
        super_admin_result = await db.execute(
            select(User, FCMToken)
            .outerjoin(FCMToken, (FCMToken.user_id == User.id) & (FCMToken.is_active == True))
            .where(
                User.role == UserRole.SUPER_ADMIN,
                User.is_active == True
            )
        )
        super_admin_rows = super_admin_result.fetchall()
        
        if super_admin_rows:
            print(f"\n{'='*70}")
            print("SUPER ADMINS (receive all dealership notifications)")
            print(f"{'='*70}")
            
            super_admin_tokens = {}
            for user, token in super_admin_rows:
                if user.id not in super_admin_tokens:
                    super_admin_tokens[user.id] = {"user": user, "tokens": []}
                if token:
                    super_admin_tokens[user.id]["tokens"].append(token)
            
            fake_lead_id = str(uuid4())
            fake_lead_name = "Sarah Johnson (Test Lead)"
            
            for user_id, data in super_admin_tokens.items():
                user = data["user"]
                tokens = data["tokens"]
                
                print(f"\n  [SUPER_ADMIN] {user.first_name} {user.last_name} ({user.email})")
                
                if not tokens:
                    print(f"           [SKIP] No FCM tokens registered")
                    continue
                
                print(f"           Devices: {len(tokens)}")
                total_users_notified += 1
                
                for token in tokens:
                    try:
                        success = await fcm_service.send(
                            token=token.token,
                            title="New Lead: " + fake_lead_name,
                            body="A new lead has been added (Super Admin notification)",
                            url=f"/leads/{fake_lead_id}",
                            tag=f"new-lead-{fake_lead_id}",
                            data={
                                "notification_type": "new_lead",
                                "lead_id": fake_lead_id,
                                "lead_name": fake_lead_name,
                            }
                        )
                        
                        if success:
                            device_name = token.device_name or "Unknown device"
                            print(f"           [OK] {device_name} - sent successfully")
                            total_success += 1
                        else:
                            print(f"           [FAIL] Token {token.token[:15]}... - send returned False")
                            total_fail += 1
                                
                except InvalidFCMTokenError as e:
                    print(f"           [INVALID] Token {token.token[:15]}... - {e}")
                    await db.delete(token)
                    print(f"           [DELETED] Removed invalid token from database")
                    total_fail += 1
                    except Exception as e:
                        print(f"           [ERROR] Token {token.token[:15]}... - {e}")
                        total_fail += 1
        
        for dealership in dealerships:
            print(f"\n{'='*70}")
            print(f"DEALERSHIP: {dealership.name}")
            print(f"{'='*70}")
            
            # Get all active users in this dealership with their FCM tokens
            result = await db.execute(
                select(User, FCMToken)
                .outerjoin(FCMToken, (FCMToken.user_id == User.id) & (FCMToken.is_active == True))
                .where(
                    User.dealership_id == dealership.id,
                    User.is_active == True
                )
            )
            rows = result.fetchall()
            
            # Group by user
            user_tokens = {}
            for user, token in rows:
                if user.id not in user_tokens:
                    user_tokens[user.id] = {
                        "user": user,
                        "tokens": []
                    }
                if token:  # User may have no tokens
                    user_tokens[user.id]["tokens"].append(token)
            
            if not user_tokens:
                print("  [INFO] No active users in this dealership")
                continue
            
            print(f"  [INFO] {len(user_tokens)} team member(s) to notify:")
            
            # Fake lead data for this dealership
            fake_lead_id = str(uuid4())
            fake_lead_name = "Sarah Johnson (Test Lead)"
            fake_source = "Google Sheets"
            
            for user_id, data in user_tokens.items():
                user = data["user"]
                tokens = data["tokens"]
                role_display = user.role.value.upper() if user.role else "USER"
                
                print(f"\n  [{role_display}] {user.first_name} {user.last_name} ({user.email})")
                
                if not tokens:
                    print(f"           [SKIP] No FCM tokens registered (push notifications not enabled)")
                    continue
                
                print(f"           Devices: {len(tokens)}")
                total_users_notified += 1
                
                for token in tokens:
                    try:
                        success = await fcm_service.send(
                            token=token.token,
                            title="New Lead: " + fake_lead_name,
                            body=f"A new lead from {fake_source} has been added to {dealership.name}",
                            url=f"/leads/{fake_lead_id}",
                            tag=f"new-lead-{fake_lead_id}",
                            data={
                                "notification_type": "new_lead",
                                "lead_id": fake_lead_id,
                                "lead_name": fake_lead_name,
                                "dealership_id": str(dealership.id),
                                "dealership_name": dealership.name,
                                "source": fake_source,
                            }
                        )
                        
                        if success:
                            device_name = token.device_name or "Unknown device"
                            print(f"           [OK] {device_name} - sent successfully")
                            total_success += 1
                        else:
                            print(f"           [FAIL] Token {token.token[:15]}... - send returned False")
                            total_fail += 1
                                
                    except InvalidFCMTokenError as e:
                        print(f"           [INVALID] Token {token.token[:15]}... - {e}")
                        await db.delete(token)
                        print(f"           [DELETED] Removed invalid token from database")
                        total_fail += 1
                    except Exception as e:
                        print(f"           [ERROR] Token {token.token[:15]}... - {e}")
                        total_fail += 1
        
        await db.commit()
        
        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)
        print(f"  Dealerships processed: {len(dealerships)}")
        print(f"  Users notified: {total_users_notified}")
        print(f"  Notifications sent: {total_success}")
        print(f"  Notifications failed: {total_fail}")
        print("=" * 70)


if __name__ == "__main__":
    asyncio.run(send_test_new_lead_notification())
