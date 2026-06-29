"use client"

import * as React from "react"
import QRCode from "react-qr-code"
import { Loader2, FileText, QrCode, Copy, Check, ShieldOff, UserCheck } from "lucide-react"
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
import {
    GuestService,
    type Guest,
    type GuestDocument,
} from "@/services/guest-service"

interface GuestFormModalProps {
    isOpen: boolean
    onClose: () => void
    leadId: string
    appointmentId?: string | null
    dealershipId?: string | null
    onComplete?: () => void
}

const FIELDS: { key: keyof Guest; label: string; type?: string; full?: boolean }[] = [
    { key: "full_name", label: "Full name" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "down_payment", label: "Down payment", type: "number" },
    { key: "address", label: "Address", full: true },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "postal_code", label: "Postal code" },
    { key: "vehicle_of_interest", label: "Vehicle of interest", full: true },
    { key: "trade_in", label: "Trade-in" },
]

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
    const [isSaving, setIsSaving] = React.useState(false)
    const [isSharing, setIsSharing] = React.useState(false)
    const [shareUrl, setShareUrl] = React.useState<string | null>(null)
    const [copied, setCopied] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const createdRef = React.useRef(false)

    React.useEffect(() => {
        if (!isOpen) {
            setGuest(null)
            setDocuments([])
            setShareUrl(null)
            setError(null)
            createdRef.current = false
            return
        }
        if (createdRef.current) return
        createdRef.current = true
        setIsLoading(true)
        GuestService.create({
            lead_id: leadId,
            appointment_id: appointmentId || null,
            dealership_id: dealershipId || null,
        })
            .then(async (g) => {
                setGuest(g)
                if (g.share_token && !g.share_revoked) {
                    setShareUrl(`${window.location.origin}/g/${g.share_token}`)
                }
                try {
                    setDocuments(await GuestService.getDocuments(g.id))
                } catch {
                    /* documents are best-effort */
                }
            })
            .catch((e) => {
                console.error("Failed to create guest profile", e)
                setError("Failed to start guest profile")
            })
            .finally(() => setIsLoading(false))
    }, [isOpen, leadId, appointmentId, dealershipId])

    const setField = (key: keyof Guest, value: string) =>
        setGuest((prev) => (prev ? { ...prev, [key]: value } : prev))

    const handleSave = async () => {
        if (!guest) return
        setIsSaving(true)
        setError(null)
        try {
            const updated = await GuestService.update(guest.id, {
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
            })
            setGuest(updated)
        } catch (e) {
            console.error("Failed to save guest", e)
            setError("Failed to save guest details")
        } finally {
            setIsSaving(false)
        }
    }

    const handleShare = async () => {
        if (!guest) return
        setIsSharing(true)
        setError(null)
        try {
            await handleSave()
            const res = await GuestService.share(guest.id)
            setShareUrl(`${window.location.origin}/g/${res.share_token}`)
            setGuest((prev) => (prev ? { ...prev, share_token: res.share_token, share_revoked: false } : prev))
        } catch (e) {
            console.error("Failed to share guest", e)
            setError("Failed to generate QR")
        } finally {
            setIsSharing(false)
        }
    }

    const handleRevoke = async () => {
        if (!guest) return
        try {
            await GuestService.revokeShare(guest.id)
            setShareUrl(null)
            setGuest((prev) => (prev ? { ...prev, share_revoked: true } : prev))
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

    const handleFinish = () => {
        onComplete?.()
        onClose()
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-primary" />
                        Guest Profile
                    </DialogTitle>
                    <DialogDescription>
                        Review the auto-filled details, capture anything missing, and share a QR for the showroom team.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">{error}</div>
                )}

                {isLoading || !guest ? (
                    <div className="flex h-40 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Details */}
                        <div className="grid grid-cols-2 gap-3">
                            {FIELDS.map((f) => (
                                <div key={String(f.key)} className={`space-y-1.5 ${f.full ? "col-span-2" : ""}`}>
                                    <Label className="text-xs">{f.label}</Label>
                                    <Input
                                        type={f.type || "text"}
                                        value={(guest[f.key] as string | number | null) ?? ""}
                                        onChange={(e) => setField(f.key, e.target.value)}
                                    />
                                </div>
                            ))}
                            <div className="space-y-1.5 col-span-2">
                                <Label className="text-xs">Notes</Label>
                                <Textarea
                                    rows={2}
                                    value={guest.notes ?? ""}
                                    onChange={(e) => setField("notes", e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Documents on file */}
                        <div className="space-y-2">
                            <Label className="text-xs flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5" /> Documents on file
                            </Label>
                            {documents.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    No documents uploaded yet. Upload them from the lead&apos;s Stips tab.
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {documents.map((d) => (
                                        <Badge key={d.id} variant="secondary" className="text-[11px]">
                                            {d.category_name}: {d.file_name}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Eligibility */}
                        <EligibilityPanel entityType="guest" entityId={guest.id} title="Guest Trust Score" />

                        {/* QR share */}
                        {shareUrl && !guest.share_revoked && (
                            <div className="flex flex-col items-center gap-3 rounded-lg border p-4">
                                <div className="bg-white p-3 rounded-md">
                                    <QRCode value={shareUrl} size={160} />
                                </div>
                                <div className="flex w-full max-w-md items-center gap-2">
                                    <Input readOnly value={shareUrl} className="text-xs" />
                                    <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                                        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={handleRevoke}>
                                    <ShieldOff className="h-4 w-4 mr-1.5" /> Revoke link
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={handleFinish} disabled={isSaving || isSharing}>
                        Done
                    </Button>
                    <Button variant="secondary" onClick={handleSave} disabled={!guest || isSaving || isSharing}>
                        {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Save Details
                    </Button>
                    <Button onClick={handleShare} disabled={!guest || isSharing}>
                        {isSharing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <QrCode className="h-4 w-4 mr-2" />}
                        {shareUrl ? "Regenerate QR" : "Generate QR & Share"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
