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
};
