"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import {
    Store,
    Plus,
    Search,
    Phone,
    Mail,
    Globe,
    MapPin,
    Pencil,
    Trash2,
    User,
    RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useRole } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import {
    PartnerStoreService,
    type PartnerStore,
    type PartnerStoreCreate,
} from "@/services/partner-store-service"
import { PartnerProgramService, type PartnerProgram } from "@/services/partner-program-service"
import apiClient from "@/lib/api-client"

export default function PartnerStoresPage() {
    const { isSuperAdmin, isManagerOrAbove } = useRole()
    const { toast } = useToast()

    const [stores, setStores] = useState<PartnerStore[]>([])
    const [brands, setBrands] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [brandFilter, setBrandFilter] = useState<string>("all")
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingStore, setEditingStore] = useState<PartnerStore | null>(null)
    const [saving, setSaving] = useState(false)

    const loadStores = useCallback(async () => {
        setLoading(true)
        try {
            const params: Record<string, unknown> = {}
            if (search) params.search = search
            if (brandFilter && brandFilter !== "all") params.brand = brandFilter
            const res = await PartnerStoreService.list(params as never)
            setStores(res.items)
        } catch {
            toast({ title: "Error", description: "Failed to load partner stores", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [search, brandFilter, toast])

    const loadBrands = useCallback(async () => {
        try {
            const b = await PartnerStoreService.getBrands()
            setBrands(b)
        } catch { /* ignore */ }
    }, [])

    useEffect(() => { loadStores() }, [loadStores])
    useEffect(() => { loadBrands() }, [loadBrands])

    const handleSave = async (data: StoreFormValues) => {
        setSaving(true)
        try {
            const storePayload: PartnerStoreCreate = {
                name: data.name,
                brand: data.brand,
                phone: data.phone,
                email: data.email,
                website: data.website,
                contact_person: data.contact_person,
                address: data.address,
                city: data.city,
                state: data.state,
                country: data.country,
                postal_code: data.postal_code,
                notes: data.notes,
            }
            const saved = editingStore
                ? await PartnerStoreService.update(editingStore.id, storePayload)
                : await PartnerStoreService.create(storePayload)
            await saveStoreOptIn(saved.id, data)
            toast({
                title: editingStore ? "Updated" : "Created",
                description: `${data.name} saved`,
            })
            setShowCreateModal(false)
            setEditingStore(null)
            loadStores()
            loadBrands()
        } catch {
            toast({ title: "Error", description: "Failed to save partner store", variant: "destructive" })
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (store: PartnerStore) => {
        if (!confirm(`Deactivate "${store.name}"? This can be undone.`)) return
        try {
            await PartnerStoreService.delete(store.id)
            toast({ title: "Deactivated", description: `${store.name} deactivated` })
            loadStores()
        } catch {
            toast({ title: "Error", description: "Failed to deactivate store", variant: "destructive" })
        }
    }

    return (
        <div className="flex-1 space-y-4 p-4 md:p-6 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Partner Stores</h2>
                    <p className="text-muted-foreground">
                        Add a dealer and choose whether they receive leads or full BDC appointments.
                    </p>
                </div>
                {isManagerOrAbove && (
                    <Button onClick={() => { setEditingStore(null); setShowCreateModal(true) }}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Partner Store
                    </Button>
                )}
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search stores..."
                                className="pl-8"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <Select value={brandFilter} onValueChange={setBrandFilter}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="All Brands" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Brands</SelectItem>
                                {brands.map((b) => (
                                    <SelectItem key={b} value={b}>{b}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" onClick={loadStores}>
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading...
                        </div>
                    ) : stores.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Store className="h-12 w-12 text-muted-foreground/50 mb-3" />
                            <p className="text-lg font-medium">No partner stores yet</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Add your first partner store to start connecting approved customers.
                            </p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Brand</TableHead>
                                    <TableHead className="hidden md:table-cell">Location</TableHead>
                                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                                    <TableHead>Receives</TableHead>
                                    <TableHead>Status</TableHead>
                                    {isManagerOrAbove && <TableHead className="text-right">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stores.map((store) => (
                                    <TableRow key={store.id}>
                                        <TableCell className="font-medium">{store.name}</TableCell>
                                        <TableCell>
                                            {store.brand ? (
                                                <Badge variant="outline">{store.brand}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            {store.city && store.state
                                                ? `${store.city}, ${store.state}`
                                                : store.city || store.state || "—"}
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            <div className="flex flex-col gap-0.5 text-sm">
                                                {store.contact_person && (
                                                    <span className="flex items-center gap-1">
                                                        <User className="h-3 w-3" /> {store.contact_person}
                                                    </span>
                                                )}
                                                {store.phone && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="h-3 w-3" /> {store.phone}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{optInLabel(store.program_type)}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={store.is_active ? "default" : "secondary"}>
                                                {store.is_active ? "Active" : "Inactive"}
                                            </Badge>
                                        </TableCell>
                                        {isManagerOrAbove && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => { setEditingStore(store); setShowCreateModal(true) }}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    {isSuperAdmin && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDelete(store)}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <PartnerStoreModal
                open={showCreateModal}
                store={editingStore}
                saving={saving}
                onClose={() => { setShowCreateModal(false); setEditingStore(null) }}
                onSave={handleSave}
            />
        </div>
    )
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

type OptIn = "off" | "leads_only" | "full_bdc"

interface StoreFormValues extends PartnerStoreCreate {
    optIn: OptIn
    states: string
    postalCodes: string
    dailyCap: string
    monthlyCap: string
    opens: string
    closes: string
    openDays: string[]
    agentIds: string[]
    maxOpen: string
    portalEmail: string
    portalPassword: string
}

const emptyForm = (): StoreFormValues => ({
    name: "",
    brand: "",
    phone: "",
    email: "",
    website: "",
    contact_person: "",
    address: "",
    city: "",
    state: "",
    country: "US",
    postal_code: "",
    notes: "",
    optIn: "off",
    states: "",
    postalCodes: "",
    dailyCap: "",
    monthlyCap: "",
    opens: "",
    closes: "",
    openDays: DAYS.slice(0, 6),
    agentIds: [],
    maxOpen: "15",
    portalEmail: "",
    portalPassword: "",
})

function optInLabel(programType?: string | null) {
    if (programType === "leads_only") return "Leads only"
    if (programType === "full_bdc") return "Full BDC"
    return "Not opted in"
}

function splitList(value: string) {
    return value.split(",").map((item) => item.trim()).filter(Boolean)
}

function numberOrNull(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
}

async function saveStoreOptIn(storeId: string, data: StoreFormValues) {
    const existing = await PartnerProgramService.get(storeId).catch(() => null)
    if (data.optIn === "off") {
        if (existing) {
            await PartnerProgramService.save(storeId, {
                program_type: existing.program_type,
                status: "cancelled",
                states: existing.states || [],
                postal_codes: existing.postal_codes || [],
                min_credit_score: existing.min_credit_score,
                max_credit_score: existing.max_credit_score,
                min_down_payment: existing.min_down_payment,
                daily_cap: existing.daily_cap,
                monthly_cap: existing.monthly_cap,
                hours: existing.hours || {},
                timezone: existing.timezone || "America/New_York",
                priority_weight: existing.priority_weight ?? 0,
            })
        }
        return
    }

    const hours: PartnerProgram["hours"] = {}
    if (data.opens && data.closes) {
        for (const day of DAYS) {
            hours[day] = {
                start: data.opens,
                end: data.closes,
                is_open: data.openDays.includes(day),
            }
        }
    }
    await PartnerProgramService.save(storeId, {
        program_type: data.optIn,
        status: "active",
        states: splitList(data.states),
        postal_codes: splitList(data.postalCodes),
        daily_cap: numberOrNull(data.dailyCap),
        monthly_cap: numberOrNull(data.monthlyCap),
        hours,
        timezone: "America/New_York",
        priority_weight: existing?.priority_weight ?? 0,
        min_credit_score: existing?.min_credit_score,
        max_credit_score: existing?.max_credit_score,
        min_down_payment: existing?.min_down_payment,
    })
    if (data.optIn === "full_bdc") {
        await PartnerProgramService.saveBdcAgents(
            storeId,
            data.agentIds.map((userId) => ({
                user_id: userId,
                max_open_leads: numberOrNull(data.maxOpen) || 15,
            }))
        )
    }
    if (data.portalEmail.trim() && data.portalPassword.trim()) {
        await PartnerProgramService.createPortalUser(storeId, {
            email: data.portalEmail.trim(),
            password: data.portalPassword,
        })
    }
}

function PartnerStoreModal({
    open,
    store,
    saving,
    onClose,
    onSave,
}: {
    open: boolean
    store: PartnerStore | null
    saving: boolean
    onClose: () => void
    onSave: (data: StoreFormValues) => void
}) {
    const [form, setForm] = useState<StoreFormValues>(emptyForm)
    const [agents, setAgents] = useState<{ id: string; first_name: string; last_name: string }[]>([])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        ;(async () => {
            const next = emptyForm()
            if (store) {
                next.name = store.name
                next.brand = store.brand || ""
                next.phone = store.phone || ""
                next.email = store.email || ""
                next.website = store.website || ""
                next.contact_person = store.contact_person || ""
                next.address = store.address || ""
                next.city = store.city || ""
                next.state = store.state || ""
                next.country = store.country || "US"
                next.postal_code = store.postal_code || ""
                next.notes = store.notes || ""
                if (store.program_type === "leads_only" || store.program_type === "full_bdc") {
                    next.optIn = store.program_type
                }
                const [program, assigned, bdcUsers] = await Promise.all([
                    PartnerProgramService.get(store.id).catch(() => null),
                    PartnerProgramService.listBdcAgents(store.id).catch(() => []),
                    apiClient.get<{ id: string; first_name: string; last_name: string }[]>("/users/", { params: { role: "bdc", is_active: true } }).then((res) => res.data).catch(() => []),
                ])
                if (cancelled) return
                setAgents(bdcUsers)
                if (program && program.status !== "cancelled") {
                    next.optIn = program.program_type
                    next.states = (program.states || []).join(", ")
                    next.postalCodes = (program.postal_codes || []).join(", ")
                    next.dailyCap = program.daily_cap?.toString() || ""
                    next.monthlyCap = program.monthly_cap?.toString() || ""
                    const firstDay = DAYS.map((day) => program.hours?.[day]).find((day) => day?.start && day?.end)
                    next.opens = firstDay?.start || ""
                    next.closes = firstDay?.end || ""
                    const days = DAYS.filter((day) => program.hours?.[day] && program.hours[day].is_open !== false)
                    if (days.length) next.openDays = days
                }
                next.agentIds = assigned.map((row) => row.user_id)
                if (assigned[0]) next.maxOpen = String(assigned[0].max_open_leads)
            } else {
                const bdcUsers = await apiClient.get<{ id: string; first_name: string; last_name: string }[]>("/users/", { params: { role: "bdc", is_active: true } }).then((res) => res.data).catch(() => [])
                if (cancelled) return
                setAgents(bdcUsers)
            }
            if (!cancelled) setForm(next)
        })()
        return () => {
            cancelled = true
        }
    }, [store, open])

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }))

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{store ? "Edit Partner Store" : "Add Partner Store"}</DialogTitle>
                    <DialogDescription>
                        Store details and how this dealer receives leads, in one form.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Store Name *</Label>
                            <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="brand">Brand</Label>
                            <Input id="brand" placeholder="Toyota, Ford, Honda" value={form.brand || ""} onChange={(e) => update("brand", e.target.value)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="contact_person">Contact Person</Label>
                            <div className="relative">
                                <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input id="contact_person" className="pl-8" value={form.contact_person || ""} onChange={(e) => update("contact_person", e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone</Label>
                            <div className="relative">
                                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input id="phone" className="pl-8" value={form.phone || ""} onChange={(e) => update("phone", e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input id="email" className="pl-8" type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="website">Website</Label>
                            <div className="relative">
                                <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input id="website" className="pl-8" value={form.website || ""} onChange={(e) => update("website", e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <div className="relative">
                            <MapPin className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input id="address" className="pl-8" value={form.address || ""} onChange={(e) => update("address", e.target.value)} />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input id="city" value={form.city || ""} onChange={(e) => update("city", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="state">State</Label>
                            <Input id="state" value={form.state || ""} onChange={(e) => update("state", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="postal_code">Postal Code</Label>
                            <Input id="postal_code" value={form.postal_code || ""} onChange={(e) => update("postal_code", e.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea id="notes" rows={2} value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} />
                    </div>

                    <div className="space-y-3 border-t pt-4">
                        <div className="space-y-2">
                            <Label>What they receive</Label>
                            <Select value={form.optIn} onValueChange={(value) => setForm((prev) => ({ ...prev, optIn: value as OptIn }))}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="off">Not opted in</SelectItem>
                                    <SelectItem value="leads_only">Leads only</SelectItem>
                                    <SelectItem value="full_bdc">Full BDC appointments</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                The brand above is the bucket. A lead can go to Toyota and Ford. It never goes to two stores of the same brand.
                            </p>
                        </div>
                        {form.optIn !== "off" && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>States they cover</Label>
                                        <Input value={form.states} placeholder="GA, FL" onChange={(e) => update("states", e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Zip codes</Label>
                                        <Input value={form.postalCodes} placeholder="30301, 30302" onChange={(e) => update("postalCodes", e.target.value)} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Daily cap</Label>
                                        <Input value={form.dailyCap} onChange={(e) => update("dailyCap", e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Monthly cap</Label>
                                        <Input value={form.monthlyCap} onChange={(e) => update("monthlyCap", e.target.value)} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Opens</Label>
                                        <Input type="time" value={form.opens} onChange={(e) => update("opens", e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Closes</Label>
                                        <Input type="time" value={form.closes} onChange={(e) => update("closes", e.target.value)} />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2 text-sm">
                                    {DAYS.map((day) => (
                                        <label key={day} className="flex items-center gap-1">
                                            <input
                                                type="checkbox"
                                                checked={form.openDays.includes(day)}
                                                onChange={(event) => {
                                                    setForm((prev) => ({
                                                        ...prev,
                                                        openDays: event.target.checked
                                                            ? [...prev.openDays, day]
                                                            : prev.openDays.filter((item) => item !== day),
                                                    }))
                                                }}
                                            />
                                            {day.slice(0, 3)}
                                        </label>
                                    ))}
                                </div>
                                {form.optIn === "full_bdc" && (
                                    <div className="space-y-2">
                                        <Label>BDC agents</Label>
                                        <Input className="max-w-[140px]" value={form.maxOpen} onChange={(e) => update("maxOpen", e.target.value)} placeholder="Max open leads" />
                                        <div className="max-h-28 space-y-1 overflow-y-auto text-sm">
                                            {agents.length === 0 && <p className="text-muted-foreground">No BDC users yet.</p>}
                                            {agents.map((agent) => (
                                                <label key={agent.id} className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={form.agentIds.includes(agent.id)}
                                                        onChange={(event) => {
                                                            setForm((prev) => ({
                                                                ...prev,
                                                                agentIds: event.target.checked
                                                                    ? [...prev.agentIds, agent.id]
                                                                    : prev.agentIds.filter((id) => id !== agent.id),
                                                            }))
                                                        }}
                                                    />
                                                    {agent.first_name} {agent.last_name}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Portal email</Label>
                                        <Input value={form.portalEmail} placeholder="Optional login" onChange={(e) => update("portalEmail", e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Portal password</Label>
                                        <Input type="password" value={form.portalPassword} onChange={(e) => update("portalPassword", e.target.value)} />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => onSave(form)} disabled={saving || !form.name.trim()}>
                        {saving ? "Saving..." : store ? "Update" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
