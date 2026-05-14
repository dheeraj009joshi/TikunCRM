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

/** Campaign association for multi-campaign leads */
export interface LeadCampaign {
    id: string;
    campaign_name: string;
    campaign_mapping_id?: string | null;
    sync_source_id?: string | null;
    added_at: string;
    display_name?: string | null;
}

/** One row per campaign (mapping id or raw name); keeps earliest added_at. */
export function dedupeLeadCampaigns(campaigns: LeadCampaign[] | undefined): LeadCampaign[] {
    if (!campaigns?.length) return [];
    const map = new Map<string, LeadCampaign>();
    for (const c of campaigns) {
        const key = c.campaign_mapping_id ?? `raw:${c.campaign_name}`;
        const prev = map.get(key);
        if (!prev || new Date(c.added_at) < new Date(prev.added_at)) {
            map.set(key, c);
        }
    }
    return Array.from(map.values()).sort(
        (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
    );
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
    source_display?: string | null;
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
    /** Indicates this lead appeared in multiple campaigns */
    is_starred?: boolean;
    /** Campaign associations (for multi-campaign leads) */
    campaigns?: LeadCampaign[];
    first_contacted_at?: string;
    last_contacted_at?: string;
    converted_at?: string;
    closed_at?: string;
    created_at: string;
    updated_at: string;
    /** Set when lead re-entered unassigned pool (stale/manual unassign); cleared on assign */
    returned_to_pool_at?: string | null;
    previous_assigned_to_id?: string | null;
    previous_assigned_to_user?: UserBrief | null;
    /** Number of activities (1 = only creation = fresh/untouched lead) */
    activity_count?: number;
    /** Last activity description (list response) */
    last_activity_description?: string | null;
    /** Last activity timestamp (list response) */
    last_activity_at?: string | null;
    /** When last activity was a note, the note body (list response) */
    last_note_content?: string | null;
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

/** Unassigned lead that was previously assigned (stale timeout or manual unassign) */
export function isLeadReturnedToPool(lead: Lead): boolean {
    return Boolean(lead.returned_to_pool_at && !lead.assigned_to);
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
    /** Filter by salesperson (admin/owner only) */
    assigned_to?: string;
    /** Filter leads created on or after this date (ISO format) */
    date_from?: string;
    /** Filter leads created on or before this date (ISO format) */
    date_to?: string;
    /** Only leads with multiple campaign submissions (is_starred) */
    multi_campaign_only?: boolean;
    /** Filter by campaign mapping (primary or lead_campaigns) */
    campaign_mapping_id?: string;
}

/** Same query params as GET /leads/ but without pagination — used for CSV export */
export type LeadExportFilters = Omit<LeadListParams, "page" | "page_size">;

export interface CampaignFilterOption {
    id: string;
    display_name: string;
    match_pattern: string;
    sync_source_name?: string | null;
}

/** Data for updating a lead - customer fields are at top level (not nested) */
export interface LeadUpdateData {
    // Lead-specific fields
    notes?: string;
    meta_data?: Record<string, unknown>;
    interested_in?: string;
    budget_range?: string;
    secondary_customer_id?: string | null;
    // Customer contact fields (updates associated customer)
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    alternate_phone?: string;
    address?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    company?: string;
    job_title?: string;
    date_of_birth?: string;
    preferred_contact_method?: string;
    preferred_contact_time?: string;
}

export const LeadService = {
    async listLeads(params: LeadListParams = {}): Promise<LeadListResponse> {
        const response = await apiClient.get(`${LEADS_PREFIX}/`, { params });
        return response.data;
    },

    async getCampaignFilterOptions(): Promise<CampaignFilterOption[]> {
        const response = await apiClient.get<CampaignFilterOption[]>(`${LEADS_PREFIX}/campaign-filter-options`);
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

    async updateLead(id: string, data: LeadUpdateData): Promise<Lead> {
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

    /** Unassign lead (remove salesperson). Admins/owners only. */
    async unassignLead(id: string): Promise<Lead> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${id}/unassign`);
        return response.data;
    },

    /** Credit application (Toyota South Atlanta, etc.) */
    async creditAppInitiate(leadId: string): Promise<{ ok: boolean; redirect_url: string }> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${leadId}/credit-app/initiate`);
        return response.data;
    },
    async creditAppComplete(
        leadId: string,
        data: { application_id?: string; form_id?: string; tax_id?: string }
    ): Promise<{ ok: boolean }> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${leadId}/credit-app/complete`, data);
        return response.data;
    },
    async creditAppAbandon(leadId: string, data: { reason?: string } = {}): Promise<{ ok: boolean }> {
        const response = await apiClient.post(`${LEADS_PREFIX}/${leadId}/credit-app/abandon`, data);
        return response.data;
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

    async exportToCSV(
        options?: LeadExportFilters & {
            include_activities?: boolean;
            include_appointments?: boolean;
            include_notes?: boolean;
        }
    ): Promise<void> {
        const params = new URLSearchParams();
        if (options?.include_activities) params.append("include_activities", "true");
        if (options?.include_appointments) params.append("include_appointments", "true");
        if (options?.include_notes) params.append("include_notes", "true");
        if (options?.search) params.append("search", options.search);
        if (options?.source && options.source !== "all") params.append("source", options.source);
        if (options?.stage_id) params.append("stage_id", options.stage_id);
        if (options?.pool) params.append("pool", options.pool);
        if (options?.fresh_only === true) params.append("fresh_only", "true");
        if (options?.multi_campaign_only === true) params.append("multi_campaign_only", "true");
        if (options?.campaign_mapping_id) params.append("campaign_mapping_id", options.campaign_mapping_id);
        if (options?.assigned_to) params.append("assigned_to", options.assigned_to);
        if (options?.date_from) params.append("date_from", options.date_from);
        if (options?.date_to) params.append("date_to", options.date_to);
        if (typeof options?.is_active === "boolean") params.append("is_active", String(options.is_active));

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
