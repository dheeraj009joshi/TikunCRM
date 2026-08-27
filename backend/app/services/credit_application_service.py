"""
Credit application service — prefill, draft save, submit, SSN encryption.
"""
from __future__ import annotations

import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value, encrypt_value
from app.core.timezone import utc_now
from app.models.activity import ActivityType
from app.models.customer import Customer
from app.models.guest import Guest
from app.models.lead import Lead
from app.models.lead_credit_application import (
    CreditApplicationStatus,
    LeadCreditApplication,
)
from app.models.user import User
from app.schemas.credit_application import (
    ApplicantSection,
    BankReferenceSection,
    AuthorizationSection,
    CreditApplicationResponse,
    CreditApplicationUpdate,
    DealerSection,
    OtherIncomeSection,
    ReferenceSection,
)
from app.services.activity import ActivityService


def mask_ssn(ssn: Optional[str]) -> Optional[str]:
    if not ssn:
        return None
    digits = re.sub(r"\D", "", ssn)
    if len(digits) < 4:
        return "***"
    return f"***-**-{digits[-4:]}"


def _section_to_dict(section: Any) -> Optional[dict]:
    if section is None:
        return None
    if hasattr(section, "model_dump"):
        data = section.model_dump(exclude_none=False)
    elif isinstance(section, dict):
        data = dict(section)
    else:
        return None
    data.pop("ssn", None)
    data.pop("ssn_masked", None)
    return data


def _dict_to_applicant(data: Optional[dict], ssn_masked: Optional[str]) -> Optional[ApplicantSection]:
    if not data and not ssn_masked:
        return None
    payload = dict(data or {})
    payload.pop("ssn", None)
    if ssn_masked:
        payload["ssn_masked"] = ssn_masked
    return ApplicantSection(**payload)


class CreditApplicationService:
    @staticmethod
    async def get_or_create(
        db: AsyncSession,
        lead: Lead,
        current_user: User,
    ) -> LeadCreditApplication:
        result = await db.execute(
            select(LeadCreditApplication).where(LeadCreditApplication.lead_id == lead.id)
        )
        app = result.scalar_one_or_none()
        if app:
            return app

        lead_with_ctx = await CreditApplicationService._load_lead_context(db, lead.id)

        app = LeadCreditApplication(
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            status=CreditApplicationStatus.DRAFT.value,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        CreditApplicationService._apply_prefill(lead_with_ctx, app)
        db.add(app)
        await db.flush()
        return app

    @staticmethod
    def _apply_prefill(lead: Lead, app: LeadCreditApplication) -> None:
        customer: Optional[Customer] = getattr(lead, "customer", None)
        guest: Optional[Guest] = getattr(lead, "guest", None)

        applicant_a: dict[str, Any] = {}
        if customer:
            name = f"{customer.first_name or ''} {customer.last_name or ''}".strip()
            if name:
                applicant_a["full_name"] = name
            if customer.date_of_birth:
                applicant_a["date_of_birth"] = customer.date_of_birth.isoformat()
            residence: dict[str, Any] = {}
            if customer.address:
                residence["street"] = customer.address
            if customer.city:
                residence["city"] = customer.city
            if customer.state:
                residence["state"] = customer.state
            if customer.postal_code:
                residence["zip"] = customer.postal_code
            if customer.phone:
                residence["cell_phone"] = customer.phone
            if residence:
                applicant_a["current_residence"] = residence

        if applicant_a:
            app.applicant_a = applicant_a

        dealer: dict[str, Any] = {}
        vehicle: dict[str, Any] = {}
        if lead.interested_in:
            vehicle["model"] = lead.interested_in
        if lead.down_payment is not None:
            dealer["cash_down"] = float(lead.down_payment)
        if lead.budget_range:
            dealer["amount_financed"] = None

        if guest:
            if guest.vehicle_of_interest:
                vehicle["model"] = guest.vehicle_of_interest
            trade: dict[str, Any] = {}
            if guest.trade_in:
                trade["model"] = guest.trade_in
            if guest.payoff is not None:
                trade["payoff"] = float(guest.payoff)
            if guest.payoff_bank:
                trade["lienholder"] = guest.payoff_bank
            if guest.miles is not None:
                vehicle["mileage"] = str(guest.miles)
            if guest.down_payment is not None and dealer.get("cash_down") is None:
                dealer["cash_down"] = float(guest.down_payment)
            if trade:
                dealer["trade_in"] = trade

        if vehicle:
            dealer["vehicle"] = vehicle
        if dealer:
            app.dealer_section = dealer

    @staticmethod
    async def _load_lead_context(db: AsyncSession, lead_id: UUID) -> Lead:
        result = await db.execute(
            select(Lead)
            .where(Lead.id == lead_id)
            .options()
        )
        lead = result.scalar_one_or_none()
        if not lead:
            raise ValueError("Lead not found")
        cust_r = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        lead.customer = cust_r.scalar_one_or_none()
        guest_r = await db.execute(select(Guest).where(Guest.lead_id == lead.id))
        lead.guest = guest_r.scalar_one_or_none()
        return lead

    @staticmethod
    async def save_draft(
        db: AsyncSession,
        app: LeadCreditApplication,
        body: CreditApplicationUpdate,
        current_user: User,
    ) -> LeadCreditApplication:
        if app.status == CreditApplicationStatus.SUBMITTED.value:
            if body.revert_to_draft:
                app.status = CreditApplicationStatus.DRAFT.value
                app.submitted_at = None
                app.submitted_by = None
            else:
                from fastapi import HTTPException
                raise HTTPException(
                    status_code=400,
                    detail="Application is submitted. Set revert_to_draft to edit.",
                )

        if body.transaction_type is not None:
            app.transaction_type = body.transaction_type
        if body.application_type is not None:
            app.application_type = body.application_type
        if body.app_number is not None:
            app.app_number = body.app_number.strip() or None

        if body.applicant_a is not None:
            app.applicant_a = _section_to_dict(body.applicant_a)
            if body.applicant_a.ssn is not None:
                ssn = body.applicant_a.ssn.strip()
                app.applicant_a_ssn_encrypted = encrypt_value(ssn) if ssn else None
                if app.applicant_a:
                    app.applicant_a.pop("ssn", None)

        if body.applicant_b is not None:
            app.applicant_b = _section_to_dict(body.applicant_b)
            if body.applicant_b.ssn is not None:
                ssn = body.applicant_b.ssn.strip()
                app.applicant_b_ssn_encrypted = encrypt_value(ssn) if ssn else None
                if app.applicant_b:
                    app.applicant_b.pop("ssn", None)

        if body.other_income is not None:
            app.other_income = _section_to_dict(body.other_income)
        if body.reference is not None:
            app.reference = _section_to_dict(body.reference)
        if body.bank_reference is not None:
            app.bank_reference = _section_to_dict(body.bank_reference)
        if body.authorization is not None:
            app.authorization = _section_to_dict(body.authorization)
        if body.dealer_section is not None:
            app.dealer_section = _section_to_dict(body.dealer_section)

        app.updated_by = current_user.id
        app.updated_at = utc_now()
        await db.flush()
        return app

    @staticmethod
    async def submit(
        db: AsyncSession,
        app: LeadCreditApplication,
        lead: Lead,
        current_user: User,
    ) -> LeadCreditApplication:
        app.status = CreditApplicationStatus.SUBMITTED.value
        app.submitted_by = current_user.id
        app.submitted_at = utc_now()
        app.updated_by = current_user.id
        app.updated_at = utc_now()

        await CreditApplicationService._sync_to_customer_and_guest(db, lead, app)

        meta = dict(lead.meta_data or {})
        meta.pop("credit_app_initiated_at", None)
        lead.meta_data = meta

        performer_name = f"{current_user.first_name} {current_user.last_name}".strip()
        await ActivityService.log_activity(
            db,
            activity_type=ActivityType.CREDIT_APP_COMPLETED,
            description=f"Credit application submitted by {performer_name}",
            user_id=current_user.id,
            lead_id=lead.id,
            dealership_id=lead.dealership_id,
            meta_data={"action": "submitted_in_crm"},
        )
        await db.flush()
        return app

    @staticmethod
    async def _sync_to_customer_and_guest(
        db: AsyncSession,
        lead: Lead,
        app: LeadCreditApplication,
    ) -> None:
        cust_r = await db.execute(select(Customer).where(Customer.id == lead.customer_id))
        customer = cust_r.scalar_one_or_none()
        if customer and app.applicant_a:
            residence = (app.applicant_a or {}).get("current_residence") or {}
            if residence.get("street"):
                customer.address = residence["street"]
            if residence.get("city"):
                customer.city = residence["city"]
            if residence.get("state"):
                customer.state = residence["state"]
            if residence.get("zip"):
                customer.postal_code = residence["zip"]
            if residence.get("cell_phone"):
                customer.phone = residence["cell_phone"]
            dob = app.applicant_a.get("date_of_birth")
            if dob:
                try:
                    from datetime import date
                    customer.date_of_birth = date.fromisoformat(dob[:10])
                except ValueError:
                    pass

        guest_r = await db.execute(select(Guest).where(Guest.lead_id == lead.id))
        guest = guest_r.scalar_one_or_none()
        dealer = app.dealer_section or {}
        if guest and dealer:
            vehicle = dealer.get("vehicle") or {}
            trade = dealer.get("trade_in") or {}
            if vehicle.get("model"):
                guest.vehicle_of_interest = vehicle["model"]
            if trade.get("model"):
                guest.trade_in = trade["model"]
            if trade.get("payoff") is not None:
                guest.payoff = trade["payoff"]
            if trade.get("lienholder"):
                guest.payoff_bank = trade["lienholder"]
            if dealer.get("cash_down") is not None:
                guest.down_payment = dealer["cash_down"]
            if vehicle.get("mileage"):
                try:
                    guest.miles = int(str(vehicle["mileage"]).replace(",", ""))
                except ValueError:
                    pass

        if dealer.get("cash_down") is not None:
            lead.down_payment = dealer["cash_down"]

    @staticmethod
    async def to_response(
        db: AsyncSession,
        app: LeadCreditApplication,
    ) -> CreditApplicationResponse:
        updated_by_name = None
        submitted_by_name = None
        if app.updated_by:
            r = await db.execute(select(User).where(User.id == app.updated_by))
            u = r.scalar_one_or_none()
            if u:
                updated_by_name = f"{u.first_name} {u.last_name}".strip()
        if app.submitted_by:
            r = await db.execute(select(User).where(User.id == app.submitted_by))
            u = r.scalar_one_or_none()
            if u:
                submitted_by_name = f"{u.first_name} {u.last_name}".strip()

        a_ssn = mask_ssn(decrypt_value(app.applicant_a_ssn_encrypted or ""))
        b_ssn = mask_ssn(decrypt_value(app.applicant_b_ssn_encrypted or ""))

        return CreditApplicationResponse(
            id=app.id,
            lead_id=app.lead_id,
            dealership_id=app.dealership_id,
            status=app.status,
            transaction_type=app.transaction_type,
            application_type=app.application_type,
            app_number=app.app_number,
            applicant_a=_dict_to_applicant(app.applicant_a, a_ssn),
            applicant_b=_dict_to_applicant(app.applicant_b, b_ssn),
            other_income=OtherIncomeSection.model_validate(app.other_income) if app.other_income else None,
            reference=ReferenceSection.model_validate(app.reference) if app.reference else None,
            bank_reference=BankReferenceSection.model_validate(app.bank_reference) if app.bank_reference else None,
            authorization=AuthorizationSection.model_validate(app.authorization) if app.authorization else None,
            dealer_section=DealerSection.model_validate(app.dealer_section) if app.dealer_section else None,
            created_by=app.created_by,
            updated_by=app.updated_by,
            submitted_by=app.submitted_by,
            submitted_at=app.submitted_at,
            created_at=app.created_at,
            updated_at=app.updated_at,
            updated_by_name=updated_by_name,
            submitted_by_name=submitted_by_name,
        )


credit_application_service = CreditApplicationService()
