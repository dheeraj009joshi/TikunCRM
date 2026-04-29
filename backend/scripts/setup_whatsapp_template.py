#!/usr/bin/env python3
"""
Setup WhatsApp Templates - Register Twilio Content Templates in the database.

Usage:
    python -m scripts.setup_whatsapp_template --content-sid HX... --name "template_name" --dealership-id UUID
    python -m scripts.setup_whatsapp_template --list  # List all templates
    python -m scripts.setup_whatsapp_template --verify-config --dealership-id UUID  # Verify Twilio config

Examples:
    # Register the Spanish initial_template for Toyoys South Atlanta
    python -m scripts.setup_whatsapp_template \
        --content-sid HX7e2d091fc3c44476fb5970255f95ae55 \
        --name "initial_template" \
        --variables '["1"]' \
        --dealership-id <dealership-uuid>
    
    # List existing templates
    python -m scripts.setup_whatsapp_template --list
    
    # Verify WhatsApp is configured for a dealership
    python -m scripts.setup_whatsapp_template --verify-config --dealership-id <dealership-uuid>
"""
import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import async_session_maker
from app.models.whatsapp_template import WhatsAppTemplate
from app.models.dealership import Dealership
from app.models.dealership_twilio_config import DealershipTwilioConfig
from app.services.dealership_twilio_config_service import get_effective_twilio_config


async def list_templates(db: AsyncSession) -> None:
    """List all WhatsApp templates."""
    result = await db.execute(
        select(WhatsAppTemplate, Dealership.name)
        .outerjoin(Dealership, WhatsAppTemplate.dealership_id == Dealership.id)
        .order_by(WhatsAppTemplate.name)
    )
    rows = result.all()
    
    if not rows:
        print("No WhatsApp templates found.")
        return
    
    print(f"\n{'='*80}")
    print(f"{'ID':<40} {'Name':<25} {'Content SID':<35}")
    print(f"{'Dealership':<40} {'Variables':<25}")
    print(f"{'='*80}")
    
    for template, dealership_name in rows:
        print(f"{str(template.id):<40} {template.name:<25} {template.content_sid:<35}")
        print(f"{(dealership_name or 'GLOBAL'):<40} {json.dumps(template.variable_names):<25}")
        print("-" * 80)


async def verify_whatsapp_config(db: AsyncSession, dealership_id: uuid.UUID) -> bool:
    """Verify WhatsApp is properly configured for a dealership."""
    # Get dealership
    result = await db.execute(
        select(Dealership).where(Dealership.id == dealership_id)
    )
    dealership = result.scalar_one_or_none()
    
    if not dealership:
        print(f"ERROR: Dealership {dealership_id} not found")
        return False
    
    print(f"\nDealership: {dealership.name}")
    print(f"ID: {dealership.id}")
    print("-" * 50)
    
    # Get effective Twilio config
    effective = await get_effective_twilio_config(db, dealership_id)
    
    print(f"\nTwilio Configuration:")
    print(f"  Account SID: {'✓ Set' if effective.account_sid else '✗ Missing'}")
    print(f"  Auth Token: {'✓ Set' if effective.auth_token else '✗ Missing'}")
    print(f"  WhatsApp Enabled: {'✓ Yes' if effective.whatsapp_enabled else '✗ No'}")
    print(f"  WhatsApp From Number: {effective.whatsapp_from_number or '✗ Not set'}")
    
    is_ready = effective.is_whatsapp_ready()
    print(f"\n  WhatsApp Ready: {'✓ YES' if is_ready else '✗ NO'}")
    
    if not is_ready:
        print("\n  To fix, ensure:")
        print("    1. whatsapp_enabled = true in dealership_twilio_configs")
        print("    2. account_sid and auth_token are set")
        print("    3. whatsapp_from_number is set to your WhatsApp-enabled Twilio number")
    
    # List templates for this dealership
    result = await db.execute(
        select(WhatsAppTemplate).where(
            (WhatsAppTemplate.dealership_id == dealership_id) |
            (WhatsAppTemplate.dealership_id.is_(None))
        )
    )
    templates = result.scalars().all()
    
    print(f"\n  Available Templates: {len(templates)}")
    for t in templates:
        scope = "GLOBAL" if t.dealership_id is None else "DEALERSHIP"
        print(f"    - {t.name} ({t.content_sid}) [{scope}]")
    
    return is_ready


async def register_template(
    db: AsyncSession,
    content_sid: str,
    name: str,
    variable_names: list[str],
    dealership_id: uuid.UUID | None,
) -> WhatsAppTemplate | None:
    """Register a new WhatsApp template."""
    # Check if template with same content_sid already exists
    result = await db.execute(
        select(WhatsAppTemplate).where(WhatsAppTemplate.content_sid == content_sid)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        print(f"Template with content_sid {content_sid} already exists:")
        print(f"  ID: {existing.id}")
        print(f"  Name: {existing.name}")
        print(f"  Variables: {existing.variable_names}")
        print(f"  Dealership ID: {existing.dealership_id or 'GLOBAL'}")
        return existing
    
    # Verify dealership exists if specified
    if dealership_id:
        result = await db.execute(
            select(Dealership).where(Dealership.id == dealership_id)
        )
        dealership = result.scalar_one_or_none()
        if not dealership:
            print(f"ERROR: Dealership {dealership_id} not found")
            return None
        print(f"Creating template for dealership: {dealership.name}")
    else:
        print("Creating GLOBAL template (available to all dealerships)")
    
    # Create template
    template = WhatsAppTemplate(
        content_sid=content_sid,
        name=name,
        variable_names=variable_names,
        dealership_id=dealership_id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    
    print(f"\n✓ Template registered successfully!")
    print(f"  ID: {template.id}")
    print(f"  Content SID: {template.content_sid}")
    print(f"  Name: {template.name}")
    print(f"  Variables: {template.variable_names}")
    
    return template


async def main():
    parser = argparse.ArgumentParser(description="Setup WhatsApp templates")
    parser.add_argument("--list", action="store_true", help="List all templates")
    parser.add_argument("--verify-config", action="store_true", help="Verify WhatsApp config for dealership")
    parser.add_argument("--content-sid", help="Twilio Content SID (e.g., HX...)")
    parser.add_argument("--name", help="Template name")
    parser.add_argument("--variables", default="[]", help="JSON array of variable names, e.g., '[\"1\", \"2\"]'")
    parser.add_argument("--dealership-id", help="Dealership UUID (omit for global template)")
    parser.add_argument("--global", dest="is_global", action="store_true", help="Create as global template")
    
    args = parser.parse_args()
    
    async with async_session_maker() as db:
        if args.list:
            await list_templates(db)
            return
        
        if args.verify_config:
            if not args.dealership_id:
                print("ERROR: --dealership-id required for --verify-config")
                sys.exit(1)
            try:
                dealership_uuid = uuid.UUID(args.dealership_id)
            except ValueError:
                print(f"ERROR: Invalid UUID: {args.dealership_id}")
                sys.exit(1)
            
            is_ready = await verify_whatsapp_config(db, dealership_uuid)
            sys.exit(0 if is_ready else 1)
        
        if args.content_sid and args.name:
            try:
                variables = json.loads(args.variables)
            except json.JSONDecodeError:
                print(f"ERROR: Invalid JSON for --variables: {args.variables}")
                sys.exit(1)
            
            dealership_id = None
            if args.dealership_id and not args.is_global:
                try:
                    dealership_id = uuid.UUID(args.dealership_id)
                except ValueError:
                    print(f"ERROR: Invalid UUID: {args.dealership_id}")
                    sys.exit(1)
            
            template = await register_template(
                db,
                content_sid=args.content_sid,
                name=args.name,
                variable_names=variables,
                dealership_id=dealership_id,
            )
            sys.exit(0 if template else 1)
        
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
