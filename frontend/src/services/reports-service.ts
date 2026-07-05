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
    bdc_agent_id?: string;
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

// Daily Activity Tracking Types
export interface DailyActivityItem {
    id: string;
    type: string;
    user_id?: string;
    user_name?: string;
    lead_id?: string;
    lead_name?: string;
    description: string;
    meta_data?: Record<string, unknown>;
    created_at: string;
    is_reply?: boolean;
    parent_id?: string;
}

export interface SalespersonDailySummary {
    user_id: string;
    user_name: string;
    user_email: string;
    notes_count: number;
    calls_count: number;
    call_duration_total: number;
    follow_ups_completed: number;
    follow_ups_scheduled: number;
    appointments_completed: number;
    appointments_scheduled: number;
    emails_sent: number;
    leads_worked: number;
    customers_contacted: number;
    activities: DailyActivityItem[];
}

export interface DailyActivityResponse {
    date_from: string;
    date_to: string;
    dealership_id?: string;
    total_activities: number;
    total_notes: number;
    total_calls: number;
    total_follow_ups_completed: number;
    total_appointments: number;
    salespersons: SalespersonDailySummary[];
}

export interface DailyActivityFilters {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
    user_id?: string;
    activity_types?: string;
}

// Sold Cars Report Types
export interface SoldCarItem {
    lead_id: string;
    lead_name: string;
    phone?: string;
    email?: string;
    sold_date: string;
    salesperson_id?: string;
    salesperson_name?: string;
    source?: string;
    campaign_display?: string;
    notes_count: number;
    follow_ups_count: number;
    appointments_count: number;
    total_activities: number;
}

export interface SoldCarsResponse {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
    total_sold: number;
    items: SoldCarItem[];
}

export interface SoldCarsFilters {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
    assigned_to?: string;
    bdc_agent_id?: string;
}

/** Team touch & close report (salespeople only; excludes current user on server) */
export interface TeamTouchSalespersonRow {
    user_id: string;
    user_name: string;
    leads_touched: number;
    sold_count: number;
    closing_percentage: number;
}

export interface TeamTouchSalesMetricsResponse {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
    salespeople_count: number;
    unique_leads_touched: number;
    avg_leads_touched_per_salesperson: number;
    sold_among_touched: number;
    closing_percentage: number;
    salespeople: TeamTouchSalespersonRow[];
}

export interface TeamTouchSalesMetricsFilters {
    date_from?: string;
    date_to?: string;
    dealership_id?: string;
}

/** BDC flexible export report filters */
export interface BdcExportFilters {
    dealership_id?: string;
    all_dealerships?: boolean;
    bdc_agent_id?: string;
    assigned_to?: string;
    stage_id?: string;
    source?: string;
    is_active?: boolean;
    search?: string;
    lead_date_from?: string;
    lead_date_to?: string;
    sold_date_from?: string;
    sold_date_to?: string;
    appointment_date_from?: string;
    appointment_date_to?: string;
    appointment_statuses?: string;
    appointment_funnel?: string;
    has_appointment?: boolean;
    sold_only?: boolean;
    converted_only?: boolean;
}

export interface BdcExportRow {
    lead_id: string;
    full_name: string;
    email: string;
    phone: string;
    stage: string;
    source: string;
    lead_created: string;
    dealership: string;
    bdc_agent: string;
    salesperson: string;
    is_active: boolean;
    converted_at: string;
    latest_appt_status: string;
    latest_appt_date: string;
    appt_count: number;
    showroom_check_in: string;
    lead_trust_score?: number | null;
    guest_trust_score?: number | null;
    guest_qr_url: string;
    guest_auto_generated: boolean;
}

export interface BdcExportPreviewResponse {
    total: number;
    items: BdcExportRow[];
    auto_generated_count: number;
    missing_guest_count: number;
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

    /**
     * Get detailed daily activities grouped by salesperson.
     * For admin oversight of daily salesperson work.
     */
    async getDailyActivities(filters?: DailyActivityFilters): Promise<DailyActivityResponse> {
        const response = await apiClient.get("/reports/daily-activities", { params: filters });
        return response.data;
    },

    /**
     * Get sold cars (converted leads) report with activity counts.
     * Returns leads that have been marked as converted/sold.
     */
    async getSoldCars(filters?: SoldCarsFilters): Promise<SoldCarsResponse> {
        const response = await apiClient.get("/reports/sold-cars", { params: filters });
        return response.data;
    },

    /**
     * Leads "touched" = distinct leads with a note_added or call_logged activity by a salesperson
     * (excludes current user) in the period. Sold/close uses Sold Cars date rules.
     */
    async getTeamTouchSalesMetrics(
        filters?: TeamTouchSalesMetricsFilters
    ): Promise<TeamTouchSalesMetricsResponse> {
        const response = await apiClient.get("/reports/team-touch-sales-metrics", {
            params: filters,
        });
        return response.data;
    },

    async previewBdcExport(filters?: BdcExportFilters, limit = 100): Promise<BdcExportPreviewResponse> {
        const response = await apiClient.get("/reports/bdc/preview", {
            params: { ...filters, limit },
        });
        return response.data;
    },

    async downloadBdcExport(
        filters?: BdcExportFilters,
        format: "zip" | "xlsx" | "pdf" = "zip"
    ): Promise<{ blob: Blob; filename: string }> {
        const response = await apiClient.get("/reports/bdc/export", {
            params: { ...filters, format },
            responseType: "blob",
        });
        const disposition = response.headers["content-disposition"] as string | undefined;
        let filename = `bdc-report.${format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "zip"}`;
        if (disposition) {
            const quoted = disposition.match(/filename="([^"]+)"/);
            const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (quoted?.[1]) {
                filename = quoted[1];
            } else if (encoded?.[1]) {
                filename = decodeURIComponent(encoded[1]);
            }
        }
        return { blob: response.data, filename };
    },
};
