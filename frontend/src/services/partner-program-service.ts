import apiClient from "@/lib/api-client";

const PREFIX = "/partner-stores";

export interface DayHours {
    start?: string;
    end?: string;
    is_open?: boolean;
}

export interface PartnerProgram {
    id: string;
    partner_store_id: string;
    program_type: "leads_only" | "full_bdc";
    status: "pending" | "active" | "paused" | "cancelled";
    states: string[];
    postal_codes: string[];
    min_credit_score?: number | null;
    max_credit_score?: number | null;
    min_down_payment?: number | string | null;
    daily_cap?: number | null;
    monthly_cap?: number | null;
    hours: Record<string, DayHours>;
    timezone: string;
    priority_weight: number;
}

export interface PortalUser {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    is_active: boolean;
}

export interface BdcAgentAssignment {
    user_id: string;
    max_open_leads: number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
}

export interface LeadDeliveryRow {
    id: string;
    lead_id: string;
    customer_id: string;
    brand: string;
    partner_store_id: string;
    partner_store_name?: string | null;
    program_type: string;
    status: string;
    bdc_agent_id?: string | null;
    note?: string | null;
    delivered_at: string;
    updated_at: string;
}

export const PartnerProgramService = {
    async get(storeId: string): Promise<PartnerProgram | null> {
        const response = await apiClient.get<PartnerProgram | null>(`${PREFIX}/${storeId}/program`);
        return response.data;
    },
    async save(storeId: string, data: Partial<PartnerProgram> & { program_type: string; status: string }) {
        const response = await apiClient.put<PartnerProgram>(`${PREFIX}/${storeId}/program`, data);
        return response.data;
    },
    async listPortalUsers(storeId: string) {
        const response = await apiClient.get<PortalUser[]>(`${PREFIX}/${storeId}/portal-users`);
        return response.data;
    },
    async createPortalUser(storeId: string, data: { email: string; password: string; first_name?: string; last_name?: string }) {
        const response = await apiClient.post<PortalUser>(`${PREFIX}/${storeId}/portal-users`, data);
        return response.data;
    },
    async listBdcAgents(storeId: string) {
        const response = await apiClient.get<BdcAgentAssignment[]>(`${PREFIX}/${storeId}/bdc-agents`);
        return response.data;
    },
    async saveBdcAgents(storeId: string, agents: { user_id: string; max_open_leads: number }[]) {
        const response = await apiClient.put<BdcAgentAssignment[]>(`${PREFIX}/${storeId}/bdc-agents`, agents);
        return response.data;
    },
    async listDeliveries(leadId: string) {
        const response = await apiClient.get<LeadDeliveryRow[]>(`/leads/${leadId}/deliveries`);
        return response.data;
    },
    async routeLead(leadId: string) {
        const response = await apiClient.post<LeadDeliveryRow[]>(`/leads/${leadId}/route`);
        return response.data;
    },
    async returnDelivery(leadId: string, deliveryId: string, note?: string) {
        const response = await apiClient.post<LeadDeliveryRow[]>(
            `/leads/${leadId}/deliveries/${deliveryId}/return`,
            { note: note || null }
        );
        return response.data;
    },
};
