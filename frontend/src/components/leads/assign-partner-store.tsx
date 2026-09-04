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
import { PartnerStoreService, PartnerStore } from "@/services/partner-store-service"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface AssignPartnerStoreProps {
    leadId: string
    currentPartnerStoreId?: string | null
    currentPartnerStoreName?: string | null
    /** Compact mode for table cells */
    compact?: boolean
    disabled?: boolean
    className?: string
    onAssigned?: (partner: { id: string; name: string; brand?: string | null } | null) => void
}

/**
 * Assign / change / clear a lead's partner store (Toyota South Atlanta, Ford Atlanta, etc.).
 */
export function AssignPartnerStore({
    leadId,
    currentPartnerStoreId,
    currentPartnerStoreName,
    compact = false,
    disabled = false,
    className,
    onAssigned,
}: AssignPartnerStoreProps) {
    const { toast } = useToast()
    const [stores, setStores] = React.useState<PartnerStore[]>([])
    const [loadingList, setLoadingList] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [value, setValue] = React.useState(currentPartnerStoreId || "")

    React.useEffect(() => {
        setValue(currentPartnerStoreId || "")
    }, [currentPartnerStoreId])

    React.useEffect(() => {
        let cancelled = false
        setLoadingList(true)
        PartnerStoreService.list({ active_only: true })
            .then((res) => {
                if (!cancelled) setStores(res.items || [])
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoadingList(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const handleChange = async (nextId: string) => {
        if (disabled || saving) return
        const previous = value
        setValue(nextId === "none" ? "" : nextId)
        setSaving(true)
        try {
            if (nextId === "none") {
                await PartnerStoreService.disconnectLeadFromPartner(leadId)
                onAssigned?.(null)
                toast({ title: "Partner cleared", description: "Partner store removed from this lead." })
            } else {
                await PartnerStoreService.connectLeadToPartner(leadId, nextId)
                const store = stores.find((s) => s.id === nextId)
                onAssigned?.(
                    store
                        ? { id: store.id, name: store.name, brand: store.brand }
                        : { id: nextId, name: currentPartnerStoreName || "Partner" }
                )
                toast({
                    title: "Partner assigned",
                    description: store ? `Linked to ${store.name}` : "Partner store updated.",
                })
            }
        } catch (err: unknown) {
            setValue(previous)
            const detail =
                err && typeof err === "object" && "response" in err
                    ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                    : undefined
            toast({
                title: "Could not update partner",
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
                {!compact && <span>Loading partners…</span>}
            </div>
        )
    }

    return (
        <div className={cn("flex items-center gap-2 min-w-0", className)}>
            <Select
                value={value || "none"}
                onValueChange={handleChange}
                disabled={disabled || saving || stores.length === 0}
            >
                <SelectTrigger
                    className={cn(
                        "min-w-0",
                        compact ? "h-8 text-xs" : "h-9",
                        compact && "max-w-[180px]"
                    )}
                >
                    <div className="flex items-center gap-1.5 min-w-0">
                        {saving ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : (
                            <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <SelectValue placeholder="Select partner" />
                    </div>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">
                        <span className="text-muted-foreground">No partner</span>
                    </SelectItem>
                    {stores.map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                            {store.name}
                            {store.brand ? ` (${store.brand})` : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {!compact && value && !disabled && (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                    disabled={saving}
                    onClick={() => handleChange("none")}
                    title="Clear partner"
                >
                    <X className="h-3.5 w-3.5" />
                </Button>
            )}
        </div>
    )
}
