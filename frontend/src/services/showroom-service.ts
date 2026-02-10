/**
 * Showroom Service - Check-in/Check-out tracking
 */
import apiClient from "@/lib/api-client"

export type ShowroomOutcome = "sold" | "not_interested" | "follow_up" | "reschedule" | "browsing" | "couldnt_qualify"

export interface LeadBrief {
    id: string
    customer?: {
        first_name: string
        last_name?: string
        full_name?: string
        phone?: string
        email?: string
    }
}

export interface UserBrief {
    id: string
    first_name: string
    last_name: string
}

export interface ShowroomVisit {
    id: string
    lead_id: string
    appointment_id?: string
    dealership_id: string
    checked_in_at: string
    checked_out_at?: string
    checked_in_by: string
    checked_out_by?: string
    outcome?: ShowroomOutcome
    notes?: string
    is_checked_in: boolean
    lead?: LeadBrief
    checked_in_by_user?: UserBrief
    checked_out_by_user?: UserBrief
    created_at: string
    updated_at: string
}

export interface ShowroomCurrentResponse {
    count: number
    visits: ShowroomVisit[]
}

export interface ShowroomHistoryResponse {
    items: ShowroomVisit[]
    total: number
    page: number
    page_size: number
}

export interface ShowroomStats {
    currently_in_showroom: number
    checked_in_today: number
    sold_today: number
    avg_visit_duration_minutes?: number
}

export interface CheckInData {
    lead_id: string
    appointment_id?: string
    notes?: string
}

export interface CheckOutData {
    outcome: ShowroomOutcome
    notes?: string
    /** When outcome is reschedule and visit has appointment_id, new date/time for the appointment (ISO string) */
    reschedule_scheduled_at?: string
}

export const ShowroomService = {
    /**
     * Check in a customer to the showroom
     */
    async checkIn(data: CheckInData): Promise<ShowroomVisit> {
        const response = await apiClient.post<ShowroomVisit>("/showroom/check-in", data)
        return response.data
    },

    /**
     * Check out a customer from the showroom
     */
    async checkOut(visitId: string, data: CheckOutData): Promise<ShowroomVisit> {
        const response = await apiClient.post<ShowroomVisit>(`/showroom/${visitId}/check-out`, data)
        return response.data
    },

    /**
     * Get customers currently in the showroom
     */
    async getCurrent(): Promise<ShowroomCurrentResponse> {
        const response = await apiClient.get<ShowroomCurrentResponse>("/showroom/current")
        return response.data
    },

    /**
     * Get showroom visit history
     */
    async getHistory(params?: {
        page?: number
        page_size?: number
        date_from?: string
        date_to?: string
        outcome?: ShowroomOutcome
    }): Promise<ShowroomHistoryResponse> {
        const response = await apiClient.get<ShowroomHistoryResponse>("/showroom/history", { params })
        return response.data
    },

    /**
     * Get showroom statistics for dashboard
     */
    async getStats(): Promise<ShowroomStats> {
        const response = await apiClient.get<ShowroomStats>("/showroom/stats")
        return response.data
    },
}

/**
 * Get display label for outcome
 */
export function getOutcomeLabel(outcome: ShowroomOutcome): string {
    const labels: Record<ShowroomOutcome, string> = {
        sold: "Sold",
        not_interested: "Not Interested",
        follow_up: "Follow Up",
        reschedule: "Reschedule",
        browsing: "Just Browsing",
        couldnt_qualify: "Couldn't Qualify",
    }
    return labels[outcome] || outcome
}

/**
 * Get color classes for outcome badge
 */
export function getOutcomeColor(outcome: ShowroomOutcome): string {
    const colors: Record<ShowroomOutcome, string> = {
        sold: "bg-emerald-100 text-emerald-800",
        not_interested: "bg-gray-100 text-gray-800",
        follow_up: "bg-blue-100 text-blue-800",
        reschedule: "bg-purple-100 text-purple-800",
        browsing: "bg-yellow-100 text-yellow-800",
        couldnt_qualify: "bg-amber-100 text-amber-800",
    }
    return colors[outcome] || "bg-gray-100 text-gray-800"
}
