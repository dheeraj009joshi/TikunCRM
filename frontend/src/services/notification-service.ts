import apiClient from "@/lib/api-client";

// Types
export type NotificationType =
    | "email_received"
    | "lead_assigned"
    | "lead_updated"
    | "follow_up_due"
    | "follow_up_overdue"
    | "system"
    | "mention";

export interface Notification {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    message: string | null;
    link: string | null;
    related_id: string | null;
    related_type: string | null;
    is_read: boolean;
    read_at: string | null;
    created_at: string;
}

export interface NotificationListResponse {
    items: Notification[];
    total: number;
    unread_count: number;
}

export interface NotificationStats {
    total: number;
    unread: number;
    by_type: Record<string, number>;
}

export interface NotificationListParams {
    page?: number;
    page_size?: number;
    unread_only?: boolean;
    notification_type?: NotificationType;
}

// Notification type display info
export const NOTIFICATION_TYPE_INFO: Record<NotificationType, { label: string; color: string; icon: string }> = {
    email_received: { label: "Email", color: "blue", icon: "mail" },
    lead_assigned: { label: "Lead Assigned", color: "green", icon: "user-plus" },
    lead_updated: { label: "Lead Updated", color: "yellow", icon: "refresh-cw" },
    follow_up_due: { label: "Follow-up Due", color: "orange", icon: "clock" },
    follow_up_overdue: { label: "Overdue", color: "red", icon: "alert-circle" },
    system: { label: "System", color: "gray", icon: "info" },
    mention: { label: "Mention", color: "purple", icon: "at-sign" },
};

// Service methods
export const NotificationService = {
    /**
     * Get list of notifications with pagination
     */
    async listNotifications(params: NotificationListParams = {}): Promise<NotificationListResponse> {
        const response = await apiClient.get<NotificationListResponse>("/notifications/", { params });
        return response.data;
    },

    /**
     * Get notification statistics
     */
    async getStats(): Promise<NotificationStats> {
        const response = await apiClient.get<NotificationStats>("/notifications/stats");
        return response.data;
    },

    /**
     * Get a specific notification
     */
    async getNotification(id: string): Promise<Notification> {
        const response = await apiClient.get<Notification>(`/notifications/${id}`);
        return response.data;
    },

    /**
     * Mark a notification as read
     */
    async markAsRead(id: string): Promise<Notification> {
        const response = await apiClient.patch<Notification>(`/notifications/${id}/read`);
        return response.data;
    },

    /**
     * Mark multiple notifications as read
     */
    async markMultipleAsRead(ids: string[]): Promise<{ marked_count: number }> {
        const response = await apiClient.post<{ marked_count: number }>("/notifications/mark-read", {
            notification_ids: ids,
        });
        return response.data;
    },

    /**
     * Mark all notifications as read
     */
    async markAllAsRead(): Promise<{ marked_count: number }> {
        const response = await apiClient.post<{ marked_count: number }>("/notifications/mark-all-read");
        return response.data;
    },

    /**
     * Delete a notification
     */
    async deleteNotification(id: string): Promise<void> {
        await apiClient.delete(`/notifications/${id}`);
    },
};
