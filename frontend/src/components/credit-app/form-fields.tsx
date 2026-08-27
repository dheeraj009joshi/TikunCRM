"use client"

import type { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { EmploymentSection, ResidenceSection } from "@/types/credit-application"

export function FieldGrid({
  children,
  cols = 2,
}: {
  children: ReactNode
  cols?: 2 | 3 | 4
}) {
  const cls =
    cols === 4
      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      : cols === 3
        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        : "grid grid-cols-1 sm:grid-cols-2 gap-3"
  return <div className={cls}>{children}</div>
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  disabled,
  placeholder,
}: {
  label: string
  value?: string | null
  onChange: (v: string) => void
  type?: string
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value?: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        disabled={disabled}
      />
    </div>
  )
}

export function ResidenceFields({
  value,
  onChange,
  disabled,
  prefix,
}: {
  value?: ResidenceSection | null
  onChange: (v: ResidenceSection) => void
  disabled?: boolean
  prefix: string
}) {
  const v = value ?? {}
  const set = (key: keyof ResidenceSection, val: string | number | null) => {
    onChange({ ...v, [key]: val })
  }

  return (
    <div className="space-y-3">
      <FieldGrid cols={4}>
        <div className="sm:col-span-2">
          <TextField
            label={`${prefix} street`}
            value={v.street}
            onChange={(x) => set("street", x)}
            disabled={disabled}
          />
        </div>
        <TextField label="Apt #" value={v.apt} onChange={(x) => set("apt", x)} disabled={disabled} />
        <TextField label="City" value={v.city} onChange={(x) => set("city", x)} disabled={disabled} />
        <TextField label="State" value={v.state} onChange={(x) => set("state", x)} disabled={disabled} />
        <TextField label="Zip" value={v.zip} onChange={(x) => set("zip", x)} disabled={disabled} />
        <NumberField label="Years" value={v.years} onChange={(x) => set("years", x)} disabled={disabled} />
        <NumberField label="Months" value={v.months} onChange={(x) => set("months", x)} disabled={disabled} />
        <TextField label="Home phone" value={v.home_phone} onChange={(x) => set("home_phone", x)} disabled={disabled} />
        <TextField label="Cell phone" value={v.cell_phone} onChange={(x) => set("cell_phone", x)} disabled={disabled} />
        <NumberField
          label="Monthly rent/mortgage"
          value={v.monthly_rent_mortgage}
          onChange={(x) => set("monthly_rent_mortgage", x)}
          disabled={disabled}
        />
      </FieldGrid>
      <FieldGrid>
        <div className="space-y-1.5">
          <Label className="text-xs">Residential status</Label>
          <Select
            value={v.residential_status ?? ""}
            onValueChange={(x) => set("residential_status", x || null)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">Own</SelectItem>
              <SelectItem value="rent">Rent</SelectItem>
              <SelectItem value="relatives">With relatives</SelectItem>
              <SelectItem value="friends">With friends</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TextField
          label="Landlord / mortgage co."
          value={v.landlord_name}
          onChange={(x) => set("landlord_name", x)}
          disabled={disabled}
        />
        <TextField
          label="Landlord phone"
          value={v.landlord_phone}
          onChange={(x) => set("landlord_phone", x)}
          disabled={disabled}
        />
      </FieldGrid>
    </div>
  )
}

export function EmploymentFields({
  value,
  onChange,
  disabled,
  prefix,
}: {
  value?: EmploymentSection | null
  onChange: (v: EmploymentSection) => void
  disabled?: boolean
  prefix: string
}) {
  const v = value ?? {}
  const set = (key: keyof EmploymentSection, val: string | number | null) => {
    onChange({ ...v, [key]: val })
  }

  return (
    <FieldGrid cols={3}>
      <div className="sm:col-span-2">
        <TextField
          label={`${prefix} employer`}
          value={v.employer_name}
          onChange={(x) => set("employer_name", x)}
          disabled={disabled}
        />
      </div>
      <NumberField
        label="Gross monthly salary"
        value={v.gross_monthly_salary}
        onChange={(x) => set("gross_monthly_salary", x)}
        disabled={disabled}
      />
      <div className="sm:col-span-2">
        <TextField label="Address" value={v.address} onChange={(x) => set("address", x)} disabled={disabled} />
      </div>
      <TextField label="City" value={v.city} onChange={(x) => set("city", x)} disabled={disabled} />
      <TextField label="State" value={v.state} onChange={(x) => set("state", x)} disabled={disabled} />
      <TextField label="Zip" value={v.zip} onChange={(x) => set("zip", x)} disabled={disabled} />
      <TextField label="Work phone" value={v.work_phone} onChange={(x) => set("work_phone", x)} disabled={disabled} />
      <NumberField label="Years" value={v.years} onChange={(x) => set("years", x)} disabled={disabled} />
      <NumberField label="Months" value={v.months} onChange={(x) => set("months", x)} disabled={disabled} />
      <TextField label="Occupation" value={v.occupation} onChange={(x) => set("occupation", x)} disabled={disabled} />
    </FieldGrid>
  )
}
