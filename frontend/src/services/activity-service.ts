import apiClient from "@/lib/api-client";

const ACTIVITIES_PREFIX = "/activities";

export type ActivityType = 
    | "lead_created"
    | "lead_assigned"
    | "lead_reassigned"
    | "lead_updated"
    | "status_changed"
    | "note_added"
    | "call_logged"
    | "email_sent"
    | "email_received"
    | "sms_sent"
    | "whatsapp_sent"
    | "follow_up_scheduled"
    | "follow_up_completed"
    | "follow_up_missed"
    | "appointment_scheduled"
    | "appointment_completed"
    | "appointment_cancelled"
    | "user_login"
    | "user_logout"
    | "import_completed"
    | "sync_completed";

export interface ActivityUser {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    is_active: boolean;
    dealership_id?: string;
}

export interface Activity {
    id: string;
    type: ActivityType;
    description: string;
    user_id?: string;
    lead_id?: string;
    dealership_id?: string;
    parent_id?: string;
    meta_data: Record<string, unknown>;
    created_at: string;
    user?: ActivityUser;
}

export interface ActivityListResponse {
    items: Activity[];
    total: number;
    page: number;
    page_size: number;
}

export interface ActivityListParams {
    page?: number;
    page_size?: number;
    lead_id?: string;
    user_id?: string;
    type?: ActivityType;
}

// Activity type display info
export const ACTIVITY_TYPE_INFO: Record<ActivityType, { label: string; icon: string; color: string }> = {
    lead_created: { label: "Lead Created", icon: "plus-circle", color: "emerald" },
    lead_assigned: { label: "Lead Assigned", icon: "user-plus", color: "blue" },
    lead_reassigned: { label: "Lead Reassigned", icon: "users", color: "amber" },
    lead_updated: { label: "Lead Updated", icon: "edit", color: "slate" },
    status_changed: { label: "Status Changed", icon: "refresh-cw", color: "purple" },
    note_added: { label: "Note Added", icon: "message-square", color: "gray" },
    call_logged: { label: "Call Logged", icon: "phone", color: "emerald" },
    email_sent: { label: "Email Sent", icon: "send", color: "blue" },
    email_received: { label: "Email Received", icon: "mail", color: "indigo" },
    sms_sent: { label: "SMS Sent", icon: "message-circle", color: "teal" },
    whatsapp_sent: { label: "WhatsApp Sent", icon: "message-circle", color: "green" },
    follow_up_scheduled: { label: "Follow-up Scheduled", icon: "calendar", color: "amber" },
    follow_up_completed: { label: "Follow-up Completed", icon: "check-circle", color: "emerald" },
    follow_up_missed: { label: "Follow-up Missed", icon: "alert-circle", color: "rose" },
    appointment_scheduled: { label: "Appointment Scheduled", icon: "calendar-clock", color: "purple" },
    appointment_completed: { label: "Appointment Completed", icon: "check-circle", color: "emerald" },
    appointment_cancelled: { label: "Appointment Cancelled", icon: "x-circle", color: "rose" },
    user_login: { label: "User Login", icon: "log-in", color: "gray" },
    user_logout: { label: "User Logout", icon: "log-out", color: "gray" },
    import_completed: { label: "Import Completed", icon: "download", color: "blue" },
    sync_completed: { label: "Sync Completed", icon: "refresh-cw", color: "emerald" }
};

export const ActivityService = {
    // List activities with optional filters
    async listActivities(params: ActivityListParams = {}): Promise<ActivityListResponse> {
        const response = await apiClient.get(`${ACTIVITIES_PREFIX}/`, { params });
        return response.data;
    },

    // Get activities for a specific lead
    async getLeadTimeline(leadId: string, params: Omit<ActivityListParams, 'lead_id'> = {}): Promise<ActivityListResponse> {
        const response = await apiClient.get(`${ACTIVITIES_PREFIX}/lead/${leadId}`, { params });
        return response.data;
    },

    // Log a call
    async logCall(leadId: string, data: {
        duration_seconds?: number;
        outcome: string;
        notes?: string;
        confirmSkate?: boolean;
    }): Promise<Activity> {
        const response = await apiClient.post(`/leads/${leadId}/log-call`, {
            ...data,
            confirm_skate: data.confirmSkate ?? false
        });
        return response.data;
    },

    // Log an email
    async logEmail(leadId: string, data: {
        subject: string;
        body?: string;
        direction: 'sent' | 'received';
        confirmSkate?: boolean;
    }): Promise<Activity> {
        const response = await apiClient.post(`/leads/${leadId}/log-email`, {
            ...data,
            confirm_skate: data.confirmSkate ?? false
        });
        return response.data;
    }
};
