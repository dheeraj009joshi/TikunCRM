"use client"

import * as React from "react"
import { Loader2, Store, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    PartnerStoreService,
    PartnerStore,
    type LeadPartnerDestinations,
} from "@/services/partner-store-service"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface AssignPartnerStoreProps {
    leadId: string
    kind?: "sent" | "sold"
    currentPartnerStoreId?: string | null
    currentPartnerStoreName?: string | null
    stores?: PartnerStore[]
    disabled?: boolean
    compact?: boolean
    className?: string
    onAssigned?: (destinations: LeadPartnerDestinations) => void
}

/**
 * Assign sent-to or sold-to partner store.
 * Partner list is cached in PartnerStoreService unless `stores` is passed.
 */
export function AssignPartnerStore({
    leadId,
    kind = "sent",
    currentPartnerStoreId,
    currentPartnerStoreName,
    stores: storesProp,
    disabled = false,
    compact = false,
    className,
    onAssigned,
}: AssignPartnerStoreProps) {
    const { toast } = useToast()
    const [fetchedStores, setFetchedStores] = React.useState<PartnerStore[]>([])
    const [loadingList, setLoadingList] = React.useState(!storesProp)
    const [saving, setSaving] = React.useState(false)
    const [value, setValue] = React.useState(currentPartnerStoreId || "")

    React.useEffect(() => {
        setValue(currentPartnerStoreId || "")
    }, [currentPartnerStoreId])

    React.useEffect(() => {
        if (storesProp) {
            setLoadingList(false)
            return
        }
        let cancelled = false
        setLoadingList(true)
        PartnerStoreService.list({ active_only: true })
            .then((res) => {
                if (!cancelled) setFetchedStores(res.items || [])
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoadingList(false)
            })
        return () => {
            cancelled = true
        }
    }, [storesProp])

    const stores = storesProp ?? fetchedStores
    const label = kind === "sold" ? "Sold To" : "Sent To"
    const currentMissing = Boolean(value && !stores.some((s) => s.id === value))

    const handleChange = async (nextId: string) => {
        if (disabled || saving) return
        const previous = value
        const nextValue = nextId === "none" ? "" : nextId
        setValue(nextValue)
        setSaving(true)
        try {
            const payload =
                kind === "sold"
                    ? { sold_to_partner_store_id: nextValue || null }
                    : { sent_to_partner_store_id: nextValue || null }
            const result = await PartnerStoreService.setLeadPartnerDestinations(leadId, payload)
            onAssigned?.(result)
            const assigned =
                kind === "sold" ? result.sold_to_partner_store : result.sent_to_partner_store
            toast({
                title: assigned ? `${label} updated` : `${label} cleared`,
                description: assigned
                    ? `Linked to ${assigned.name}`
                    : `${label} partner removed from this lead.`,
            })
        } catch (err: unknown) {
            setValue(previous)
            const detail =
                err && typeof err === "object" && "response" in err
                    ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                    : undefined
            toast({
                title: `Could not update ${label.toLowerCase()}`,
                description: typeof detail === "string" ? detail : "Please try again.",
                variant: "destructive",
            })
        } finally {
            setSaving(false)
        }
    }

    if (loadingList && stores.length === 0) {
        return (
            <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading partners…</span>
            </div>
        )
    }

    return (
        <div className={cn("flex items-center gap-1.5 min-w-0", className)}>
            <Select
                value={value || "none"}
                onValueChange={handleChange}
                disabled={disabled || saving || stores.length === 0}
            >
                <SelectTrigger className={cn("min-w-0", compact ? "h-8 w-[190px]" : "h-9")}>
                    <div className="flex items-center gap-1.5 min-w-0">
                        {saving ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : (
                            <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                    </div>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">
                        <span className="text-muted-foreground">No partner</span>
                    </SelectItem>
                    {currentMissing && value ? (
                        <SelectItem value={value}>
                            {currentPartnerStoreName || "Current partner"}
                        </SelectItem>
                    ) : null}
                    {stores.map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                            {store.name}
                            {store.brand ? ` (${store.brand})` : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {value && !disabled && !compact && (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                    disabled={saving}
                    onClick={() => handleChange("none")}
                    title={`Clear ${label.toLowerCase()}`}
                >
                    <X className="h-3.5 w-3.5" />
                </Button>
            )}
        </div>
    )
}
