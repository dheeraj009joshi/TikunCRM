"use client"

import * as React from "react"
import { Loader2, MessageCircle, MessageSquare, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ActivityService } from "@/services/activity-service"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"

export type LogContactChannel = "phone" | "sms" | "whatsapp"

interface LogContactModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    leadId: string
    /** Lead has a phone — SMS/WhatsApp options need a number for typical use; still allowed to log without */
    /** If false, we still allow SMS/WhatsApp logs (e.g. outreach from another line). */
    hasPhone: boolean
    onLogged: () => void
}

export function LogContactModal({
    open,
    onOpenChange,
    leadId,
    hasPhone,
    onLogged,
}: LogContactModalProps) {
    const [step, setStep] = React.useState<"channel" | "note">("channel")
    const [channel, setChannel] = React.useState<LogContactChannel | null>(null)
    const [notes, setNotes] = React.useState("")
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    const reset = React.useCallback(() => {
        setStep("channel")
        setChannel(null)
        setNotes("")
        setIsSubmitting(false)
    }, [])

    React.useEffect(() => {
        if (!open) {
            reset()
        }
    }, [open, reset])

    const runSubmit = React.useCallback(
        async (confirmSkate?: boolean) => {
            if (!channel) return
            const trimmed = notes.trim()
            if (!trimmed) return

            setIsSubmitting(true)
            try {
                if (channel === "phone") {
                    const result = await ActivityService.logCall(leadId, {
                        outcome: "Outreach",
                        notes: trimmed,
                        confirmSkate: Boolean(confirmSkate),
                    })
                    if (isSkateWarningResponse(result)) {
                        useSkateConfirmStore.getState().show(
                            result as SkateWarningInfo,
                            () => {
                                void runSubmit(true)
                            }
                        )
                        return
                    }
                } else {
                    const result = await ActivityService.logOutreach(leadId, {
                        channel: channel === "sms" ? "sms" : "whatsapp",
                        notes: trimmed,
                        confirmSkate: Boolean(confirmSkate),
                    })
                    if (isSkateWarningResponse(result)) {
                        useSkateConfirmStore.getState().show(
                            result as SkateWarningInfo,
                            () => {
                                void runSubmit(true)
                            }
                        )
                        return
                    }
                }
                onLogged()
                onOpenChange(false)
                reset()
            } catch (err: unknown) {
                const skate = getSkateAttemptDetail(err)
                if (skate) {
                    useSkateAlertStore.getState().show(skate)
                    onOpenChange(false)
                } else {
                    console.error("Failed to log contact:", err)
                }
            } finally {
                setIsSubmitting(false)
            }
        },
        [channel, leadId, notes, onLogged, onOpenChange, reset]
    )

    const handleChannelSelect = (c: LogContactChannel) => {
        setChannel(c)
        setStep("note")
    }

    const channelLabel =
        channel === "phone"
            ? "phone call"
            : channel === "sms"
              ? "text (SMS)"
              : channel === "whatsapp"
                ? "WhatsApp"
                : "contact"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Log contact</DialogTitle>
                    <DialogDescription>
                        {step === "channel"
                            ? "What type of outreach are you logging?"
                            : `Add a note for this ${channelLabel}.`}
                    </DialogDescription>
                </DialogHeader>

                {step === "channel" && (
                    <div className="grid gap-2 py-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto justify-start gap-3 py-3 px-4"
                            onClick={() => handleChannelSelect("phone")}
                        >
                            <Phone className="h-5 w-5 shrink-0 text-emerald-600" />
                            <span className="text-left font-medium">Phone call</span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto justify-start gap-3 py-3 px-4"
                            onClick={() => handleChannelSelect("sms")}
                        >
                            <MessageSquare className="h-5 w-5 shrink-0 text-sky-600" />
                            <span className="text-left font-medium">Text (SMS)</span>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-auto justify-start gap-3 py-3 px-4"
                            onClick={() => handleChannelSelect("whatsapp")}
                        >
                            <MessageCircle className="h-5 w-5 shrink-0 text-green-600" />
                            <span className="text-left font-medium">WhatsApp</span>
                        </Button>
                        {!hasPhone && (
                            <p className="text-xs text-muted-foreground px-1">
                                No phone on file — you can still log outreach done from another line or device.
                            </p>
                        )}
                    </div>
                )}

                {step === "note" && channel && (
                    <div className="space-y-3 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="log-contact-notes">Note</Label>
                            <Textarea
                                id="log-contact-notes"
                                placeholder="What did you discuss or send?"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={5}
                                className="resize-none"
                            />
                        </div>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    {step === "note" && (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                setStep("channel")
                                setChannel(null)
                                setNotes("")
                            }}
                            disabled={isSubmitting}
                        >
                            Back
                        </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    {step === "note" && (
                        <Button
                            type="button"
                            onClick={() => void runSubmit()}
                            disabled={isSubmitting || !notes.trim()}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving…
                                </>
                            ) : (
                                "Log & schedule follow-up"
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
