export type CreditApplicationStatus = "draft" | "submitted"
export type TransactionType = "credit_sale" | "lease"
export type ApplicationType = "individual" | "joint" | "business"

export interface ResidenceSection {
  street?: string | null
  apt?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  years?: number | null
  months?: number | null
  home_phone?: string | null
  cell_phone?: string | null
  monthly_rent_mortgage?: number | null
  residential_status?: string | null
  landlord_name?: string | null
  landlord_phone?: string | null
}

export interface EmploymentSection {
  employer_name?: string | null
  gross_monthly_salary?: number | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  work_phone?: string | null
  years?: number | null
  months?: number | null
  occupation?: string | null
}

export interface ApplicantSection {
  full_name?: string | null
  date_of_birth?: string | null
  ssn?: string | null
  ssn_masked?: string | null
  current_residence?: ResidenceSection | null
  previous_residence?: ResidenceSection | null
  current_employment?: EmploymentSection | null
  previous_employment?: EmploymentSection | null
  secondary_employment?: EmploymentSection | null
}

export interface OtherIncomeSection {
  gross_monthly_other_income?: number | null
  source?: string | null
  belongs_to?: string | null
}

export interface ReferenceSection {
  name?: string | null
  phone?: string | null
  address?: string | null
  relationship?: string | null
}

export interface BankReferenceSection {
  bank_name?: string | null
  account_type?: string | null
}

export interface AuthorizationSection {
  applicant_signature?: string | null
  applicant_signature_date?: string | null
  applicant_dl_number?: string | null
  joint_signature?: string | null
  joint_signature_date?: string | null
  joint_dl_number?: string | null
}

export interface VehicleSection {
  condition?: string | null
  year?: string | null
  make?: string | null
  model?: string | null
  body_style?: string | null
  mileage?: string | null
  vin?: string | null
}

export interface TradeInSection {
  year?: string | null
  make?: string | null
  model?: string | null
  body_style?: string | null
  lienholder?: string | null
  allowance?: number | null
  payoff?: number | null
}

export interface DealerSection {
  vehicle?: VehicleSection | null
  trade_in?: TradeInSection | null
  cash_selling_price?: number | null
  net_trade?: number | null
  cash_down?: number | null
  products_and_fees?: number | null
  amount_financed?: number | null
  term_months?: number | null
  apr?: number | null
}

export interface CreditApplication {
  id: string
  lead_id: string
  dealership_id?: string | null
  status: CreditApplicationStatus
  transaction_type?: TransactionType | null
  application_type?: ApplicationType | null
  app_number?: string | null
  applicant_a?: ApplicantSection | null
  applicant_b?: ApplicantSection | null
  other_income?: OtherIncomeSection | null
  reference?: ReferenceSection | null
  bank_reference?: BankReferenceSection | null
  authorization?: AuthorizationSection | null
  dealer_section?: DealerSection | null
  created_by?: string | null
  updated_by?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
  created_at: string
  updated_at: string
  updated_by_name?: string | null
  submitted_by_name?: string | null
}

export interface CreditApplicationUpdatePayload {
  transaction_type?: TransactionType | null
  application_type?: ApplicationType | null
  app_number?: string | null
  applicant_a?: ApplicantSection | null
  applicant_b?: ApplicantSection | null
  other_income?: OtherIncomeSection | null
  reference?: ReferenceSection | null
  bank_reference?: BankReferenceSection | null
  authorization?: AuthorizationSection | null
  dealer_section?: DealerSection | null
  revert_to_draft?: boolean
}

export function emptyCreditApplication(): CreditApplicationUpdatePayload {
  return {
    transaction_type: null,
    application_type: "individual",
    app_number: null,
    applicant_a: {},
    applicant_b: {},
    other_income: {},
    reference: {},
    bank_reference: {},
    authorization: {},
    dealer_section: { vehicle: {}, trade_in: {} },
  }
}
