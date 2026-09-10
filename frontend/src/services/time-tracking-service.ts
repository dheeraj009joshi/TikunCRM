/**
 * BDC time tracking — clock-in/out, timesheets, and payouts.
 * Clocking in is independent of CRM login.
 */
import apiClient from "@/lib/api-client"

export interface HoursBreakdown {
    regular_hours: number | string
    overtime_hours: number | string
    total_hours: number | string
    regular_pay: number | string
    overtime_pay: number | string
    estimated_pay: number | string
}

export interface TimeEntryUserBrief {
    id: string
    first_name: string
    last_name: string
    email: string
}

export interface TimeEntry {
    id: string
    user_id: string
    clock_in_at: string
    clock_out_at?: string | null
    hourly_rate?: number | string | null
    overtime_multiplier: number | string
    clock_in_note?: string | null
    notes?: string | null
    source: string
    is_open: boolean
    duration_seconds: number
    edited_at?: string | null
    edit_reason?: string | null
    user?: TimeEntryUserBrief | null
}

export interface TimeEntryListResponse {
    items: TimeEntry[]
    total: number
    page: number
    page_size: number
}

export interface ClockStatus {
    is_clocked_in: boolean
    current_entry: TimeEntry | null
    elapsed_seconds: number
    hourly_rate: number | string | null
    overtime_multiplier: number | string
    overtime_threshold_hours: number | string
    rate_missing: boolean
    long_shift_warning: boolean
    today: HoursBreakdown
    this_week: HoursBreakdown
    this_month: HoursBreakdown
}

export interface DailyPayoutRow {
    date: string
    weekday: string
    regular_hours: number | string
    overtime_hours: number | string
    total_hours: number | string
    estimated_pay: number | string
    entry_count: number
}

export interface PayoutSummary {
    period: string
    timezone: string
    period_start: string
    period_end: string
    hourly_rate: number | string | null
    overtime_multiplier: number | string
    overtime_threshold_hours: number | string
    totals: HoursBreakdown
    days: DailyPayoutRow[]
    entries: TimeEntry[]
}

export interface AgentRosterItem {
    id: string
    first_name: string
    last_name: string
    email: string
    is_active: boolean
    hourly_rate: number | string | null
    is_clocked_in: boolean
    clock_in_at?: string | null
    elapsed_seconds: number
    this_week: HoursBreakdown
    this_month: HoursBreakdown
    today: HoursBreakdown
}

export interface AgentRoster {
    items: AgentRosterItem[]
    clocked_in_count: number
    team_week: HoursBreakdown
    team_month: HoursBreakdown
}

export type PayoutPeriod = "today" | "this_week" | "last_week" | "this_month" | "last_month" | "this_year"

export const TimeTrackingService = {
    async getStatus(timezone?: string): Promise<ClockStatus> {
        const response = await apiClient.get("/time-tracking/status", {
            params: timezone ? { timezone } : undefined,
        })
        return response.data
    },

    async clockIn(note?: string): Promise<TimeEntry> {
        const response = await apiClient.post("/time-tracking/clock-in", { note: note || null })
        return response.data
    },

    async clockOut(note?: string): Promise<TimeEntry> {
        const response = await apiClient.post("/time-tracking/clock-out", { note: note || null })
        return response.data
    },

    async listEntries(params: {
        date_from?: string
        date_to?: string
        page?: number
        page_size?: number
    } = {}): Promise<TimeEntryListResponse> {
        const response = await apiClient.get("/time-tracking/entries", { params })
        return response.data
    },

    async getPayouts(period: PayoutPeriod, timezone?: string): Promise<PayoutSummary> {
        const response = await apiClient.get("/time-tracking/payouts", {
            params: { period, ...(timezone ? { timezone } : {}) },
        })
        return response.data
    },

    async getRoster(timezone?: string): Promise<AgentRoster> {
        const response = await apiClient.get("/time-tracking/admin/roster", {
            params: timezone ? { timezone } : undefined,
        })
        return response.data
    },

    async setHourlyRate(userId: string, hourlyRate: number, timezone?: string): Promise<AgentRosterItem> {
        const response = await apiClient.patch(
            `/time-tracking/admin/agents/${userId}/rate`,
            { hourly_rate: hourlyRate },
            { params: timezone ? { timezone } : undefined }
        )
        return response.data
    },

    async adminEntries(params: {
        user_id?: string
        date_from?: string
        date_to?: string
        page?: number
        page_size?: number
    } = {}): Promise<TimeEntryListResponse> {
        const response = await apiClient.get("/time-tracking/admin/entries", { params })
        return response.data
    },

    async adminPayouts(userId: string, period: PayoutPeriod, timezone?: string): Promise<PayoutSummary> {
        const response = await apiClient.get(`/time-tracking/admin/payouts/${userId}`, {
            params: { period, ...(timezone ? { timezone } : {}) },
        })
        return response.data
    },

    async editEntry(
        entryId: string,
        data: {
            clock_in_at?: string
            clock_out_at?: string
            notes?: string
            reason: string
        }
    ): Promise<TimeEntry> {
        const response = await apiClient.patch(`/time-tracking/admin/entries/${entryId}`, data)
        return response.data
    },

    async forceClockOut(entryId: string, note?: string): Promise<TimeEntry> {
        const response = await apiClient.post(`/time-tracking/admin/entries/${entryId}/force-clock-out`, {
            note: note || "Force clock-out by admin",
        })
        return response.data
    },
}
