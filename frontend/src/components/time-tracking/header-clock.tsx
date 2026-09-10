"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2, LogIn, LogOut, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTimeClock } from "@/hooks/use-time-clock"
import { useToast } from "@/hooks/use-toast"
import { formatElapsed, formatHours } from "@/lib/time-tracking"
import { getApiErrorMessage } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

/** Compact live timer in the top bar so BDC agents always see their clock status. */
export function HeaderClock() {
    const clock = useTimeClock()
    const { toast } = useToast()

    if (!clock.isBdc) return null

    const busy = clock.clockIn.isPending || clock.clockOut.isPending

    const quickIn = async () => {
        try {
            await clock.clockIn.mutateAsync(undefined)
            toast({ title: "Clocked in", description: "Your shift timer is running." })
        } catch (err) {
            toast({
                title: "Could not clock in",
                description: getApiErrorMessage(err),
                variant: "destructive",
            })
        }
    }

    const quickOut = async () => {
        try {
            await clock.clockOut.mutateAsync(undefined)
            toast({ title: "Clocked out", description: "Hours saved to your timesheet." })
        } catch (err) {
            toast({
                title: "Could not clock out",
                description: getApiErrorMessage(err),
                variant: "destructive",
            })
        }
    }

    return (
        <div className="flex items-center gap-1.5">
            <Link
                href="/time-tracking"
                className={cn(
                    "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex",
                    clock.isClockedIn
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border bg-muted/60 text-muted-foreground"
                )}
                title="Open timesheet — clocked time vs time on calls"
            >
                <span
                    className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        clock.onCall
                            ? "animate-pulse bg-sky-500"
                            : clock.isClockedIn
                              ? "animate-pulse bg-emerald-500"
                              : "bg-muted-foreground/50"
                    )}
                />
                {clock.isLoading ? (
                    "Time clock"
                ) : clock.isClockedIn ? (
                    <span className="flex items-center gap-1.5 font-mono tabular-nums">
                        {formatElapsed(clock.elapsedSeconds)}
                        {clock.onCall ? (
                            <span className="inline-flex items-center gap-0.5 font-sans text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                                <Phone className="h-3 w-3" />
                                {formatElapsed(clock.currentCallSeconds)}
                            </span>
                        ) : (
                            <span className="hidden font-sans font-medium text-muted-foreground lg:inline">
                                {formatHours(clock.todayCalls.talk_hours)} calls
                            </span>
                        )}
                    </span>
                ) : (
                    "Off the clock"
                )}
            </Link>
            {clock.isClockedIn ? (
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-rose-300 text-rose-700 hover:bg-rose-50 dark:text-rose-300"
                    disabled={busy}
                    onClick={quickOut}
                    aria-label="Clock out"
                >
                    {clock.clockOut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                    <span className="hidden md:inline">Out</span>
                </Button>
            ) : (
                <Button
                    variant="success"
                    size="sm"
                    className="h-8"
                    disabled={busy || clock.isLoading}
                    onClick={quickIn}
                    aria-label="Clock in"
                >
                    {clock.clockIn.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                    <span className="hidden md:inline">In</span>
                </Button>
            )}
        </div>
    )
}
