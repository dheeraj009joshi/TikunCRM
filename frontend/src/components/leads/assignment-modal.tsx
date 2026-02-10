"use client"

import * as React from "react"
import { Building2, Loader2, Users, ArrowUpDown, UserPlus, Search, XCircle, Phone, Mail } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { DealershipService, Dealership } from "@/services/dealership-service"
import { TeamService, UserBrief } from "@/services/team-service"
import { CustomerService, CustomerBrief, getCustomerFullName } from "@/services/customer-service"
import { LeadService, Lead, getLeadFullName } from "@/services/lead-service"
import { useRole } from "@/hooks/use-role"
import { useDebounce } from "@/hooks/use-debounce"
import { getCountryAndDial, formatPhoneForDisplay, toE164, DIAL_CODE_OPTIONS } from "@/lib/phone-utils"
import { cn } from "@/lib/utils"

interface AssignToDealershipModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedLeads: Lead[]
    onSuccess: () => void
}

export function AssignToDealershipModal({
    open,
    onOpenChange,
    selectedLeads,
    onSuccess
}: AssignToDealershipModalProps) {
    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [selectedDealership, setSelectedDealership] = React.useState<string>("")
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    React.useEffect(() => {
        if (open) {
            setIsLoading(true)
            DealershipService.listDealerships({ is_active: true })
                .then(setDealerships)
                .catch(console.error)
                .finally(() => setIsLoading(false))
        }
    }, [open])

    const handleAssign = async () => {
        if (!selectedDealership || selectedLeads.length === 0) return

        setIsSubmitting(true)
        try {
            if (selectedLeads.length === 1) {
                await LeadService.assignToDealership(selectedLeads[0].id, selectedDealership)
            } else {
                await LeadService.bulkAssignToDealership(
                    selectedLeads.map(l => l.id),
                    selectedDealership
                )
            }
            onSuccess()
            onOpenChange(false)
            setSelectedDealership("")
        } catch (error) {
            console.error("Failed to assign leads:", error)
        } finally {
            setIsSubmitting(false)
        }
    }

    const selectedDealershipName = dealerships.find(d => d.id === selectedDealership)?.name

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-primary" />
                        Assign to Dealership
                    </DialogTitle>
                    <DialogDescription>
                        {selectedLeads.length === 1 
                            ? `Assign "${selectedLeads[0].customer?.first_name || ""} ${selectedLeads[0].customer?.last_name || ""}" to a dealership.`
                            : `Assign ${selectedLeads.length} selected leads to a dealership.`
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <label className="text-sm font-medium mb-2 block">
                        Select Dealership
                    </label>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-10">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Select value={selectedDealership} onValueChange={setSelectedDealership}>
                            <SelectTrigger>
                                <SelectValue placeholder="Choose a dealership..." />
                            </SelectTrigger>
                            <SelectContent>
                                {dealerships.map((dealership) => (
                                    <SelectItem key={dealership.id} value={dealership.id}>
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary text-xs font-bold">
                                                {dealership.name.charAt(0)}
                                            </div>
                                            {dealership.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <DialogFooter>
                    <Button 
                        variant="outline" 
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleAssign}
                        disabled={!selectedDealership || isSubmitting}
                        loading={isSubmitting}
                        loadingText="Assigning..."
                    >
                        Assign {selectedLeads.length > 1 ? `${selectedLeads.length} Leads` : "Lead"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


interface AssignToSalespersonModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    lead: Lead | null
    onSuccess: () => void
}

export function AssignToSalespersonModal({
    open,
    onOpenChange,
    lead,
    onSuccess
}: AssignToSalespersonModalProps) {
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const isAdmin = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    
    const [teamMembers, setTeamMembers] = React.useState<UserBrief[]>([])
    const [selectedSalesperson, setSelectedSalesperson] = React.useState<string>("")
    const [selectedSecondary, setSelectedSecondary] = React.useState<string>("none")
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [isSwapping, setIsSwapping] = React.useState(false)

    const isReassigning = lead?.assigned_to !== undefined && lead?.assigned_to !== null
    const hasBothAssigned = lead?.assigned_to && lead?.secondary_salesperson_id

    React.useEffect(() => {
        if (open && lead?.dealership_id) {
            setIsLoading(true)
            TeamService.getSalespersons(lead.dealership_id)
                .then((members) => {
                    setTeamMembers(members)
                    // Pre-select currently assigned users
                    if (lead.assigned_to) {
                        setSelectedSalesperson(lead.assigned_to)
                    } else {
                        setSelectedSalesperson("")
                    }
                    if (lead.secondary_salesperson_id) {
                        setSelectedSecondary(lead.secondary_salesperson_id)
                    } else {
                        setSelectedSecondary("none")
                    }
                })
                .catch(console.error)
                .finally(() => setIsLoading(false))
        } else if (open) {
            setSelectedSalesperson("")
            setSelectedSecondary("none")
        }
    }, [open, lead?.dealership_id, lead?.assigned_to, lead?.secondary_salesperson_id])

    const handleAssign = async () => {
        if (!selectedSalesperson || !lead) return

        setIsSubmitting(true)
        try {
            // Assign primary
            await LeadService.assignToSalesperson(lead.id, selectedSalesperson)
            
            // If admin and secondary is different from current, update it
            if (isAdmin) {
                const newSecondary = selectedSecondary === "none" ? null : selectedSecondary
                const currentSecondary = lead.secondary_salesperson_id || null
                if (newSecondary !== currentSecondary && newSecondary !== selectedSalesperson) {
                    await LeadService.assignSecondarySalesperson(lead.id, newSecondary)
                }
            }
            
            onSuccess()
            onOpenChange(false)
            setSelectedSalesperson("")
            setSelectedSecondary("none")
        } catch (error) {
            console.error("Failed to assign lead:", error)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSwap = async () => {
        if (!lead || !hasBothAssigned) return
        
        setIsSwapping(true)
        try {
            await LeadService.swapSalespersons(lead.id)
            onSuccess()
            onOpenChange(false)
        } catch (error) {
            console.error("Failed to swap salespersons:", error)
        } finally {
            setIsSwapping(false)
        }
    }

    if (!lead) return null

    const getRoleDisplayName = (role: string) => {
        switch (role) {
            case 'dealership_owner':
                return 'Owner'
            case 'dealership_admin':
                return 'Admin'
            case 'salesperson':
                return 'Sales'
            default:
                return role
        }
    }

    // Filter out selected primary from secondary options
    const secondaryOptions = teamMembers.filter(m => m.id !== selectedSalesperson)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        {isReassigning ? 'Reassign Lead' : 'Assign to Team Member'}
                    </DialogTitle>
                    <DialogDescription>
                        {isReassigning 
                            ? `Reassign "${getLeadFullName(lead)}" to a different team member.`
                            : `Assign "${getLeadFullName(lead)}" to a team member.`
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Salesperson</Label>
                        {isLoading ? (
                            <div className="flex items-center justify-center h-10">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : teamMembers.length === 0 ? (
                            <div className="text-center py-4 text-sm text-muted-foreground">
                                No team members available in this dealership.
                            </div>
                        ) : (
                            <Select value={selectedSalesperson} onValueChange={setSelectedSalesperson}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose primary salesperson..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {teamMembers.map((person) => (
                                        <SelectItem key={person.id} value={person.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-purple-500 text-white text-xs font-bold">
                                                    {person.first_name.charAt(0)}{person.last_name.charAt(0)}
                                                </div>
                                                <span>{person.first_name} {person.last_name}</span>
                                                <Badge variant={getRoleVariant(person.role)} size="sm">
                                                    {getRoleDisplayName(person.role)}
                                                </Badge>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Secondary salesperson - Admin only */}
                    {isAdmin && teamMembers.length > 1 && (
                        <div className="space-y-2">
                            <Label>Secondary Salesperson (Optional)</Label>
                            <Select value={selectedSecondary} onValueChange={setSelectedSecondary}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No secondary salesperson" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">
                                        <span className="text-muted-foreground">No secondary salesperson</span>
                                    </SelectItem>
                                    {secondaryOptions.map((person) => (
                                        <SelectItem key={person.id} value={person.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 text-white text-xs font-bold">
                                                    {person.first_name.charAt(0)}{person.last_name.charAt(0)}
                                                </div>
                                                <span>{person.first_name} {person.last_name}</span>
                                                <Badge variant={getRoleVariant(person.role)} size="sm">
                                                    {getRoleDisplayName(person.role)}
                                                </Badge>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Secondary salesperson shares the deal (0.5 credit each in reports).
                            </p>
                        </div>
                    )}

                    {/* Swap button - only show if both are assigned */}
                    {isAdmin && hasBothAssigned && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSwap}
                            disabled={isSwapping}
                            className="w-full"
                        >
                            {isSwapping ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <ArrowUpDown className="h-4 w-4 mr-2" />
                            )}
                            Swap Primary & Secondary
                        </Button>
                    )}
                </div>

                <DialogFooter>
                    <Button 
                        variant="outline" 
                        onClick={() => {
                            onOpenChange(false)
                            setSelectedSalesperson("")
                            setSelectedSecondary("none")
                        }}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleAssign}
                        disabled={!selectedSalesperson || isSubmitting || (isReassigning && selectedSalesperson === lead.assigned_to && selectedSecondary === (lead.secondary_salesperson_id || "none"))}
                        loading={isSubmitting}
                        loadingText={isReassigning ? "Reassigning..." : "Assigning..."}
                    >
                        {isReassigning ? 'Reassign Lead' : 'Assign Lead'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface AssignSecondaryCustomerModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    lead: Lead | null
    onSuccess: () => void
}

export function AssignSecondaryCustomerModal({
    open,
    onOpenChange,
    lead,
    onSuccess,
}: AssignSecondaryCustomerModalProps) {
    const [query, setQuery] = React.useState("")
    const [results, setResults] = React.useState<CustomerBrief[]>([])
    const [isSearching, setIsSearching] = React.useState(false)
    const [selectedCustomerId, setSelectedCustomerId] = React.useState<string>("none")
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [showAddForm, setShowAddForm] = React.useState(false)
    const [creatingCustomer, setCreatingCustomer] = React.useState(false)
    const [addForm, setAddForm] = React.useState({ first_name: "", last_name: "", phone: "", email: "" })
    const [secDialCode, setSecDialCode] = React.useState("+1")
    const [secCountryCode, setSecCountryCode] = React.useState("US")
    const inputRef = React.useRef<HTMLInputElement>(null)

    const debouncedQuery = useDebounce(query, 300)

    React.useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100)
            if (lead?.secondary_customer_id) setSelectedCustomerId(lead.secondary_customer_id)
            else setSelectedCustomerId("none")
            setQuery("")
            setResults([])
            setSelectedIndex(0)
            setShowAddForm(false)
            setAddForm({ first_name: "", last_name: "", phone: "", email: "" })
            setSecDialCode("+1")
            setSecCountryCode("US")
        }
    }, [open, lead?.secondary_customer_id])

    // Default phone country from lead's dealership (same as create-lead)
    React.useEffect(() => {
        if (!open || !lead?.dealership_id) return
        DealershipService.getDealership(lead.dealership_id)
            .then((d) => {
                const { countryCode, dialCode } = getCountryAndDial(d.country ?? undefined)
                setSecCountryCode(countryCode)
                setSecDialCode(dialCode)
            })
            .catch(() => {})
    }, [open, lead?.dealership_id])

    React.useEffect(() => {
        if (!open) return
        async function search() {
            if (!debouncedQuery.trim()) {
                setResults([])
                return
            }
            setIsSearching(true)
            try {
                const res = await CustomerService.list({
                    search: debouncedQuery,
                    page: 1,
                    page_size: 15,
                })
                const list = (res.items || []).filter((c) => c.id !== lead?.customer_id)
                setResults(list)
                setSelectedIndex(0)
            } catch (e) {
                console.error("Customer search failed:", e)
                setResults([])
            } finally {
                setIsSearching(false)
            }
        }
        search()
    }, [open, debouncedQuery, lead?.customer_id])

    const primaryCustomerId = lead?.customer_id
    const listItems: { id: string; customer?: CustomerBrief }[] = [
        { id: "none" },
        ...results.map((c) => ({ id: c.id, customer: c })),
    ]
    const effectiveIndex = Math.min(selectedIndex, Math.max(0, listItems.length - 1))

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setSelectedIndex((i) => Math.min(i + 1, listItems.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setSelectedIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === "Enter" && listItems.length > 0) {
            e.preventDefault()
            const item = listItems[effectiveIndex]
            if (item) setSelectedCustomerId(item.id)
        } else if (e.key === "Escape") {
            onOpenChange(false)
        }
    }

    const handleAssign = async () => {
        if (!lead) return
        setIsSubmitting(true)
        try {
            await LeadService.updateLead(lead.id, {
                secondary_customer_id: selectedCustomerId !== "none" ? selectedCustomerId : null,
            })
            onSuccess()
            onOpenChange(false)
        } catch (err) {
            console.error("Failed to set secondary customer:", err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleClear = async () => {
        if (!lead) return
        setIsSubmitting(true)
        try {
            await LeadService.updateLead(lead.id, { secondary_customer_id: null })
            onSuccess()
            onOpenChange(false)
        } catch (err) {
            console.error("Failed to clear secondary customer:", err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const openAddForm = () => {
        const q = query.trim()
        if (!q) {
            setAddForm({ first_name: "", last_name: "", phone: "", email: "" })
        } else {
            const looksLikeEmail = q.includes("@")
            const digitsOnlyStr = q.replace(/\D/g, "")
            const looksLikePhone = digitsOnlyStr.length >= 6
            if (looksLikeEmail) {
                setAddForm({ first_name: "", last_name: "", phone: "", email: q })
            } else if (looksLikePhone) {
                const formatted = formatPhoneForDisplay(digitsOnlyStr, secDialCode)
                setAddForm({ first_name: "", last_name: "", phone: formatted, email: "" })
            } else {
                const parts = q.split(/\s+/).filter(Boolean)
                const first_name = parts[0] ?? ""
                const last_name = parts.slice(1).join(" ") ?? ""
                setAddForm({ first_name, last_name, phone: "", email: "" })
            }
        }
        setShowAddForm(true)
    }

    const handleSecPhoneChange = (value: string) => {
        const digits = value.replace(/\D/g, "")
        const formatted = digits ? formatPhoneForDisplay(digits, secDialCode) : ""
        setAddForm((f) => ({ ...f, phone: formatted }))
    }

    const handleCreateAndAssign = async () => {
        if (!lead) return
        const { first_name, last_name, phone, email } = addForm
        if (!first_name.trim()) return
        setCreatingCustomer(true)
        try {
            const newCustomer = await CustomerService.create({
                first_name: first_name.trim(),
                last_name: last_name.trim() || undefined,
                phone: phone.trim() ? toE164(phone, secDialCode) : undefined,
                email: email.trim() || undefined,
            })
            await LeadService.updateLead(lead.id, {
                secondary_customer_id: newCustomer.id,
            })
            onSuccess()
            onOpenChange(false)
        } catch (err) {
            console.error("Failed to create customer or assign:", err)
        } finally {
            setCreatingCustomer(false)
        }
    }

    if (!lead) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-2">
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-primary" />
                        {lead.secondary_customer ? "Change secondary customer" : "Add secondary customer"}
                    </DialogTitle>
                    <DialogDescription>
                        Optional co-buyer or second contact. Primary customer is {getLeadFullName(lead)}.
                    </DialogDescription>
                </DialogHeader>

                {/* Search input - same style as main search */}
                <div className="flex items-center border-b px-4">
                    <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent px-3 py-4 text-base outline-none placeholder:text-muted-foreground"
                        placeholder="Search customers by name, phone, or email..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    {isSearching && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {query && !isSearching && (
                        <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="p-1 hover:bg-accent rounded"
                        >
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                        </button>
                    )}
                </div>

                {/* Results list */}
                <div className="max-h-[320px] overflow-y-auto">
                    {!query && (
                        <div className="p-8 text-center text-muted-foreground">
                            <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-sm">Start typing to search customers</p>
                            <p className="text-xs mt-2">
                                Search by name, phone number, or email address
                            </p>
                        </div>
                    )}
                    {query && !isSearching && results.length === 0 && !showAddForm && (
                        <div className="p-8 text-center text-muted-foreground">
                            <XCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-sm">No customers found for &quot;{query}&quot;</p>
                            <p className="text-xs mt-2">Try a different search or add a new customer.</p>
                            <Button
                                type="button"
                                variant="outline"
                                className="mt-4"
                                onClick={openAddForm}
                            >
                                <UserPlus className="h-4 w-4 mr-2" />
                                Add new customer
                            </Button>
                        </div>
                    )}
                    {query && showAddForm && (
                        <div className="p-4 space-y-4">
                            <p className="text-sm font-medium text-foreground">New secondary customer</p>
                            <div className="grid gap-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label htmlFor="sec-first-name">First name</Label>
                                        <Input
                                            id="sec-first-name"
                                            value={addForm.first_name}
                                            onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                                            placeholder="First name"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="sec-last-name">Last name</Label>
                                        <Input
                                            id="sec-last-name"
                                            value={addForm.last_name}
                                            onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                                            placeholder="Last name"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="sec-phone">Phone</Label>
                                    <div className="flex gap-2 w-full min-w-0">
                                        <Select
                                            value={secDialCode}
                                            onValueChange={(value) => {
                                                const option = DIAL_CODE_OPTIONS.find((o) => o.dial === value)
                                                if (option) {
                                                    setSecDialCode(option.dial)
                                                    setSecCountryCode(option.code)
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="w-[120px] shrink-0">
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
                                        <div className="relative flex-1 min-w-0">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                            <Input
                                                id="sec-phone"
                                                type="tel"
                                                inputMode="tel"
                                                placeholder={secCountryCode === "US" ? "234 567 8900" : "phone number"}
                                                className="pl-9 w-full min-w-0"
                                                value={addForm.phone}
                                                onChange={(e) => handleSecPhoneChange(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">Country: {secCountryCode}</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="sec-email">Email</Label>
                                    <Input
                                        id="sec-email"
                                        type="email"
                                        value={addForm.email}
                                        onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                                        placeholder="Email"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setShowAddForm(false)}
                                    disabled={creatingCustomer}
                                >
                                    Back
                                </Button>
                                <Button
                                    onClick={handleCreateAndAssign}
                                    disabled={creatingCustomer || !addForm.first_name.trim()}
                                    loading={creatingCustomer}
                                    loadingText="Creating..."
                                >
                                    Create & assign
                                </Button>
                            </div>
                        </div>
                    )}
                    {query && results.length > 0 && (
                        <div className="py-2">
                            <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                Select a customer ({results.length})
                            </div>
                            {listItems.map((item, index) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                        "w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-accent transition-colors",
                                        selectedCustomerId === item.id && "bg-accent",
                                        index === effectiveIndex && "bg-accent"
                                    )}
                                    onClick={() => setSelectedCustomerId(item.id)}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    {item.id === "none" ? (
                                        <>
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm">
                                                —
                                            </div>
                                            <div className="flex-1 min-w-0 text-muted-foreground">
                                                None (clear secondary customer)
                                            </div>
                                        </>
                                    ) : item.customer ? (
                                        <>
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                                                {item.customer.first_name?.[0]?.toUpperCase() || "?"}
                                                {item.customer.last_name?.[0]?.toUpperCase() ?? ""}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{getCustomerFullName(item.customer)}</p>
                                                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                                    {item.customer.phone && (
                                                        <span className="flex items-center gap-1 truncate">
                                                            <Phone className="h-3 w-3" />
                                                            {item.customer.phone}
                                                        </span>
                                                    )}
                                                    {item.customer.email && (
                                                        <span className="flex items-center gap-1 truncate">
                                                            <Mail className="h-3 w-3" />
                                                            {item.customer.email}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t px-4 py-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    {lead.secondary_customer_id && (
                        <Button variant="outline" onClick={handleClear} disabled={isSubmitting}>
                            Clear secondary
                        </Button>
                    )}
                    <Button
                        onClick={handleAssign}
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        loadingText="Saving..."
                    >
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
