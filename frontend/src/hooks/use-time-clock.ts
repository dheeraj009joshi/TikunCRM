"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useRole } from "@/hooks/use-role"
import { ClockStatus, TimeTrackingService } from "@/services/time-tracking-service"
import { getApiErrorMessage } from "@/lib/api-errors"
import { emptyBreakdown, emptyCallWork } from "@/lib/time-tracking"

const STATUS_KEY = ["time-clock", "status"] as const

function elapsedFromStatus(status: ClockStatus | undefined, nowMs: number): number {
    if (!status?.is_clocked_in || !status.current_entry?.clock_in_at) {
        return status?.elapsed_seconds ?? 0
    }
    const start = new Date(status.current_entry.clock_in_at).getTime()
    return Math.max(0, Math.floor((nowMs - start) / 1000))
}

export function useTimeClock() {
    const { isBdc } = useRole()
    const { timezone } = useBrowserTimezone()
    const queryClient = useQueryClient()
    const [nowMs, setNowMs] = React.useState(() => Date.now())

    const query = useQuery({
        queryKey: [...STATUS_KEY, timezone],
        queryFn: () => TimeTrackingService.getStatus(timezone),
        enabled: isBdc,
        refetchInterval: 30_000,
        staleTime: 10_000,
    })

    React.useEffect(() => {
        if (!query.data?.is_clocked_in && !query.data?.on_call) return
        const id = window.setInterval(() => setNowMs(Date.now()), 1000)
        return () => window.clearInterval(id)
    }, [query.data?.is_clocked_in, query.data?.on_call])

    const clockIn = useMutation({
        mutationFn: (note?: string) => TimeTrackingService.clockIn(note),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
    })

    const clockOut = useMutation({
        mutationFn: (note?: string) => TimeTrackingService.clockOut(note),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
    })

    const status = query.data
    const elapsedSeconds = elapsedFromStatus(status, nowMs)
    const currentCallSeconds = status?.on_call
        ? (status.current_call_seconds ?? 0) + Math.max(0, Math.floor((nowMs - query.dataUpdatedAt) / 1000))
        : 0

    return {
        isBdc,
        timezone,
        isLoading: query.isLoading,
        isError: query.isError,
        errorMessage: query.error ? getApiErrorMessage(query.error, "Could not load time clock") : null,
        status,
        isClockedIn: Boolean(status?.is_clocked_in),
        elapsedSeconds,
        hourlyRate: status?.hourly_rate ?? null,
        rateMissing: Boolean(status?.rate_missing),
        longShiftWarning: Boolean(status?.long_shift_warning),
        overCapWarning: Boolean(status?.over_cap_warning),
        today: status?.today ?? emptyBreakdown(),
        thisWeek: status?.this_week ?? emptyBreakdown(),
        thisMonth: status?.this_month ?? emptyBreakdown(),
        todayCalls: status?.today_calls ?? emptyCallWork(),
        thisWeekCalls: status?.this_week_calls ?? emptyCallWork(),
        onCall: Boolean(status?.on_call),
        currentCallSeconds,
        clockIn,
        clockOut,
        refetch: query.refetch,
    }
}
