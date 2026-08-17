"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Phone, PhoneMissed, Loader2, ExternalLink, CheckCheck } from "lucide-react"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useWebSocketEvent, useNotificationEvents } from "@/hooks/use-websocket"
import { formatRelativeTimeInTimezone } from "@/utils/timezone"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    voiceService,
    type MissedCallItem,
} from "@/services/voice-service"

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "")
    if (digits.length === 11 && digits.startsWith("1")) {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
    }
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    }
    return phone
}

export function MissedCallsBell() {
    const router = useRouter()
    const { timezone } = useBrowserTimezone()
    const [open, setOpen] = React.useState(false)
    const [items, setItems] = React.useState<MissedCallItem[]>([])
    const [pendingCount, setPendingCount] = React.useState(0)
    const [isLoading, setIsLoading] = React.useState(false)
    const [isMarkingAll, setIsMarkingAll] = React.useState(false)

    const fetchMissed = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const res = await voiceService.listMissedCalls({ page_size: 15 })
            setItems(res.items)
            setPendingCount(res.pending_count)
        } catch (error) {
            console.error("Failed to fetch missed calls:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Badge count on mount + light poll (missed calls may lack a dedicated WS event)
    React.useEffect(() => {
        void fetchMissed()
        const id = window.setInterval(() => {
            void voiceService
                .listMissedCalls({ page_size: 1 })
                .then((res) => setPendingCount(res.pending_count))
                .catch(() => {})
        }, 60_000)
        return () => window.clearInterval(id)
    }, [fetchMissed])

    // Softphone / voice status events often mean a new call finished
    useWebSocketEvent(
        "call:status",
        () => {
            void voiceService
                .listMissedCalls({ page_size: 1 })
                .then((res) => setPendingCount(res.pending_count))
                .catch(() => {})
        },
        []
    )

    useNotificationEvents(
        React.useCallback((notification: { notification_type?: string; type?: string }) => {
            const t = String(notification.notification_type || notification.type || "").toLowerCase()
            if (t === "missed_call" || t === "voicemail") {
                void voiceService
                    .listMissedCalls({ page_size: 1 })
                    .then((res) => setPendingCount(res.pending_count))
                    .catch(() => {})
            }
        }, [])
    )

    React.useEffect(() => {
        if (open) void fetchMissed()
    }, [open, fetchMissed])

    const handleMarkAllAsRead = async () => {
        setIsMarkingAll(true)
        try {
            await voiceService.markAllMissedCallsSeen()
            // Cleared = seen + no longer needs callback → empty tray / zero badge
            setItems([])
            setPendingCount(0)
        } catch (error) {
            console.error("Failed to mark all missed calls seen:", error)
        } finally {
            setIsMarkingAll(false)
        }
    }

    const handleOpenCall = async (call: MissedCallItem) => {
        setOpen(false)
        if (!call.is_seen) {
            try {
                await voiceService.markMissedCallSeen(call.id)
                setItems((prev) =>
                    prev.map((c) => (c.id === call.id ? { ...c, is_seen: true } : c))
                )
                setPendingCount((prev) => Math.max(0, prev - (call.called_back ? 1 : 0)))
                // Refresh accurate count after mark
                void voiceService
                    .listMissedCalls({ page_size: 1 })
                    .then((res) => setPendingCount(res.pending_count))
                    .catch(() => {})
            } catch (error) {
                console.error("Failed to mark missed call seen:", error)
            }
        }
        router.push(`/inbox?tab=calls&callId=${call.id}`)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="relative rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={
                        pendingCount > 0
                            ? `${pendingCount} missed calls needing attention`
                            : "Missed calls"
                    }
                >
                    <Phone className="h-5 w-5" />
                    {pendingCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                            {pendingCount > 99 ? "99+" : pendingCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="font-semibold">Missed calls</h3>
                    {pendingCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto px-2 py-1 text-xs"
                            onClick={() => void handleMarkAllAsRead()}
                            disabled={isMarkingAll}
                        >
                            {isMarkingAll ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                                <CheckCheck className="mr-1 h-3 w-3" />
                            )}
                            Mark all read
                        </Button>
                    )}
                </div>

                <div className="max-h-[400px] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                            <PhoneMissed className="mx-auto mb-2 h-8 w-8 opacity-50" />
                            <p className="text-sm">No missed calls needing attention</p>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {items.map((call) => (
                                <button
                                    key={call.id}
                                    type="button"
                                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                                        !call.is_seen ? "bg-red-500/5" : ""
                                    }`}
                                    onClick={() => void handleOpenCall(call)}
                                >
                                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                                        <PhoneMissed className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className={`text-sm ${!call.is_seen ? "font-medium" : ""}`}>
                                            {call.lead_name || formatPhone(call.from_number)}
                                        </p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {call.lead_name
                                                ? formatPhone(call.from_number)
                                                : call.status.replace(/-/g, " ")}
                                            {!call.called_back && (
                                                <span className="ml-1 text-amber-600">· needs callback</span>
                                            )}
                                            {call.called_back && !call.is_seen && (
                                                <span className="ml-1 text-emerald-600">· called back</span>
                                            )}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {formatRelativeTimeInTimezone(call.started_at, timezone)}
                                        </p>
                                    </div>
                                    {!call.is_seen && (
                                        <div className="flex-shrink-0 self-center">
                                            <div className="h-2 w-2 rounded-full bg-red-600" />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="border-t p-2">
                    <Button
                        variant="ghost"
                        className="w-full text-sm"
                        onClick={() => {
                            setOpen(false)
                            router.push("/inbox?tab=calls")
                        }}
                    >
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        View all call logs
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
