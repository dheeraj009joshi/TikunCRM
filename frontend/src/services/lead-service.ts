/**
 * Lead Service — a lead is one sales opportunity for a customer.
 * Contact info lives on the embedded customer object.
 * Pipeline position lives on the embedded stage object.
 */
import apiClient from "@/lib/api-client";
import { CustomerBrief } from "./customer-service";
import { LeadStage } from "./lead-stage-service";

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
    // Customer (embedded)
    customer_id: string;
    customer?: CustomerBrief;
    secondary_customer_id?: string | null;
    secondary_customer?: CustomerBrief | null;
    // Stage (embedded)
    stage_id: string;
    stage?: LeadStage;
    // Lead fields
    source: string;
    is_active: boolean;
    outcome?: string;
    interest_score: number;
    dealership_id?: string;
    assigned_to?: string;
    secondary_salesperson_id?: string;
    created_by?: string;
    notes?: string;
    meta_data: Record<string, unknown>;
    external_id?: string;
    interested_in?: string;
    budget_range?: string;
    first_contacted_at?: string;
    last_contacted_at?: string;
    converted_at?: string;
    closed_at?: string;
    created_at: string;
    updated_at: string;
    /** Number of activities (1 = only creation = fresh/untouched lead) */
    activity_count?: number;
    // Extended info (available in detail view)
    assigned_to_user?: UserBrief;
    secondary_salesperson?: UserBrief;
    created_by_user?: UserBrief;
    dealership?: DealershipBrief;
    access_level?: "full" | "mention_only";
}

/** Get full name from the embedded customer */
export function getLeadFullName(lead: Lead): string {
    if (lead.customer?.full_name) return lead.customer.full_name;
    if (lead.customer) {
        return [lead.customer.first_name, lead.customer.last_name].filter(Boolean).join(" ") || "Unknown Lead";
    }
    return "Unknown Lead";
}

/** Convenience: get phone from embedded customer */
export function getLeadPhone(lead: Lead): string | undefined {
    return lead.customer?.phone;
}

/** Convenience: get email from embedded customer */
export function getLeadEmail(lead: Lead): string | undefined {
    return lead.customer?.email;
}

/** True if lead has no activity except the default creation (untouched/fresh) */
export function isFreshLead(lead: Lead): boolean {
    return (lead.activity_count ?? 0) <= 1;
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
    stage_id?: string;
    source?: string;
    search?: string;
    dealership_id?: string;
    is_active?: boolean;
    pool?: string;
    /** Only leads with no activity except creation (fresh/untouched) */
    fresh_only?: boolean;
}

export const LeadService = {
    async listLeads(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/`, { params });
        return response.data;
    },

    async listUnassignedLeads(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/unassigned`, { params });
        return response.data;
    },

    async listUnassignedToSalesperson(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/unassigned-to-salesperson`, { params });
        return response.data;
    },

    async getLead(id: string): Promise<Lead> {
        const response = await apiClient.get(`${LEADS_PREFIX}/${id}`);
        return response.data;
    },

    async createLead(data: {
        first_name: string;
        last_name?: string;
        phone?: string;
        email?: string;
        source?: string;
        notes?: string;
        interested_in?: string;
        budget_range?: string;
        dealership_id?: string;
        assigned_to?: string;
        secondary_customer_id?: string | null;
        meta_data?: Record<string, unknown>;
        // Customer contact fields (passed through to find_or_create_customer)
        alternate_phone?: string;
        address?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
        date_of_birth?: string;
        company?: string;
        job_title?: string;
        preferred_contact_method?: string;
        preferred_contact_time?: string;
    }): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/`, data);
        return response.data;
    },

    async updateLead(id: string, data: Partial<Lead>): Promise<Lead> {
        const response = await apiClient.patch(`${LEADS_PREFIX}/${id}`, data);
        return response.data;
    },

    /** Change lead's pipeline stage */
    async updateLeadStage(id: string, stageId: string, notes?: string, confirmSkate?: boolean): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/stage`, {
            stage_id: stageId,
            notes,
            confirm_skate: confirmSkate ?? false,
        });
        return response.data;
    },

    /** Legacy compat — use stage name (backend translates to stage_id) */
    async updateLeadStatus(id: string, status: string, notes?: string, confirmSkate?: boolean): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/status`, {
            status,
            notes,
            confirm_skate: confirmSkate ?? false,
        });
        return response.data;
    },

    async assignToSalesperson(id: string, userId: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/assign`, {
            assigned_to: userId,
            notes,
        });
        return response.data;
    },

    async assignToDealership(id: string, dealershipId: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/assign-dealership`, {
            dealership_id: dealershipId,
            notes,
        });
        return response.data;
    },

    async bulkAssignToDealership(
        leadIds: string[],
        dealershipId: string,
    ): Promise<{ message: string; assigned_count: number; dealership_id: string }> {
        const response = await apiClient.post(`${LEADS_PREFIX}/bulk-assign-dealership`, {
            lead_ids: leadIds,
            dealership_id: dealershipId,
        });
        return response.data;
    },

    async addNote(
        id: string,
        content: string,
        options?: {
            parent_id?: string;
            mentioned_user_ids?: string[];
            confirmSkate?: boolean;
        },
    ): Promise<Lead> {
        const requestBody: Record<string, unknown> = {
            content: String(content),
            confirm_skate: options?.confirmSkate === true,
        };
        if (options?.parent_id) requestBody.parent_id = String(options.parent_id);
        if (options?.mentioned_user_ids?.length) {
            requestBody.mentioned_user_ids = options.mentioned_user_ids.map((i) => String(i));
        }
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/notes`, requestBody);
        return response.data;
    },

    async assignLead(id: string, userId: string, notes?: string): Promise<Lead> {
        return this.assignToSalesperson(id, userId, notes);
    },

    async assignSecondarySalesperson(id: string, secondaryUserId: string | null, notes?: string): Promise<Lead> {
        const response = await apiClient.patch(`${LEADS_PREFIX}/${id}/assign-secondary`, {
            secondary_salesperson_id: secondaryUserId,
            notes,
        });
        return response.data;
    },

    async swapSalespersons(id: string, notes?: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/swap-salespersons`, { notes });
        return response.data;
    },

    async deleteLead(id: string): Promise<{ message: string; lead_id: string }> {
        const response = await apiClient.delete(`${LEADS_PREFIX}/${id}`);
        return response.data;
    },

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
        if (options?.include_activities) params.append("include_activities", "true");
        if (options?.include_appointments) params.append("include_appointments", "true");
        if (options?.include_notes) params.append("include_notes", "true");
        if (options?.status && options.status !== "all") params.append("status", options.status);
        if (options?.source && options.source !== "all") params.append("source", options.source);
        if (options?.date_from) params.append("date_from", options.date_from);
        if (options?.date_to) params.append("date_to", options.date_to);

        const response = await apiClient.get(`${LEADS_PREFIX}/export/csv?${params.toString()}`, {
            responseType: "blob",
        });

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement("a");
        link.href = url;

        const contentDisposition = response.headers["content-disposition"];
        let filename = "leads_export.csv";
        if (contentDisposition) {
            const match = contentDisposition.match(/filename=(.+)/);
            if (match) filename = match[1];
        }

        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    },
};
