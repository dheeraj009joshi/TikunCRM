import apiClient from "@/lib/api-client";

export interface DeskItem {
    id: string;
    lead_id: string;
    customer_name: string;
    phone?: string | null;
    email?: string | null;
    brand: string;
    partner_store_id: string;
    partner_store_name?: string | null;
    status: string;
    bdc_agent_id?: string | null;
    delivered_at: string;
    note?: string | null;
}

export const BdcDeskService = {
    async queue() {
        const response = await apiClient.get<DeskItem[]>("/bdc-desk/queue");
        return response.data;
    },
    async setStatus(id: string, status: string, note?: string) {
        const response = await apiClient.post<DeskItem>(`/bdc-desk/${id}/status`, { status, note });
        return response.data;
    },
    async book(id: string, scheduled_at: string, duration_minutes: number, note?: string) {
        const response = await apiClient.post<DeskItem>(`/bdc-desk/${id}/appointment`, {
            scheduled_at,
            duration_minutes,
            note,
        });
        return response.data;
    },
};
