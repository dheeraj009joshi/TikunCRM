"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import QRCode from "react-qr-code"
import {
    Loader2,
    FileText,
    Calendar,
    Copy,
    Check,
    ShieldOff,
    Download,
    User,
    Phone,
    Mail,
    MapPin,
    DollarSign,
    Car,
    Repeat,
    SlidersHorizontal,
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { EligibilityPanel } from "@/components/eligibility/eligibility-panel"
import { useRole } from "@/hooks/use-role"
import { AppointmentService } from "@/services/appointment-service"
import {
    exportGuestQrPng,
    formatAppointmentLabel,
} from "@/lib/qr-export"
import {
    GuestService,
    type Guest,
    type GuestDocument,
    type GuestUpdatePayload,
} from "@/services/guest-service"

interface GuestFormModalProps {
    isOpen: boolean
    onClose: () => void
    leadId: string
    appointmentId?: string | null
    dealershipId?: string | null
    onComplete?: () => void
}

type FieldDef = {
    key: keyof Guest
    label: string
    type?: string
    full?: boolean
    icon?: React.ComponentType<{ className?: string }>
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
    {
        title: "Contact",
        fields: [
            { key: "full_name", label: "Full name", icon: User, full: true },
            { key: "phone", label: "Phone", icon: Phone },
            { key: "email", label: "Email", icon: Mail },
            { key: "address", label: "Address", icon: MapPin, full: true },
            { key: "city", label: "City" },
            { key: "state", label: "State" },
            { key: "postal_code", label: "Postal code" },
        ],
    },
    {
        title: "Deal details",
        fields: [
            { key: "down_payment", label: "Down payment", type: "number", icon: DollarSign },
            { key: "vehicle_of_interest", label: "Vehicle of interest", icon: Car, full: true },
            { key: "trade_in", label: "Trade-in", icon: Repeat },
        ],
    },
]

const STATUS_LABEL: Record<string, string> = {
    draft: "Draft",
    ready: "Ready",
    checked_in: "Checked in",
    completed: "Completed",
}

function guestToPayload(guest: Guest): GuestUpdatePayload {
    return {
        full_name: guest.full_name ?? null,
        phone: guest.phone ?? null,
        email: guest.email ?? null,
        address: guest.address ?? null,
        city: guest.city ?? null,
        state: guest.state ?? null,
        postal_code: guest.postal_code ?? null,
        down_payment:
            guest.down_payment != null && guest.down_payment !== ("" as unknown)
                ? Number(guest.down_payment)
                : null,
        vehicle_of_interest: guest.vehicle_of_interest ?? null,
        trade_in: guest.trade_in ?? null,
        notes: guest.notes ?? null,
    }
}

function shareUrlForGuest(guest: Guest): string | null {
    if (guest.share_token && !guest.share_revoked) {
        return `${window.location.origin}/g/${guest.share_token}`
    }
    return null
}

export function GuestFormModal({
    isOpen,
    onClose,
    leadId,
    appointmentId,
    dealershipId,
    onComplete,
}: GuestFormModalProps) {
    const [guest, setGuest] = React.useState<Guest | null>(null)
    const [documents, setDocuments] = React.useState<GuestDocument[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle")
    const [shareUrl, setShareUrl] = React.useState<string | null>(null)
    const [appointmentAt, setAppointmentAt] = React.useState<string | null>(null)
    const [copied, setCopied] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const guestRef = React.useRef<Guest | null>(null)
    const qrContainerRef = React.useRef<HTMLDivElement>(null)
    const router = useRouter()
    const { isSuperAdmin, isDealershipLevel, isBdc } = useRole()
    const canManageCriteria = isSuperAdmin || isDealershipLevel || isBdc

    guestRef.current = guest

    const persistGuest = React.useCallback(async (nextGuest: Guest) => {
        setSaveStatus("saving")
        setError(null)
        try {
            const updated = await GuestService.update(nextGuest.id, guestToPayload(nextGuest))
            setGuest(updated)
            guestRef.current = updated
            const url = shareUrlForGuest(updated)
            if (url) setShareUrl(url)
            setSaveStatus("saved")
        } catch (e) {
            console.error("Failed to save guest", e)
            setSaveStatus("error")
            setError("Failed to save guest details")
        }
    }, [])

    const scheduleSave = React.useCallback(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const current = guestRef.current
            if (current) void persistGuest(current)
        }, 600)
    }, [persistGuest])

    React.useEffect(() => {
        if (!isOpen) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            setGuest(null)
            setDocuments([])
            setShareUrl(null)
            setAppointmentAt(null)
            setError(null)
            setSaveStatus("idle")
            return
        }

        let cancelled = false
        setIsLoading(true)
        setError(null)

        GuestService.getOrCreate({
            lead_id: leadId,
            appointment_id: appointmentId || null,
            dealership_id: dealershipId || null,
        })
            .then(async (g) => {
                if (cancelled) return
                setGuest(g)
                guestRef.current = g
                setShareUrl(shareUrlForGuest(g))
                try {
                    setDocuments(await GuestService.getDocuments(g.id))
                } catch {
                    /* documents are best-effort */
                }

                const resolvedApptId = appointmentId || g.appointment_id
                let scheduledAt: string | null = null
                if (resolvedApptId) {
                    try {
                        const appt = await AppointmentService.get(resolvedApptId)
                        scheduledAt = appt.scheduled_at
                    } catch {
                        /* fall back to lead appointments */
                    }
                }
                if (!scheduledAt) {
                    try {
                        const res = await AppointmentService.list({ lead_id: leadId, page_size: 20 })
                        const items = res.items || []
                        const upcoming = items
                            .filter((a) => ["scheduled", "confirmed"].includes(a.status))
                            .sort(
                                (a, b) =>
                                    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
                            )[0]
                        const latest = [...items].sort(
                            (a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
                        )[0]
                        scheduledAt = upcoming?.scheduled_at ?? latest?.scheduled_at ?? null
                    } catch {
                        scheduledAt = null
                    }
                }
                if (!cancelled) setAppointmentAt(scheduledAt)
            })
            .catch((e) => {
                if (cancelled) return
                console.error("Failed to load guest profile", e)
                setError("Failed to load guest profile")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        }
    }, [isOpen, leadId, appointmentId, dealershipId])

    const setField = (key: keyof Guest, value: string) => {
        setGuest((prev) => {
            if (!prev) return prev
            const next = { ...prev, [key]: value }
            guestRef.current = next
            return next
        })
        scheduleSave()
    }

    const handleRevoke = async () => {
        if (!guest) return
        try {
            const updated = await GuestService.revokeShare(guest.id)
            setGuest(updated)
            setShareUrl(null)
        } catch (e) {
            console.error("Failed to revoke share", e)
        }
    }

    const handleCopy = async () => {
        if (!shareUrl) return
        try {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* clipboard may be unavailable */
        }
    }

    const handleExportQr = async () => {
        const svg = qrContainerRef.current?.querySelector("svg")
        if (!svg || !guest) return
        try {
            await exportGuestQrPng({
                svg,
                guestName: guest.full_name || "Guest",
                appointmentAt,
            })
        } catch (e) {
            console.error("Failed to export QR", e)
            setError("Failed to export QR code")
        }
    }

    const handleFinish = () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        const current = guestRef.current
        if (current) void persistGuest(current).finally(() => {
            onComplete?.()
            onClose()
        })
        else {
            onComplete?.()
            onClose()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleFinish()}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0">
                <DialogHeader className="space-y-0 border-b px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-base font-semibold">
                            {(guest?.full_name || "G").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="flex items-center gap-2 text-lg">
                                {guest?.full_name || "Guest Profile"}
                                {guest && (
                                    <Badge variant="secondary" className="text-[10px]">
                                        {STATUS_LABEL[guest.status] || guest.status}
                                    </Badge>
                                )}
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                Review and update guest details — changes save automatically. The QR code is permanent for this lead.
                            </DialogDescription>
                        </div>
                        {saveStatus === "saving" && (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                            </span>
                        )}
                        {saveStatus === "saved" && (
                            <span className="text-xs text-emerald-600 shrink-0">Saved</span>
                        )}
                    </div>
                </DialogHeader>

                {error && (
                    <div className="mx-6 mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}

                {isLoading || !guest ? (
                    <div className="flex h-48 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-5 px-6 py-5">
                        {SECTIONS.map((section) => (
                            <div key={section.title} className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {section.title}
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {section.fields.map((f) => {
                                        const Icon = f.icon
                                        return (
                                            <div key={String(f.key)} className={`space-y-1.5 ${f.full ? "col-span-2" : ""}`}>
                                                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                                                <div className="relative">
                                                    {Icon && (
                                                        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                                    )}
                                                    <Input
                                                        type={f.type || "text"}
                                                        className={Icon ? "pl-9" : ""}
                                                        value={(guest[f.key] as string | number | null) ?? ""}
                                                        onChange={(e) => setField(f.key, e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Notes</Label>
                            <Textarea
                                rows={2}
                                value={guest.notes ?? ""}
                                onChange={(e) => setField("notes", e.target.value)}
                                placeholder="Anything the showroom team should know…"
                            />
                        </div>

                        <div className="space-y-2">
                            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <FileText className="h-3.5 w-3.5" /> Documents on file
                            </h3>
                            {documents.length === 0 ? (
                                <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                                    No documents uploaded yet. Upload them from the lead&apos;s Stips tab.
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {documents.map((d) => (
                                        <div key={d.id} className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
                                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span className="font-medium">{d.category_name}</span>
                                            <span className="text-muted-foreground">· {d.file_name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            {canManageCriteria && (
                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            handleFinish()
                                            router.push("/settings/eligibility")
                                        }}
                                    >
                                        <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                                        Manage criteria
                                    </Button>
                                </div>
                            )}
                            <EligibilityPanel entityType="guest" entityId={guest.id} title="Guest Trust Score" />
                        </div>

                        {shareUrl && !guest.share_revoked && (
                            <div className="flex flex-col items-center gap-3 rounded-xl border bg-muted/20 p-5">
                                <div className="text-center space-y-1">
                                    <p className="text-sm font-semibold">{guest.full_name || "Guest"}</p>
                                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                                        {formatAppointmentLabel(appointmentAt)}
                                    </p>
                                </div>
                                <div ref={qrContainerRef} className="rounded-lg bg-white p-3 shadow-sm">
                                    <QRCode value={shareUrl} size={160} />
                                </div>
                                <p className="text-xs text-muted-foreground">Scan to open the guest&apos;s shareable profile</p>
                                <div className="flex w-full max-w-md items-center gap-2">
                                    <Input readOnly value={shareUrl} className="text-xs" />
                                    <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                                        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2">
                                    <Button type="button" variant="secondary" size="sm" onClick={handleExportQr}>
                                        <Download className="h-4 w-4 mr-1.5" /> Export QR
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={handleRevoke}>
                                        <ShieldOff className="h-4 w-4 mr-1.5" /> Revoke link
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-2">
                    <Button onClick={handleFinish} disabled={saveStatus === "saving"}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
