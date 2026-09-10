"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Clock, Loader2, LogIn, LogOut, Phone, Timer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useTimeClock } from "@/hooks/use-time-clock"
import { useToast } from "@/hooks/use-toast"
import { formatDateInLocal } from "@/utils/timezone"
import { formatElapsed, formatHours, formatMoney, num } from "@/lib/time-tracking"
import { getApiErrorMessage } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

export function ClockWidget({ compact = false }: { compact?: boolean }) {
    const clock = useTimeClock()
    const { toast } = useToast()
    const [note, setNote] = React.useState("")
    const [confirmOut, setConfirmOut] = React.useState(false)

    if (!clock.isBdc) return null

    const handleClockIn = async () => {
        try {
            await clock.clockIn.mutateAsync(note.trim() || undefined)
            setNote("")
            toast({ title: "You're on the clock", description: "Your shift has started. The timer will keep running until you clock out." })
        } catch (err) {
            toast({
                title: "Could not clock in",
                description: getApiErrorMessage(err, "Try again in a moment."),
                variant: "destructive",
            })
        }
    }

    const handleClockOut = async () => {
        try {
            await clock.clockOut.mutateAsync(note.trim() || undefined)
            setNote("")
            setConfirmOut(false)
            toast({ title: "Clocked out", description: "Your hours were saved to your timesheet." })
        } catch (err) {
            toast({
                title: "Could not clock out",
                description: getApiErrorMessage(err, "Try again in a moment."),
                variant: "destructive",
            })
        }
    }

    const startedAt = clock.status?.current_entry?.clock_in_at
    const busy = clock.clockIn.isPending || clock.clockOut.isPending

    return (
        <>
            <Card
                className={cn(
                    "overflow-hidden border-2",
                    clock.isClockedIn
                        ? "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30"
                        : "border-border bg-card"
                )}
            >
                <CardContent className={cn("p-5 sm:p-6", compact && "p-4")}>
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                                        clock.isClockedIn
                                            ? "bg-emerald-600 text-white"
                                            : "bg-muted text-muted-foreground"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "h-2 w-2 rounded-full",
                                            clock.isClockedIn ? "animate-pulse bg-white" : "bg-muted-foreground/50"
                                        )}
                                    />
                                    {clock.isClockedIn ? "On the clock" : "Off the clock"}
                                </span>
                                {clock.onCall && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white">
                                        <Phone className="h-3 w-3" />
                                        On a call {formatElapsed(clock.currentCallSeconds)}
                                    </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                    Separate from CRM login — clock in when you start working
                                </span>
                            </div>

                            {clock.isLoading ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    <span>Loading time clock…</span>
                                </div>
                            ) : clock.isClockedIn ? (
                                <div>
                                    <p className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                                        {formatElapsed(clock.elapsedSeconds)}
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Started {startedAt ? formatDateInLocal(startedAt) : "this session"}
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-xl font-semibold tracking-tight sm:text-2xl">Ready to start your shift?</p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Clock in when you begin work. Clock out when you stop — even if you stay logged into the CRM.
                                    </p>
                                </div>
                            )}

                            {clock.overCapWarning && (
                                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    Hours over your daily or weekly cap are unpaid until a manager approves them.
                                    {num(clock.today.unpaid_hours) > 0
                                        ? ` Unpaid today: ${formatHours(clock.today.unpaid_hours)}.`
                                        : ""}
                                </p>
                            )}
                            {clock.longShiftWarning && (
                                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    You&apos;ve been clocked in for over 12 hours. Clock out if you forgot to end a previous shift.
                                </p>
                            )}
                            {clock.rateMissing && (
                                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    No hourly rate is set yet. You can still track hours — a manager needs to set your rate for payouts.
                                </p>
                            )}
                        </div>

                        <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[260px]">
                            {clock.isClockedIn ? (
                                <Button
                                    variant="destructive"
                                    size="xl"
                                    className="h-12 w-full text-base"
                                    disabled={busy}
                                    onClick={() => setConfirmOut(true)}
                                >
                                    {clock.clockOut.isPending ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <LogOut className="h-5 w-5" />
                                    )}
                                    Clock out
                                </Button>
                            ) : (
                                <Button
                                    variant="success"
                                    size="xl"
                                    className="h-12 w-full text-base"
                                    disabled={busy || clock.isLoading}
                                    onClick={handleClockIn}
                                >
                                    {clock.clockIn.isPending ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <LogIn className="h-5 w-5" />
                                    )}
                                    Clock in
                                </Button>
                            )}
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/time-tracking">
                                    <Timer className="h-4 w-4" />
                                    View timesheet &amp; payouts
                                </Link>
                            </Button>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label="Clocked today" value={formatHours(clock.today.total_hours)} />
                        <Stat label="On calls today" value={formatHours(clock.todayCalls.talk_hours)} />
                        <Stat label="Clocked this week" value={formatHours(clock.thisWeek.total_hours)} />
                        <Stat
                            label="On calls this week"
                            value={`${formatHours(clock.thisWeekCalls.talk_hours)}${
                                clock.thisWeekCalls.call_count
                                    ? ` · ${clock.thisWeekCalls.call_count} calls`
                                    : ""
                            }`}
                        />
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={confirmOut} onOpenChange={setConfirmOut}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Clock out of this shift?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Session length {formatElapsed(clock.elapsedSeconds)}
                            {num(clock.hourlyRate) > 0
                                ? ` · rate ${formatMoney(clock.hourlyRate)}/hr`
                                : ""}.
                            You can add an optional note for this punch.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="clock-out-note">Note (optional)</Label>
                        <Textarea
                            id="clock-out-note"
                            placeholder="e.g. End of shift, lunch break…"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Stay clocked in</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClockOut} disabled={busy}>
                            {clock.clockOut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Clock out
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border bg-background/70 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
        </div>
    )
}
