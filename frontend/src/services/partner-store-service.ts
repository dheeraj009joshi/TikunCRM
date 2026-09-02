/**
 * Partner Store Service — CRUD for external dealer partners
 * where approved customers are connected to buy cars.
 */
import apiClient from "@/lib/api-client";

const PREFIX = "/partner-stores";

export interface PartnerStore {
    id: string;
    name: string;
    brand?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    contact_person?: string | null;
    notes?: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface PartnerStoreCreate {
    name: string;
    brand?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string;
    postal_code?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    contact_person?: string | null;
    notes?: string | null;
}

export interface PartnerStoreUpdate {
    name?: string;
    brand?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    contact_person?: string | null;
    notes?: string | null;
    is_active?: boolean;
}

export interface PartnerStoreListResponse {
    items: PartnerStore[];
    total: number;
}

export interface PartnerStoreListParams {
    brand?: string;
    active_only?: boolean;
    search?: string;
}

export const PartnerStoreService = {
    async list(params: PartnerStoreListParams = {}): Promise<PartnerStoreListResponse> {
        const response = await apiClient.get(`${PREFIX}/`, { params });
        return response.data;
    },

    async getBrands(): Promise<string[]> {
        const response = await apiClient.get<string[]>(`${PREFIX}/brands`);
        return response.data;
    },

    async getById(id: string): Promise<PartnerStore> {
        const response = await apiClient.get(`${PREFIX}/${id}`);
        return response.data;
    },

    async create(data: PartnerStoreCreate): Promise<PartnerStore> {
        const response = await apiClient.post(`${PREFIX}/`, data);
        return response.data;
    },

    async update(id: string, data: PartnerStoreUpdate): Promise<PartnerStore> {
        const response = await apiClient.put(`${PREFIX}/${id}`, data);
        return response.data;
    },

    async delete(id: string): Promise<void> {
        await apiClient.delete(`${PREFIX}/${id}`);
    },

    async connectLeadToPartner(
        leadId: string,
        partnerStoreId: string,
        notes?: string,
    ): Promise<unknown> {
        const response = await apiClient.post(`/leads/${leadId}/connect-partner`, {
            partner_store_id: partnerStoreId,
            notes,
        });
        return response.data;
    },

    async disconnectLeadFromPartner(leadId: string): Promise<unknown> {
        const response = await apiClient.delete(`/leads/${leadId}/connect-partner`);
        return response.data;
    },
};
