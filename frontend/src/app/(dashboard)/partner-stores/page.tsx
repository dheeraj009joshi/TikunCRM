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

    const handleSave = async (data: PartnerStoreCreate) => {
        setSaving(true)
        try {
            if (editingStore) {
                await PartnerStoreService.update(editingStore.id, data)
                toast({ title: "Updated", description: `${data.name} updated successfully` })
            } else {
                await PartnerStoreService.create(data)
                toast({ title: "Created", description: `${data.name} created successfully` })
            }
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
                        Manage external dealer partners where approved customers purchase vehicles.
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
    onSave: (data: PartnerStoreCreate) => void
}) {
    const [form, setForm] = useState<PartnerStoreCreate>({
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
    })

    useEffect(() => {
        if (store) {
            setForm({
                name: store.name,
                brand: store.brand || "",
                phone: store.phone || "",
                email: store.email || "",
                website: store.website || "",
                contact_person: store.contact_person || "",
                address: store.address || "",
                city: store.city || "",
                state: store.state || "",
                country: store.country || "US",
                postal_code: store.postal_code || "",
                notes: store.notes || "",
            })
        } else {
            setForm({
                name: "", brand: "", phone: "", email: "", website: "",
                contact_person: "", address: "", city: "", state: "",
                country: "US", postal_code: "", notes: "",
            })
        }
    }, [store, open])

    const update = (field: string, value: string) =>
        setForm((prev) => ({ ...prev, [field]: value }))

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{store ? "Edit Partner Store" : "Add Partner Store"}</DialogTitle>
                    <DialogDescription>
                        {store
                            ? "Update the partner store details."
                            : "Add a new external dealer partner."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Store Name *</Label>
                            <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="brand">Vehicle Brand</Label>
                            <Input id="brand" placeholder="e.g. Toyota, Ford" value={form.brand || ""} onChange={(e) => update("brand", e.target.value)} />
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
                        <Textarea id="notes" rows={3} value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} />
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
