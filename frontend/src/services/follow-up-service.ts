import apiClient from "@/lib/api-client";

// Types
export type FollowUpStatus = "pending" | "completed" | "missed" | "cancelled";

export interface FollowUp {
    id: string;
    lead_id: string;
    assigned_to: string;
    scheduled_at: string;
    notes: string | null;
    status: FollowUpStatus;
    completed_at: string | null;
    completion_notes: string | null;
    created_at: string;
    updated_at: string;
    // Enriched fields
    lead?: {
        id: string;
        customer?: {
            first_name: string;
            last_name?: string;
            full_name?: string;
            email?: string;
            phone?: string;
        };
        stage?: {
            name: string;
            display_name: string;
            color?: string;
        };
        source: string;
    };
    assigned_to_user?: {
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        role: string;
        is_active: boolean;
        dealership_id: string | null;
    };
}

export interface FollowUpCreate {
    lead_id: string;
    scheduled_at: string;
    notes?: string;
    assigned_to?: string;  // User ID; if omitted, backend uses lead's primary or current user
    confirmSkate?: boolean;
}

export interface FollowUpUpdate {
    scheduled_at?: string;
    notes?: string;
    status?: FollowUpStatus;
    completion_notes?: string;
}

export interface FollowUpListParams {
    lead_id?: string;
    assigned_to?: string;
    status?: FollowUpStatus;
    overdue?: boolean;
}

// Status display info
export const FOLLOW_UP_STATUS_INFO: Record<FollowUpStatus, { label: string; color: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", color: "text-yellow-600", variant: "outline" },
    completed: { label: "Completed", color: "text-green-600", variant: "default" },
    missed: { label: "Missed", color: "text-red-600", variant: "destructive" },
    cancelled: { label: "Cancelled", color: "text-gray-600", variant: "secondary" },
};

// Service methods
export const FollowUpService = {
    /**
     * Get list of follow-ups
     */
    async listFollowUps(params: FollowUpListParams = {}): Promise<FollowUp[]> {
        const response = await apiClient.get<FollowUp[]>("/follow-ups/", { params });
        const data = response.data;
        return Array.isArray(data) ? data : (data ? [data] : []);
    },

    /**
     * Get a specific follow-up
     */
    async getFollowUp(id: string): Promise<FollowUp> {
        const response = await apiClient.get<FollowUp>(`/follow-ups/${id}`);
        return response.data;
    },

    /**
     * Schedule a new follow-up for a lead
     */
    async scheduleFollowUp(leadId: string, data: FollowUpCreate): Promise<FollowUp> {
        const response = await apiClient.post<FollowUp>(`/follow-ups/${leadId}`, {
            ...data,
            confirm_skate: data.confirmSkate ?? false
        });
        return response.data;
    },

    /**
     * Complete a follow-up
     */
    async completeFollowUp(followUpId: string, completionNotes?: string): Promise<FollowUp> {
        const response = await apiClient.post<FollowUp>(`/follow-ups/${followUpId}/complete`, {
            notes: completionNotes
        });
        return response.data;
    },

    /**
     * Update a follow-up
     */
    async updateFollowUp(id: string, data: FollowUpUpdate): Promise<FollowUp> {
        const response = await apiClient.patch<FollowUp>(`/follow-ups/${id}`, data);
        return response.data;
    },

    /**
     * Delete a follow-up
     */
    async deleteFollowUp(id: string): Promise<void> {
        await apiClient.delete(`/follow-ups/${id}`);
    },
};
