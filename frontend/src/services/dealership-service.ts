import apiClient from "@/lib/api-client";

const DEALERSHIPS_PREFIX = "/dealerships";

export interface Dealership {
    id: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
    phone?: string;
    email?: string;
    website?: string;
    config: Record<string, unknown>;
    working_hours: Record<string, unknown>;
    lead_assignment_rules: Record<string, unknown>;
    timezone: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    /** Optional aggregates when returned by list/detail endpoints */
    users_count?: number;
    leads_count?: number;
}

export interface OwnerData {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    password: string;
}

export interface CreateDealershipData {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
    phone?: string;
    email?: string;
    website?: string;
    owner?: OwnerData;
}

export interface UpdateDealershipData extends Partial<CreateDealershipData> {
    is_active?: boolean;
    config?: Record<string, unknown>;
    working_hours?: Record<string, unknown>;
    lead_assignment_rules?: Record<string, unknown>;
    timezone?: string;
}

export const DealershipService = {
    // List all dealerships (Super Admin only)
    async listDealerships(params: { is_active?: boolean } = {}): Promise<Dealership[]> {
        const response = await apiClient.get(`${DEALERSHIPS_PREFIX}/`, { params });
        return response.data;
    },

    // Get single dealership
    async getDealership(id: string): Promise<Dealership> {
        const response = await apiClient.get(`${DEALERSHIPS_PREFIX}/${id}`);
        return response.data;
    },

    // Create new dealership (Super Admin only)
    async createDealership(data: CreateDealershipData): Promise<Dealership> {
        const response = await apiClient.post(`${DEALERSHIPS_PREFIX}/`, data);
        return response.data;
    },

    // Update dealership
    async updateDealership(id: string, data: UpdateDealershipData): Promise<Dealership> {
        const response = await apiClient.put(`${DEALERSHIPS_PREFIX}/${id}`, data);
        return response.data;
    },

    // Toggle dealership active status (Super Admin only)
    async toggleDealershipStatus(id: string, isActive: boolean): Promise<Dealership> {
        const response = await apiClient.patch(`${DEALERSHIPS_PREFIX}/${id}/status`, null, {
            params: { is_active: isActive }
        });
        return response.data;
    },

    // Partial update dealership
    async patchDealership(id: string, data: Partial<UpdateDealershipData>): Promise<Dealership> {
        const response = await apiClient.patch(`${DEALERSHIPS_PREFIX}/${id}`, data);
        return response.data;
    },

    // Get dealership for dropdown selection
    async getDealershipsForSelect(): Promise<Array<{ id: string; name: string }>> {
        const dealerships = await this.listDealerships({ is_active: true });
        return dealerships.map(d => ({ id: d.id, name: d.name }));
    },

    async getTwilioConfig(dealershipId: string): Promise<DealershipTwilioConfig> {
        const response = await apiClient.get(`${DEALERSHIPS_PREFIX}/${dealershipId}/twilio-config`);
        return response.data;
    },

    async patchTwilioConfig(
        dealershipId: string,
        data: DealershipTwilioConfigUpdate
    ): Promise<DealershipTwilioConfig> {
        const response = await apiClient.patch(`${DEALERSHIPS_PREFIX}/${dealershipId}/twilio-config`, data);
        return response.data;
    },
};

export interface DealershipTwilioConfig {
    dealership_id: string;
    account_sid?: string | null;
    auth_token_set: boolean;
    /** Present after configuration unlock; decrypted server-side */
    auth_token?: string | null;
    sms_enabled: boolean;
    sms_from_number?: string | null;
    whatsapp_enabled: boolean;
    whatsapp_from_number?: string | null;
    voice_enabled: boolean;
    twilio_twiml_app_sid?: string | null;
    twilio_api_key_sid?: string | null;
    api_key_secret_set: boolean;
    /** Present after configuration unlock; decrypted server-side */
    twilio_api_key_secret?: string | null;
    voice_caller_id_number?: string | null;
}

export interface DealershipTwilioConfigUpdate {
    account_sid?: string | null;
    auth_token?: string | null;
    sms_enabled?: boolean;
    sms_from_number?: string | null;
    whatsapp_enabled?: boolean;
    whatsapp_from_number?: string | null;
    voice_enabled?: boolean;
    twilio_twiml_app_sid?: string | null;
    twilio_api_key_sid?: string | null;
    twilio_api_key_secret?: string | null;
    voice_caller_id_number?: string | null;
}
