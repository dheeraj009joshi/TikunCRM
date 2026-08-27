"use client"

import * as React from "react"
import { Loader2, Save, Send, Edit, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  EmploymentFields,
  FieldGrid,
  NumberField,
  ResidenceFields,
  TextField,
} from "@/components/credit-app/form-fields"
import { CreditAppStipsSection } from "@/components/credit-app/credit-app-stips-section"
import { CreditApplicationService } from "@/services/credit-application-service"
import type {
  ApplicantSection,
  CreditApplication,
  CreditApplicationUpdatePayload,
} from "@/types/credit-application"

interface LeadCreditAppFormProps {
  leadId: string
  dealershipId?: string | null
  primaryCustomerName?: string
  secondaryCustomerName?: string | null
  hasSecondaryCustomer?: boolean
}

function toPayload(
  app: CreditApplicationUpdatePayload,
  ssnA: string,
  ssnB: string
): CreditApplicationUpdatePayload {
  const applicant_a: ApplicantSection = { ...(app.applicant_a ?? {}) }
  const applicant_b: ApplicantSection = { ...(app.applicant_b ?? {}) }
  if (ssnA.trim()) applicant_a.ssn = ssnA.trim()
  if (ssnB.trim()) applicant_b.ssn = ssnB.trim()
  return { ...app, applicant_a, applicant_b }
}

function appToFormState(data: CreditApplication): CreditApplicationUpdatePayload {
  return {
    transaction_type: data.transaction_type ?? null,
    application_type: data.application_type ?? "individual",
    app_number: data.app_number ?? null,
    applicant_a: data.applicant_a ?? {},
    applicant_b: data.applicant_b ?? {},
    other_income: data.other_income ?? {},
    reference: data.reference ?? {},
    bank_reference: data.bank_reference ?? {},
    authorization: data.authorization ?? {},
    dealer_section: data.dealer_section ?? { vehicle: {}, trade_in: {} },
  }
}

export function LeadCreditAppForm({
  leadId,
  dealershipId,
  primaryCustomerName,
  secondaryCustomerName,
  hasSecondaryCustomer,
}: LeadCreditAppFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [status, setStatus] = React.useState<"draft" | "submitted">("draft")
  const [meta, setMeta] = React.useState<{ updated_by_name?: string; submitted_by_name?: string; submitted_at?: string }>({})
  const [form, setForm] = React.useState<CreditApplicationUpdatePayload>({
    application_type: "individual",
    applicant_a: {},
    applicant_b: {},
    other_income: {},
    reference: {},
    bank_reference: {},
    authorization: {},
    dealer_section: { vehicle: {}, trade_in: {} },
  })
  const [ssnA, setSsnA] = React.useState("")
  const [ssnB, setSsnB] = React.useState("")
  const [showRevertDialog, setShowRevertDialog] = React.useState(false)

  const isSubmitted = status === "submitted"
  const disabled = isSubmitted

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await CreditApplicationService.get(leadId)
      setForm(appToFormState(data))
      setStatus(data.status)
      setMeta({
        updated_by_name: data.updated_by_name ?? undefined,
        submitted_by_name: data.submitted_by_name ?? undefined,
        submitted_at: data.submitted_at ?? undefined,
      })
      setSsnA("")
      setSsnB("")
    } catch (e) {
      console.error(e)
      toast({ title: "Failed to load credit application", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [leadId])

  React.useEffect(() => {
    load()
  }, [load])

  const update = (patch: Partial<CreditApplicationUpdatePayload>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const handleSave = async (revertToDraft = false) => {
    setSaving(true)
    try {
      const payload = toPayload(form, ssnA, ssnB)
      if (revertToDraft) payload.revert_to_draft = true
      const data = await CreditApplicationService.saveDraft(leadId, payload)
      setForm(appToFormState(data))
      setStatus(data.status)
      setMeta({
        updated_by_name: data.updated_by_name ?? undefined,
        submitted_by_name: data.submitted_by_name ?? undefined,
        submitted_at: data.submitted_at ?? undefined,
      })
      setSsnA("")
      setSsnB("")
      toast({
        title: revertToDraft ? "Application reopened for editing" : "Draft saved",
      })
      setShowRevertDialog(false)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({
        title: msg || "Failed to save",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await CreditApplicationService.saveDraft(leadId, toPayload(form, ssnA, ssnB))
      const data = await CreditApplicationService.submit(leadId)
      setForm(appToFormState(data))
      setStatus(data.status)
      setMeta({
        updated_by_name: data.updated_by_name ?? undefined,
        submitted_by_name: data.submitted_by_name ?? undefined,
        submitted_at: data.submitted_at ?? undefined,
      })
      setSsnA("")
      setSsnB("")
      toast({ title: "Credit application submitted" })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({
        title: msg || "Failed to submit",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const applicantA = form.applicant_a ?? {}
  const applicantB = form.applicant_b ?? {}
  const dealer = form.dealer_section ?? { vehicle: {}, trade_in: {} }
  const vehicle = dealer.vehicle ?? {}
  const tradeIn = dealer.trade_in ?? {}

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Retail Motor Vehicle Credit Application</h3>
          <Badge variant={isSubmitted ? "default" : "secondary"}>
            {isSubmitted ? "Submitted" : "Draft"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSubmitted ? (
            <Button variant="outline" size="sm" onClick={() => setShowRevertDialog(true)}>
              <Edit className="h-4 w-4 mr-1" />
              Edit application
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => handleSave()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save draft
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={submitting || saving}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                Submit application
              </Button>
            </>
          )}
        </div>
      </div>

      {meta.updated_by_name && (
        <p className="text-xs text-muted-foreground">
          Last updated by {meta.updated_by_name}
          {meta.submitted_at && isSubmitted && meta.submitted_by_name
            ? ` · Submitted by ${meta.submitted_by_name}`
            : ""}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        All fields are optional. Save a draft anytime or submit when ready.
      </p>

      <Accordion type="multiple" defaultValue={["header", "applicant-a", "dealer", "stips"]} className="w-full">
        <AccordionItem value="header">
          <AccordionTrigger>Application header</AccordionTrigger>
          <AccordionContent>
            <FieldGrid cols={3}>
              <div className="space-y-1.5">
                <Label className="text-xs">Transaction type</Label>
                <Select
                  value={form.transaction_type ?? ""}
                  onValueChange={(v) =>
                    update({ transaction_type: v === "credit_sale" || v === "lease" ? v : null })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit_sale">Credit sale</SelectItem>
                    <SelectItem value="lease">Lease</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type of credit</Label>
                <Select
                  value={form.application_type ?? "individual"}
                  onValueChange={(v) =>
                    update({
                      application_type:
                        v === "individual" || v === "joint" || v === "business" ? v : "individual",
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="joint">Joint</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TextField
                label="App #"
                value={form.app_number}
                onChange={(v) => update({ app_number: v || null })}
                disabled={disabled}
              />
            </FieldGrid>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="applicant-a">
          <AccordionTrigger>Applicant A</AccordionTrigger>
          <AccordionContent className="space-y-6">
            <FieldGrid cols={3}>
              <TextField
                label="Full name"
                value={applicantA.full_name}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, full_name: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Date of birth"
                type="date"
                value={applicantA.date_of_birth ?? ""}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, date_of_birth: v || null } })
                }
                disabled={disabled}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">SSN / Tax ID</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={
                    applicantA.ssn_masked ? `On file: ${applicantA.ssn_masked}` : "Enter to update"
                  }
                  value={ssnA}
                  onChange={(e) => setSsnA(e.target.value)}
                  disabled={disabled}
                />
              </div>
            </FieldGrid>
            <div>
              <p className="text-sm font-medium mb-2">Current residence</p>
              <ResidenceFields
                prefix="Current"
                value={applicantA.current_residence}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, current_residence: v } })
                }
                disabled={disabled}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Previous residence</p>
              <ResidenceFields
                prefix="Previous"
                value={applicantA.previous_residence}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, previous_residence: v } })
                }
                disabled={disabled}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Current employment</p>
              <EmploymentFields
                prefix="Current"
                value={applicantA.current_employment}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, current_employment: v } })
                }
                disabled={disabled}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Previous employment</p>
              <EmploymentFields
                prefix="Previous"
                value={applicantA.previous_employment}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, previous_employment: v } })
                }
                disabled={disabled}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Secondary employment</p>
              <EmploymentFields
                prefix="Secondary"
                value={applicantA.secondary_employment}
                onChange={(v) =>
                  update({ applicant_a: { ...applicantA, secondary_employment: v } })
                }
                disabled={disabled}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {(form.application_type === "joint" || form.application_type === "business") && (
          <AccordionItem value="applicant-b">
            <AccordionTrigger>Applicant B</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <FieldGrid cols={3}>
                <TextField
                  label="Full name"
                  value={applicantB.full_name}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, full_name: v } })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Date of birth"
                  type="date"
                  value={applicantB.date_of_birth ?? ""}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, date_of_birth: v || null } })
                  }
                  disabled={disabled}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">SSN / Tax ID</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      applicantB.ssn_masked ? `On file: ${applicantB.ssn_masked}` : "Enter to update"
                    }
                    value={ssnB}
                    onChange={(e) => setSsnB(e.target.value)}
                    disabled={disabled}
                  />
                </div>
              </FieldGrid>
              <div>
                <p className="text-sm font-medium mb-2">Current residence</p>
                <ResidenceFields
                  prefix="Current"
                  value={applicantB.current_residence}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, current_residence: v } })
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Previous residence</p>
                <ResidenceFields
                  prefix="Previous"
                  value={applicantB.previous_residence}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, previous_residence: v } })
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Current employment</p>
                <EmploymentFields
                  prefix="Current"
                  value={applicantB.current_employment}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, current_employment: v } })
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Previous employment</p>
                <EmploymentFields
                  prefix="Previous"
                  value={applicantB.previous_employment}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, previous_employment: v } })
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Secondary employment</p>
                <EmploymentFields
                  prefix="Secondary"
                  value={applicantB.secondary_employment}
                  onChange={(v) =>
                    update({ applicant_b: { ...applicantB, secondary_employment: v } })
                  }
                  disabled={disabled}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        <AccordionItem value="other">
          <AccordionTrigger>Other income, reference & bank</AccordionTrigger>
          <AccordionContent className="space-y-6">
            <FieldGrid cols={3}>
              <NumberField
                label="Gross monthly other income"
                value={form.other_income?.gross_monthly_other_income}
                onChange={(v) =>
                  update({ other_income: { ...(form.other_income ?? {}), gross_monthly_other_income: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Source"
                value={form.other_income?.source}
                onChange={(v) =>
                  update({ other_income: { ...(form.other_income ?? {}), source: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Belongs to (A or B)"
                value={form.other_income?.belongs_to}
                onChange={(v) =>
                  update({ other_income: { ...(form.other_income ?? {}), belongs_to: v } })
                }
                disabled={disabled}
              />
            </FieldGrid>
            <FieldGrid cols={2}>
              <TextField
                label="Reference name"
                value={form.reference?.name}
                onChange={(v) =>
                  update({ reference: { ...(form.reference ?? {}), name: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Reference phone"
                value={form.reference?.phone}
                onChange={(v) =>
                  update({ reference: { ...(form.reference ?? {}), phone: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Reference address"
                value={form.reference?.address}
                onChange={(v) =>
                  update({ reference: { ...(form.reference ?? {}), address: v } })
                }
                disabled={disabled}
              />
              <TextField
                label="Relationship"
                value={form.reference?.relationship}
                onChange={(v) =>
                  update({ reference: { ...(form.reference ?? {}), relationship: v } })
                }
                disabled={disabled}
              />
            </FieldGrid>
            <FieldGrid cols={2}>
              <TextField
                label="Bank name"
                value={form.bank_reference?.bank_name}
                onChange={(v) =>
                  update({ bank_reference: { ...(form.bank_reference ?? {}), bank_name: v } })
                }
                disabled={disabled}
              />
              <div className="space-y-1.5">
                <Label className="text-xs">Account type</Label>
                <Select
                  value={form.bank_reference?.account_type ?? ""}
                  onValueChange={(v) =>
                    update({
                      bank_reference: { ...(form.bank_reference ?? {}), account_type: v || null },
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Checking</SelectItem>
                    <SelectItem value="savings">Savings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FieldGrid>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="authorization">
          <AccordionTrigger>Authorization & signatures</AccordionTrigger>
          <AccordionContent>
            <FieldGrid cols={3}>
              <TextField
                label="Applicant signature (name)"
                value={form.authorization?.applicant_signature}
                onChange={(v) =>
                  update({
                    authorization: { ...(form.authorization ?? {}), applicant_signature: v },
                  })
                }
                disabled={disabled}
              />
              <TextField
                label="Applicant signature date"
                type="date"
                value={form.authorization?.applicant_signature_date ?? ""}
                onChange={(v) =>
                  update({
                    authorization: {
                      ...(form.authorization ?? {}),
                      applicant_signature_date: v || null,
                    },
                  })
                }
                disabled={disabled}
              />
              <TextField
                label="Applicant DL #"
                value={form.authorization?.applicant_dl_number}
                onChange={(v) =>
                  update({
                    authorization: { ...(form.authorization ?? {}), applicant_dl_number: v },
                  })
                }
                disabled={disabled}
              />
              <TextField
                label="Joint signature (name)"
                value={form.authorization?.joint_signature}
                onChange={(v) =>
                  update({
                    authorization: { ...(form.authorization ?? {}), joint_signature: v },
                  })
                }
                disabled={disabled}
              />
              <TextField
                label="Joint signature date"
                type="date"
                value={form.authorization?.joint_signature_date ?? ""}
                onChange={(v) =>
                  update({
                    authorization: {
                      ...(form.authorization ?? {}),
                      joint_signature_date: v || null,
                    },
                  })
                }
                disabled={disabled}
              />
              <TextField
                label="Joint DL #"
                value={form.authorization?.joint_dl_number}
                onChange={(v) =>
                  update({
                    authorization: { ...(form.authorization ?? {}), joint_dl_number: v },
                  })
                }
                disabled={disabled}
              />
            </FieldGrid>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="dealer">
          <AccordionTrigger>Dealer use only</AccordionTrigger>
          <AccordionContent className="space-y-6">
            <div>
              <p className="text-sm font-medium mb-2">Vehicle</p>
              <FieldGrid cols={4}>
                <div className="space-y-1.5">
                  <Label className="text-xs">Condition</Label>
                  <Select
                    value={vehicle.condition ?? ""}
                    onValueChange={(v) =>
                      update({
                        dealer_section: {
                          ...dealer,
                          vehicle: { ...vehicle, condition: v || null },
                        },
                      })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="used">Used</SelectItem>
                      <SelectItem value="demo">Demo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <TextField
                  label="Year"
                  value={vehicle.year}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        vehicle: { ...vehicle, year: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Make"
                  value={vehicle.make}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        vehicle: { ...vehicle, make: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Model"
                  value={vehicle.model}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        vehicle: { ...vehicle, model: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Body style"
                  value={vehicle.body_style}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        vehicle: { ...vehicle, body_style: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Mileage"
                  value={vehicle.mileage}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        vehicle: { ...vehicle, mileage: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <div className="sm:col-span-2">
                  <TextField
                    label="VIN / Serial #"
                    value={vehicle.vin}
                    onChange={(v) =>
                      update({
                        dealer_section: {
                          ...dealer,
                          vehicle: { ...vehicle, vin: v },
                        },
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </FieldGrid>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Trade-in</p>
              <FieldGrid cols={4}>
                <TextField
                  label="Year"
                  value={tradeIn.year}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, year: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Make"
                  value={tradeIn.make}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, make: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Model"
                  value={tradeIn.model}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, model: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Body style"
                  value={tradeIn.body_style}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, body_style: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <TextField
                  label="Lienholder"
                  value={tradeIn.lienholder}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, lienholder: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <NumberField
                  label="Allowance"
                  value={tradeIn.allowance}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, allowance: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
                <NumberField
                  label="Payoff"
                  value={tradeIn.payoff}
                  onChange={(v) =>
                    update({
                      dealer_section: {
                        ...dealer,
                        trade_in: { ...tradeIn, payoff: v },
                      },
                    })
                  }
                  disabled={disabled}
                />
              </FieldGrid>
            </div>
            <FieldGrid cols={4}>
              <NumberField
                label="Cash selling price"
                value={dealer.cash_selling_price}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, cash_selling_price: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="Net trade"
                value={dealer.net_trade}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, net_trade: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="Cash down"
                value={dealer.cash_down}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, cash_down: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="Products & fees"
                value={dealer.products_and_fees}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, products_and_fees: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="Amount financed"
                value={dealer.amount_financed}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, amount_financed: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="Term (months)"
                value={dealer.term_months}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, term_months: v } })
                }
                disabled={disabled}
              />
              <NumberField
                label="APR %"
                value={dealer.apr}
                onChange={(v) =>
                  update({ dealer_section: { ...dealer, apr: v } })
                }
                disabled={disabled}
              />
            </FieldGrid>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="stips">
          <AccordionTrigger>Stips documents</AccordionTrigger>
          <AccordionContent>
            <CreditAppStipsSection
              leadId={leadId}
              dealershipId={dealershipId}
              primaryCustomerName={primaryCustomerName}
              secondaryCustomerName={secondaryCustomerName}
              hasSecondaryCustomer={hasSecondaryCustomer}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit submitted application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reopen the application as a draft so you can make changes and submit again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleSave(true)} disabled={saving}>
              Reopen for editing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
