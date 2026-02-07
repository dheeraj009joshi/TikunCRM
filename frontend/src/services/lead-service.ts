import apiClient from "@/lib/api-client";

const LEADS_PREFIX = "/leads";

export interface UserBrief {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    is_active: boolean;
    dealership_id?: string;
}

export interface DealershipBrief {
    id: string;
    name: string;
}

export interface Lead {
    id: string;
    first_name: string;
    last_name?: string;
    full_name?: string; // Computed property from backend
    email?: string;
    phone?: string;
    alternate_phone?: string;
    source: string;
    status: string;
    dealership_id?: string;
    assigned_to?: string;
    secondary_salesperson_id?: string;
    created_by?: string;
    notes?: string;
    meta_data: Record<string, unknown>;
    interested_in?: string;
    budget_range?: string;
    first_contacted_at?: string;
    last_contacted_at?: string;
    converted_at?: string;
    created_at: string;
    updated_at: string;
    // Address fields
    address?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    // Additional details
    date_of_birth?: string;
    company?: string;
    job_title?: string;
    preferred_contact_method?: string;
    preferred_contact_time?: string;
    // Extended info (available in detail view)
    assigned_to_user?: UserBrief;
    secondary_salesperson?: UserBrief;
    created_by_user?: UserBrief;
    dealership?: DealershipBrief;
    /** "full" = full access; "mention_only" = can only read lead and reply to notes */
    access_level?: "full" | "mention_only";
}

// Helper to get full name from lead (handles missing full_name)
export function getLeadFullName(lead: Lead): string {
    if (lead.full_name) return lead.full_name;
    return [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown Lead';
}

export interface LeadListResponse {
    items: Lead[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
}

export interface LeadListParams {
    page?: number;
    page_size?: number;
    status?: string;
    source?: string;
    search?: string;
    dealership_id?: string;
    /** "unassigned" = only leads in the unassigned pool (no dealership) - visible to all users */
    pool?: string;
}

export const LeadService = {
    // List leads with role-based filtering applied server-side
    async listLeads(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/`, { params });
        return response.data;
    },

    // Get unassigned leads (leads not assigned to any dealership) - Super Admin only
    async listUnassignedLeads(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/unassigned`, { params });
        return response.data;
    },

    // Get leads assigned to dealership but not to salesperson - Dealership Admin
    async listUnassignedToSalesperson(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/unassigned-to-salesperson`, { params });
        return response.data;
    },

    // Get single lead details
    async getLead(id: string): Promise<Lead> {
        const response = await apiClient.get(`${LEADS_PREFIX}/${id}`);
        return response.data;
    },

    // Create new lead
    async createLead(data: Partial<Lead>): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/`, data);
        return response.data;
    },

    // Update lead details
    async updateLead(id: string, data: Partial<Lead>): Promise<Lead> {
        const response = await apiClient.patch(`${LEADS_PREFIX}/${id}`, data);
        return response.data;
    },

    // Update lead status
    async updateLeadStatus(id: string, status: string, notes?: string, confirmSkate?: boolean): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/status`, { 
            status, 
            notes,
            confirm_skate: confirmSkate ?? false
        });
        return response.data;
    },

    // Assign lead to salesperson (within a dealership)
    async assignToSalesperson(id: string, userId: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/assign`, { 
            assigned_to: userId, 
            notes 
        });
        return response.data;
    },

    // Assign lead to dealership - Super Admin only
    async assignToDealership(id: string, dealershipId: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/assign-dealership`, { 
            dealership_id: dealershipId, 
            notes 
        });
        return response.data;
    },

    // Bulk assign leads to dealership - Super Admin only
    async bulkAssignToDealership(
        leadIds: string[], 
        dealershipId: string
    ): Promise<{ message: string; assigned_count: number; dealership_id: string }> {
        const response = await apiClient.post(`${LEADS_PREFIX}/bulk-assign-dealership`, {
            lead_ids: leadIds,
            dealership_id: dealershipId
        });
        return response.data;
    },

    // Add note to lead
    async addNote(
        id: string, 
        content: string, 
        options?: { 
            parent_id?: string;
            mentioned_user_ids?: string[];
            confirmSkate?: boolean;
        }
    ): Promise<Lead> {
        // Explicitly construct plain object to avoid any circular references
        const requestBody: Record<string, unknown> = {
            content: String(content),
            confirm_skate: options?.confirmSkate === true
        };
        
        if (options?.parent_id) {
            requestBody.parent_id = String(options.parent_id);
        }
        
        if (options?.mentioned_user_ids && options.mentioned_user_ids.length > 0) {
            requestBody.mentioned_user_ids = options.mentioned_user_ids.map(id => String(id));
        }
        
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/notes`, requestBody);
        return response.data;
    },

    // Legacy alias for backward compatibility
    async assignLead(id: string, userId: string, notes?: string): Promise<Lead> {
        return this.assignToSalesperson(id, userId, notes);
    },

    // Assign secondary salesperson (Admin only)
    async assignSecondarySalesperson(id: string, secondaryUserId: string | null, notes?: string): Promise<Lead> {
        const response = await apiClient.patch(`${LEADS_PREFIX}/${id}/assign-secondary`, {
            secondary_salesperson_id: secondaryUserId,
            notes
        });
        return response.data;
    },

    // Swap primary and secondary salespersons (Admin only)
    async swapSalespersons(id: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/swap-salespersons`, { notes });
        return response.data;
    },

    // Delete lead - Super Admin only
    async deleteLead(id: string): Promise<{ message: string; lead_id: string }> {
        const response = await apiClient.delete(`${LEADS_PREFIX}/${id}`);
        return response.data;
    },

    // Export leads to CSV
    async exportToCSV(options?: {
        include_activities?: boolean;
        include_appointments?: boolean;
        include_notes?: boolean;
        status?: string;
        source?: string;
        date_from?: string;
        date_to?: string;
    }): Promise<void> {
        const params = new URLSearchParams();
        if (options?.include_activities) params.append('include_activities', 'true');
        if (options?.include_appointments) params.append('include_appointments', 'true');
        if (options?.include_notes) params.append('include_notes', 'true');
        if (options?.status && options.status !== 'all') params.append('status', options.status);
        if (options?.source && options.source !== 'all') params.append('source', options.source);
        if (options?.date_from) params.append('date_from', options.date_from);
        if (options?.date_to) params.append('date_to', options.date_to);
        
        const response = await apiClient.get(`${LEADS_PREFIX}/export/csv?${params.toString()}`, {
            responseType: 'blob'
        });
        
        // Create download link
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // Extract filename from content-disposition header if available
        const contentDisposition = response.headers['content-disposition'];
        let filename = 'leads_export.csv';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename=(.+)/);
            if (match) filename = match[1];
        }
        
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    }
};
