/**
 * Appointment Service - API calls for appointment management
 */
import apiClient from "@/lib/api-client"

export type AppointmentType = "phone_call" | "email" | "in_person" | "video_call" | "other"
export type AppointmentStatus = "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show" | "rescheduled"

export interface UserBrief {
    id: string
    first_name: string
    last_name: string
    email: string
}

export interface LeadBrief {
    id: string
    first_name: string
    last_name?: string
    email?: string
    phone?: string
}

export interface DealershipBrief {
    id: string
    name: string
}

export interface Appointment {
    id: string
    title: string
    description?: string
    appointment_type: AppointmentType
    scheduled_at: string
    duration_minutes: number
    location?: string
    meeting_link?: string
    lead_id?: string
    dealership_id?: string
    scheduled_by?: string
    assigned_to?: string
    status: AppointmentStatus
    reminder_sent: boolean
    outcome_notes?: string
    completed_at?: string
    created_at: string
    updated_at: string
    lead?: LeadBrief
    dealership?: DealershipBrief
    scheduled_by_user?: UserBrief
    assigned_to_user?: UserBrief
}

export interface AppointmentCreate {
    title: string
    description?: string
    appointment_type: AppointmentType
    scheduled_at: string
    duration_minutes: number
    location?: string
    meeting_link?: string
    lead_id?: string
    assigned_to?: string
}

export interface AppointmentUpdate {
    title?: string
    description?: string
    appointment_type?: AppointmentType
    scheduled_at?: string
    duration_minutes?: number
    location?: string
    meeting_link?: string
    status?: AppointmentStatus
    assigned_to?: string
}

export interface AppointmentComplete {
    outcome_notes?: string
    status?: AppointmentStatus
}

export interface AppointmentListResponse {
    items: Appointment[]
    total: number
    page: number
    page_size: number
    total_pages: number
}

export interface AppointmentStats {
    today: number
    upcoming: number
    overdue: number
    completed_this_week: number
    cancelled_this_week: number
    total_scheduled: number
}

export interface AppointmentListParams {
    page?: number
    page_size?: number
    status?: AppointmentStatus
    appointment_type?: AppointmentType
    lead_id?: string
    assigned_to?: string
    date_from?: string
    date_to?: string
    today_only?: boolean
    upcoming_only?: boolean
    overdue_only?: boolean
}

export const AppointmentService = {
    /**
     * List appointments with filters
     */
    async list(params: AppointmentListParams = {}): Promise<AppointmentListResponse> {
        const searchParams = new URLSearchParams()
        
        if (params.page) searchParams.append("page", params.page.toString())
        if (params.page_size) searchParams.append("page_size", params.page_size.toString())
        if (params.status) searchParams.append("status", params.status)
        if (params.appointment_type) searchParams.append("appointment_type", params.appointment_type)
        if (params.lead_id) searchParams.append("lead_id", params.lead_id)
        if (params.assigned_to) searchParams.append("assigned_to", params.assigned_to)
        if (params.date_from) searchParams.append("date_from", params.date_from)
        if (params.date_to) searchParams.append("date_to", params.date_to)
        if (params.today_only) searchParams.append("today_only", "true")
        if (params.upcoming_only) searchParams.append("upcoming_only", "true")
        if (params.overdue_only) searchParams.append("overdue_only", "true")
        
        const queryString = searchParams.toString()
        const url = queryString ? `/appointments?${queryString}` : "/appointments"
        
        const response = await apiClient.get(url)
        return response.data
    },
    
    /**
     * Get appointment statistics
     */
    async getStats(): Promise<AppointmentStats> {
        const response = await apiClient.get("/appointments/stats")
        return response.data
    },
    
    /**
     * Get a single appointment
     */
    async get(id: string): Promise<Appointment> {
        const response = await apiClient.get(`/appointments/${id}`)
        return response.data
    },
    
    /**
     * Create a new appointment
     */
    async create(data: AppointmentCreate): Promise<Appointment> {
        const response = await apiClient.post("/appointments", data)
        return response.data
    },
    
    /**
     * Update an appointment
     */
    async update(id: string, data: AppointmentUpdate): Promise<Appointment> {
        const response = await apiClient.put(`/appointments/${id}`, data)
        return response.data
    },
    
    /**
     * Complete an appointment
     */
    async complete(id: string, data: AppointmentComplete = {}): Promise<Appointment> {
        const response = await apiClient.post(`/appointments/${id}/complete`, {
            outcome_notes: data.outcome_notes,
            status: data.status || "completed"
        })
        return response.data
    },
    
    /**
     * Cancel/delete an appointment
     */
    async delete(id: string): Promise<void> {
        await apiClient.delete(`/appointments/${id}`)
    }
}

// Helper functions
export function getAppointmentTypeLabel(type: AppointmentType): string {
    const labels: Record<AppointmentType, string> = {
        phone_call: "Phone Call",
        email: "Email",
        in_person: "In Person",
        video_call: "Video Call",
        other: "Other"
    }
    return labels[type] || type
}

export function getAppointmentStatusLabel(status: AppointmentStatus): string {
    const labels: Record<AppointmentStatus, string> = {
        scheduled: "Scheduled",
        confirmed: "Confirmed",
        in_progress: "In Progress",
        completed: "Completed",
        cancelled: "Cancelled",
        no_show: "No Show",
        rescheduled: "Rescheduled"
    }
    return labels[status] || status
}

export function getAppointmentStatusColor(status: AppointmentStatus): string {
    const colors: Record<AppointmentStatus, string> = {
        scheduled: "bg-blue-100 text-blue-800",
        confirmed: "bg-green-100 text-green-800",
        in_progress: "bg-yellow-100 text-yellow-800",
        completed: "bg-emerald-100 text-emerald-800",
        cancelled: "bg-gray-100 text-gray-800",
        no_show: "bg-red-100 text-red-800",
        rescheduled: "bg-purple-100 text-purple-800"
    }
    return colors[status] || "bg-gray-100 text-gray-800"
}

export function getAppointmentTypeIcon(type: AppointmentType): string {
    const icons: Record<AppointmentType, string> = {
        phone_call: "phone",
        email: "mail",
        in_person: "map-pin",
        video_call: "video",
        other: "calendar"
    }
    return icons[type] || "calendar"
}
