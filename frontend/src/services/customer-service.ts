/**
 * Customer Service — permanent person identity.
 * One customer can have many leads (sales opportunities).
 */
import apiClient from "@/lib/api-client";

const PREFIX = "/customers";

export interface Customer {
    id: string;
    first_name: string;
    last_name?: string;
    full_name?: string;
    phone?: string;
    email?: string;
    alternate_phone?: string;
    whatsapp?: string;
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
    source_first_touch?: string;
    lifetime_value: number;
    meta_data: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface CustomerBrief {
    id: string;
    first_name: string;
    last_name?: string;
    full_name?: string;
    phone?: string;
    email?: string;
}

export interface CustomerListResponse {
    items: Customer[];
    total: number;
    page: number;
    page_size: number;
    pages: number;
}

export interface Customer360 extends Customer {
    leads: any[];       // LeadResponse objects
    total_leads: number;
    active_leads: number;
}

export function getCustomerFullName(c: CustomerBrief | Customer): string {
    if ((c as any).full_name) return (c as any).full_name;
    return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
}

export const CustomerService = {
    async list(params: { page?: number; page_size?: number; search?: string } = {}): Promise<CustomerListResponse> {
        const response = await apiClient.get(`${PREFIX}/`, { params });
        return response.data;
    },

    async get(id: string): Promise<Customer360> {
        const response = await apiClient.get(`${PREFIX}/${id}`);
        return response.data;
    },

    async create(data: Partial<Customer>): Promise<Customer> {
        const response = await apiClient.post(`${PREFIX}/`, data);
        return response.data;
    },

    async update(id: string, data: Partial<Customer>): Promise<Customer> {
        const response = await apiClient.patch(`${PREFIX}/${id}`, data);
        return response.data;
    },

    async getLeads(customerId: string): Promise<{ items: any[]; total: number }> {
        const response = await apiClient.get(`${PREFIX}/${customerId}/leads`);
        return response.data;
    },
};
