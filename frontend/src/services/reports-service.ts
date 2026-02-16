import apiClient from "@/lib/api-client";

export interface PendingFollowUp {
    id: string;
    lead_id: string;
    lead_name: string;
    scheduled_at: string;
    notes?: string;
    is_overdue: boolean;
}

export interface PendingAppointment {
    id: string;
    lead_id: string;
    lead_name: string;
    title?: string;
    scheduled_at: string;
    location?: string;
    is_overdue: boolean;
}

export interface SalespersonPendingTasks {
    user_id: string;
    user_name: string;
    overdue_followups: PendingFollowUp[];
    upcoming_followups: PendingFollowUp[];
    overdue_appointments: PendingAppointment[];
    upcoming_appointments: PendingAppointment[];
    total_overdue: number;
    total_upcoming: number;
}

export interface AdminNotificationRequest {
    custom_message?: string;
    include_pending_tasks?: boolean;
}

export interface AdminNotificationResponse {
    success: boolean;
    message: string;
    notification_id?: string;
}

export interface UserCommunicationStats {
    user_id: string;
    user_name: string;
    total_calls: number;
    inbound_calls: number;
    outbound_calls: number;
    total_call_duration: number;
    missed_calls: number;
    total_sms_sent: number;
    total_sms_received: number;
    avg_response_time_minutes?: number;
}

export interface CommunicationOverviewResponse {
    period_start: string;
    period_end: string;
    dealership_id?: string;
    total_calls: number;
    total_sms: number;
    total_emails: number;
    user_stats: UserCommunicationStats[];
}

export interface TeamActivityItem {
    id: string;
    type: string;
    user_id?: string;
    user_name?: string;
    lead_id?: string;
    lead_name?: string;
    direction: string;
    summary: string;
    timestamp: string;
}

export interface TeamActivityResponse {
    items: TeamActivityItem[];
    total: number;
    page: number;
    page_size: number;
}

export interface DealershipSummary {
    total_leads: number;
    total_notes: number;
    total_appointments: number;
    total_follow_ups: number;
    active_leads: number;
    converted_leads: number;
    total_follow_ups_scheduled_in_period: number;
    total_follow_ups_completed_in_period: number;
    total_appointments_scheduled_in_period: number;
    total_appointments_confirmed_in_period: number;
    notes_friday: number;
    outbound_calls_friday: number;
    appointments_contacted_saturday: number;
    total_check_ins_in_period: number;
}

export interface SalespersonAnalysisRow {
    user_id: string;
    user_name: string;
    leads_assigned: number;
    notes_added: number;
    follow_ups_total: number;
    follow_ups_pending: number;
    follow_ups_overdue: number;
    appointments_total: number;
    appointments_scheduled: number;
    appointments_confirmed: number;
    last_note_content?: string | null;
    follow_ups_scheduled_in_period: number;
    follow_ups_completed_in_period: number;
    appointments_scheduled_in_period: number;
    appointments_confirmed_in_period: number;
    notes_friday: number;
    outbound_calls_friday: number;
    appointments_contacted_saturday: number;
    check_ins_in_period: number;
}

export interface CheckInRow {
    visit_id: string;
    lead_id: string;
    lead_name: string;
    assigned_to_id: string | null;
    assigned_to_name: string | null;
    checked_in_at: string;
    checked_in_by_name: string | null;
    outcome: string | null;
}

export interface DealershipAnalysisResponse {
    summary: DealershipSummary;
    salespeople: SalespersonAnalysisRow[];
    check_ins: CheckInRow[];
}

/** Shared filters for all analytics endpoints */
export interface AnalyticsFilters {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
    assigned_to?: string;
    source?: string;
    stage_id?: string;
}

export interface LeadsOverTimeItem {
    date: string;
    leads_created: number;
    leads_converted: number;
}

export interface LeadsOverTimeResponse {
    series: LeadsOverTimeItem[];
}

export interface LeadsByStageItem {
    stage_id: string;
    stage_name: string;
    count: number;
}

export interface LeadsByStageResponse {
    items: LeadsByStageItem[];
}

export interface LeadsBySourceItem {
    source: string;
    count: number;
}

export interface LeadsBySourceResponse {
    items: LeadsBySourceItem[];
}

export interface ActivitiesOverTimeItem {
    date: string;
    activities: number;
    notes: number;
}

export interface ActivitiesOverTimeResponse {
    series: ActivitiesOverTimeItem[];
}

export const ReportsService = {
    /**
     * Get pending tasks for a salesperson
     */
    async getSalespersonPendingTasks(userId: string): Promise<SalespersonPendingTasks> {
        const response = await apiClient.get(`/reports/salesperson/${userId}/pending-tasks`);
        return response.data;
    },

    /**
     * Send notification from admin to salesperson
     */
    async notifySalesperson(
        userId: string,
        data: AdminNotificationRequest
    ): Promise<AdminNotificationResponse> {
        const response = await apiClient.post(`/reports/notify-salesperson/${userId}`, data);
        return response.data;
    },

    /**
     * Get communication overview for admin monitoring
     */
    async getCommunicationOverview(days: number = 7): Promise<CommunicationOverviewResponse> {
        const response = await apiClient.get("/reports/communications/overview", {
            params: { days }
        });
        return response.data;
    },

    /**
     * Get team activity feed for admin monitoring
     */
    async getTeamActivity(params?: {
        page?: number;
        page_size?: number;
        user_id?: string;
        type?: string;
    }): Promise<TeamActivityResponse> {
        const response = await apiClient.get("/reports/communications/activity", { params });
        return response.data;
    },

    /**
     * Get full dealership analysis: summary totals and per-salesperson metrics
     */
    async getDealershipAnalysis(params?: AnalyticsFilters): Promise<DealershipAnalysisResponse> {
        const response = await apiClient.get("/reports/analysis", { params });
        return response.data;
    },

    async getLeadsOverTime(filters?: AnalyticsFilters, group_by: "day" | "week" = "day"): Promise<LeadsOverTimeResponse> {
        const response = await apiClient.get("/reports/analytics/leads-over-time", {
            params: { ...filters, group_by }
        });
        return response.data;
    },

    async getLeadsByStage(filters?: AnalyticsFilters): Promise<LeadsByStageResponse> {
        const response = await apiClient.get("/reports/analytics/leads-by-stage", { params: filters });
        return response.data;
    },

    async getLeadsBySource(filters?: AnalyticsFilters): Promise<LeadsBySourceResponse> {
        const response = await apiClient.get("/reports/analytics/leads-by-source", { params: filters });
        return response.data;
    },

    async getActivitiesOverTime(filters?: AnalyticsFilters): Promise<ActivitiesOverTimeResponse> {
        const response = await apiClient.get("/reports/analytics/activities-over-time", { params: filters });
        return response.data;
    },
};
