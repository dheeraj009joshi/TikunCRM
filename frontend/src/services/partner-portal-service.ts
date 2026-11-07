import { partnerClient, PARTNER_TOKEN_KEY } from "@/lib/partner-client";

export interface PartnerSession {
    access_token: string;
    store_id: string;
    store_name: string;
    program_type?: string | null;
}

export interface PartnerMe {
    store_id: string;
    store_name: string;
    brand?: string | null;
    program_type?: string | null;
    email: string;
}

export interface PortalDelivery {
    id: string;
    brand: string;
    status: string;
    customer_name: string;
    phone?: string | null;
    email?: string | null;
    interested_in?: string | null;
    delivered_at: string;
    note?: string | null;
}

export interface PortalAppointment {
    id: string;
    lead_id?: string | null;
    title?: string | null;
    scheduled_at: string;
    status: string;
    customer_name: string;
    phone?: string | null;
    duration_minutes: number;
}

export const PartnerPortalService = {
    token() {
        if (typeof window === "undefined") return null;
        return localStorage.getItem(PARTNER_TOKEN_KEY);
    },
    async login(email: string, password: string) {
        const response = await partnerClient.post<PartnerSession>("/auth/partner/login", { email, password });
        localStorage.setItem(PARTNER_TOKEN_KEY, response.data.access_token);
        return response.data;
    },
    logout() {
        localStorage.removeItem(PARTNER_TOKEN_KEY);
    },
    async me() {
        const response = await partnerClient.get<PartnerMe>("/partner-portal/me");
        return response.data;
    },
    async deliveries() {
        const response = await partnerClient.get<PortalDelivery[]>("/partner-portal/deliveries");
        return response.data;
    },
    async updateDelivery(id: string, status: string) {
        const response = await partnerClient.post<PortalDelivery>(`/partner-portal/deliveries/${id}`, { status });
        return response.data;
    },
    async appointments() {
        const response = await partnerClient.get<PortalAppointment[]>("/partner-portal/appointments");
        return response.data;
    },
    async updateAppointment(id: string, outcome: string) {
        const response = await partnerClient.post<PortalAppointment>(`/partner-portal/appointments/${id}`, { outcome });
        return response.data;
    },
};
