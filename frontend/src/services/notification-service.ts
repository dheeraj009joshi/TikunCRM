import apiClient from "@/lib/api-client";

// Types
export type NotificationType =
    | "email_received"
    | "lead_assigned"
    | "lead_updated"
    | "follow_up_due"
    | "follow_up_overdue"
    | "system"
    | "mention"
    | "appointment_reminder"
    | "appointment_missed"
    | "new_lead"
    | "admin_reminder"
    | "skate_alert"
    | "lead_multi_campaign";

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

// Notification type display info (keys lowercase; API may return uppercase e.g. MENTION)
export const NOTIFICATION_TYPE_INFO: Record<string, { label: string; color: string; icon: string }> = {
    email_received: { label: "Email", color: "blue", icon: "mail" },
    lead_assigned: { label: "Lead Assigned", color: "green", icon: "user-plus" },
    lead_updated: { label: "Lead Updated", color: "yellow", icon: "refresh-cw" },
    follow_up_due: { label: "Follow-up Due", color: "orange", icon: "clock" },
    follow_up_overdue: { label: "Overdue", color: "red", icon: "alert-circle" },
    system: { label: "System", color: "gray", icon: "info" },
    mention: { label: "Mention", color: "purple", icon: "at-sign" },
    appointment_reminder: { label: "Appointment Reminder", color: "blue", icon: "calendar" },
    appointment_missed: { label: "Missed Appointment", color: "red", icon: "alert-circle" },
    new_lead: { label: "New Lead", color: "emerald", icon: "user-plus" },
    admin_reminder: { label: "Admin Reminder", color: "indigo", icon: "bell" },
    skate_alert: { label: "SKATE Alert", color: "amber", icon: "alert-triangle" },
    lead_multi_campaign: { label: "Duplicate lead", color: "yellow", icon: "layers" },
};

/** Normalize API notification type (may be uppercase) for display lookup */
export function normalizeNotificationType(type: string | null | undefined): string {
    return (type || "").toLowerCase();
}

/** Legacy DB/API body for duplicate-lead (multi-campaign) notifications */
const LEGACY_DUPLICATE_BODY = /^([\s\S]+?)\s+also appeared in campaign:\s*([\s\S]+)$/i;

function duplicateLeadMessage(campaign: string): string {
    return `A new lead came in from "${campaign}", but this contact is already in your CRM (duplicate). Open the lead to see campaign history before contacting them again.`;
}

/**
 * Rewrite old duplicate-lead copy to current wording (matches backend notification_display).
 * Safe to call for every render — already-new rows pass through unchanged.
 */
export function normalizeDuplicateLeadNotificationDisplay(
    type: string | null | undefined,
    title: string,
    message: string | null | undefined
): { title: string; message: string | null } {
    if (normalizeNotificationType(type) !== "lead_multi_campaign") {
        return { title, message: message ?? null };
    }
    if (title.trim().toLowerCase().startsWith("duplicate lead:")) {
        return { title, message: message ?? null };
    }
    if (message) {
        const m = message.match(LEGACY_DUPLICATE_BODY);
        if (m) {
            const leadName = m[1].trim();
            const campaign = m[2].trim();
            return {
                title: `Duplicate lead: ${leadName}`,
                message: duplicateLeadMessage(campaign),
            };
        }
    }
    return { title, message: message ?? null };
}

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
