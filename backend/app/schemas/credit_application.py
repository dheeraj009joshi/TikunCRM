"""
Pydantic schemas for in-CRM lead credit applications.
All fields optional — nothing blocks save or submit.
"""
from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ResidenceSection(BaseModel):
    street: Optional[str] = None
    apt: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    years: Optional[int] = None
    months: Optional[int] = None
    home_phone: Optional[str] = None
    cell_phone: Optional[str] = None
    monthly_rent_mortgage: Optional[float] = None
    residential_status: Optional[str] = None
    landlord_name: Optional[str] = None
    landlord_phone: Optional[str] = None


class EmploymentSection(BaseModel):
    employer_name: Optional[str] = None
    gross_monthly_salary: Optional[float] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    work_phone: Optional[str] = None
    years: Optional[int] = None
    months: Optional[int] = None
    occupation: Optional[str] = None


class ApplicantSection(BaseModel):
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    ssn: Optional[str] = Field(None, description="Write-only; stored encrypted")
    ssn_masked: Optional[str] = Field(None, description="Read-only masked SSN")
    current_residence: Optional[ResidenceSection] = None
    previous_residence: Optional[ResidenceSection] = None
    current_employment: Optional[EmploymentSection] = None
    previous_employment: Optional[EmploymentSection] = None
    secondary_employment: Optional[EmploymentSection] = None


class OtherIncomeSection(BaseModel):
    gross_monthly_other_income: Optional[float] = None
    source: Optional[str] = None
    belongs_to: Optional[str] = None


class ReferenceSection(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    relationship: Optional[str] = None


class BankReferenceSection(BaseModel):
    bank_name: Optional[str] = None
    account_type: Optional[str] = None


class AuthorizationSection(BaseModel):
    applicant_signature: Optional[str] = None
    applicant_signature_date: Optional[str] = None
    applicant_dl_number: Optional[str] = None
    joint_signature: Optional[str] = None
    joint_signature_date: Optional[str] = None
    joint_dl_number: Optional[str] = None


class VehicleSection(BaseModel):
    condition: Optional[str] = None
    year: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    body_style: Optional[str] = None
    mileage: Optional[str] = None
    vin: Optional[str] = None


class TradeInSection(BaseModel):
    year: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    body_style: Optional[str] = None
    lienholder: Optional[str] = None
    allowance: Optional[float] = None
    payoff: Optional[float] = None


class DealerSection(BaseModel):
    vehicle: Optional[VehicleSection] = None
    trade_in: Optional[TradeInSection] = None
    cash_selling_price: Optional[float] = None
    net_trade: Optional[float] = None
    cash_down: Optional[float] = None
    products_and_fees: Optional[float] = None
    amount_financed: Optional[float] = None
    term_months: Optional[int] = None
    apr: Optional[float] = None


class CreditApplicationUpdate(BaseModel):
    transaction_type: Optional[Literal["credit_sale", "lease"]] = None
    application_type: Optional[Literal["individual", "joint", "business"]] = None
    app_number: Optional[str] = None
    applicant_a: Optional[ApplicantSection] = None
    applicant_b: Optional[ApplicantSection] = None
    other_income: Optional[OtherIncomeSection] = None
    reference: Optional[ReferenceSection] = None
    bank_reference: Optional[BankReferenceSection] = None
    authorization: Optional[AuthorizationSection] = None
    dealer_section: Optional[DealerSection] = None
    revert_to_draft: Optional[bool] = Field(
        False, description="If true and status is submitted, revert to draft for editing"
    )


class CreditApplicationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lead_id: UUID
    dealership_id: Optional[UUID] = None
    status: str
    transaction_type: Optional[str] = None
    application_type: Optional[str] = None
    app_number: Optional[str] = None
    applicant_a: Optional[ApplicantSection] = None
    applicant_b: Optional[ApplicantSection] = None
    other_income: Optional[OtherIncomeSection] = None
    reference: Optional[ReferenceSection] = None
    bank_reference: Optional[BankReferenceSection] = None
    authorization: Optional[AuthorizationSection] = None
    dealer_section: Optional[DealerSection] = None
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    submitted_by: Optional[UUID] = None
    submitted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    updated_by_name: Optional[str] = None
    submitted_by_name: Optional[str] = None
