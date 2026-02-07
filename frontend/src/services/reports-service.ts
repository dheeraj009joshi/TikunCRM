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
};
