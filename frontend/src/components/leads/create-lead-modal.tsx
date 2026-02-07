"use client"

import * as React from "react"
import { Loader2, User, Mail, Phone, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { LeadService, Lead } from "@/services/lead-service"
import { DealershipService } from "@/services/dealership-service"
import { useAuthStore } from "@/stores/auth-store"
import { getCountryAndDial, formatPhoneForDisplay, toE164, DIAL_CODE_OPTIONS } from "@/lib/phone-utils"

interface CreateLeadModalProps {
    isOpen: boolean
    onClose: () => void
    /** Called after lead is created; receives the new lead when available */
    onSuccess?: (lead?: Lead) => void
}

const LEAD_SOURCES = [
    { value: "manual", label: "Manual Entry" },
    { value: "website", label: "Website Form" },
    { value: "referral", label: "Referral" },
    { value: "walk_in", label: "Walk-in" },
    { value: "phone", label: "Phone Inquiry" },
    { value: "social_media", label: "Social Media" },
]

export function CreateLeadModal({ isOpen, onClose, onSuccess }: CreateLeadModalProps) {
    const user = useAuthStore((s) => s.user)
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const [dialCode, setDialCode] = React.useState("+1")
    const [countryCode, setCountryCode] = React.useState("US")

    const [formData, setFormData] = React.useState({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        alternate_phone: "",
        source: "manual",
        interested_in: "",
        budget_range: "",
        notes: "",
    })

    // When modal opens, load dealership country and set default country/dial code
    React.useEffect(() => {
        if (!isOpen || !user?.dealership_id) {
            setDialCode("+1")
            setCountryCode("US")
            return
        }
        DealershipService.getDealership(user.dealership_id)
            .then((d) => {
                const { countryCode: code, dialCode: dial } = getCountryAndDial(d.country ?? undefined)
                setCountryCode(code)
                setDialCode(dial)
            })
            .catch(() => {
                setDialCode("+1")
                setCountryCode("US")
            })
    }, [isOpen, user?.dealership_id])

    const resetForm = () => {
        setFormData({
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            alternate_phone: "",
            source: "manual",
            interested_in: "",
            budget_range: "",
            notes: "",
        })
        setError("")
    }

    const handlePhoneChange = (field: "phone" | "alternate_phone", value: string) => {
        const digits = value.replace(/\D/g, "")
        const formatted = digits ? formatPhoneForDisplay(digits, dialCode) : ""
        setFormData((prev) => ({ ...prev, [field]: formatted }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formData.first_name.trim()) {
            setError("First name is required")
            return
        }

        if (!formData.email?.trim() && !formData.phone?.trim()) {
            setError("Please provide either email or phone number")
            return
        }

        setIsLoading(true)
        setError("")

        const payload = {
            ...formData,
            status: "new",
            email: formData.email?.trim() || undefined,
            phone: formData.phone?.trim() ? toE164(formData.phone, dialCode) : undefined,
            alternate_phone: formData.alternate_phone?.trim() ? toE164(formData.alternate_phone, dialCode) : undefined,
        }

        try {
            const created = await LeadService.createLead(payload)
            resetForm()
            onSuccess?.(created)
            onClose()
        } catch (err: any) {
            console.error("Failed to create lead:", err)
            setError(err?.response?.data?.detail || "Failed to create lead. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        Add New Lead
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Name Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="first_name">First Name *</Label>
                            <Input
                                id="first_name"
                                placeholder="John"
                                value={formData.first_name}
                                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="last_name">Last Name</Label>
                            <Input
                                id="last_name"
                                placeholder="Doe"
                                value={formData.last_name}
                                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Contact Info - Email optional, Phone with country code */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email (optional)</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="email"
                                    type="text"
                                    inputMode="email"
                                    placeholder="john@example.com"
                                    className="pl-9"
                                    value={formData.email}
                                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone (optional)</Label>
                            <div className="flex gap-1">
                                <Select
                                    value={dialCode}
                                    onValueChange={(value) => {
                                        const option = DIAL_CODE_OPTIONS.find((o) => o.dial === value)
                                        if (option) {
                                            setDialCode(option.dial)
                                            setCountryCode(option.code)
                                        }
                                    }}
                                >
                                    <SelectTrigger className="w-[110px] shrink-0">
                                        <SelectValue placeholder="+1" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DIAL_CODE_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.dial} value={opt.dial}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="relative flex-1">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="phone"
                                        type="tel"
                                        inputMode="tel"
                                        placeholder={countryCode === "US" ? "234 567 8900" : "phone number"}
                                        className="pl-9"
                                        value={formData.phone}
                                        onChange={(e) => handlePhoneChange("phone", e.target.value)}
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Country: {countryCode} (default from dealership; you can change above)</p>
                        </div>
                    </div>

                    {/* Source */}
                    <div className="space-y-2">
                        <Label htmlFor="source">Lead Source</Label>
                        <Select 
                            value={formData.source} 
                            onValueChange={(v) => setFormData(prev => ({ ...prev, source: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select source" />
                            </SelectTrigger>
                            <SelectContent>
                                {LEAD_SOURCES.map((source) => (
                                    <SelectItem key={source.value} value={source.value}>
                                        {source.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Interest */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="interested_in">Interested In</Label>
                            <div className="relative">
                                <Target className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="interested_in"
                                    placeholder="e.g., SUV, Sedan"
                                    className="pl-9"
                                    value={formData.interested_in}
                                    onChange={(e) => setFormData(prev => ({ ...prev, interested_in: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="budget_range">Budget Range</Label>
                            <Input
                                id="budget_range"
                                placeholder="e.g., $20k - $30k"
                                value={formData.budget_range}
                                onChange={(e) => setFormData(prev => ({ ...prev, budget_range: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                            id="notes"
                            placeholder="Additional information about this lead..."
                            rows={3}
                            value={formData.notes}
                            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={handleClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Create Lead
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
