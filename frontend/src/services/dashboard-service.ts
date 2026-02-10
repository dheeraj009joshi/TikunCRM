import apiClient from "@/lib/api-client";

export interface SuperAdminStats {
    total_leads: number;
    unassigned_leads: number;
    total_dealerships: number;
    active_dealerships: number;
    conversion_rate: string;
    total_salesforce: number;
    leads_change: string;
    conversion_change: string;
    dealerships_change: string;
    salesforce_change: string;
}

export interface DealershipPerformance {
    id: string;
    name: string;
    total_leads: number;
    converted_leads: number;
    conversion_rate: number;
    active_leads: number;
    avg_response_time?: string;
}

export interface DealershipAdminStats {
    total_leads: number;
    unassigned_to_salesperson: number;
    active_leads: number;
    converted_leads: number;
    conversion_rate: string;
    team_size: number;
    pending_follow_ups: number;
    overdue_follow_ups: number;
    fresh_leads: number;
}

export interface SalespersonStats {
    total_leads: number;
    active_leads: number;
    converted_leads: number;
    lost_leads: number;
    conversion_rate: string;
    todays_follow_ups: number;
    overdue_follow_ups: number;
    leads_by_status: Record<string, number>;
    fresh_leads: number;
}

export interface LeadsBySource {
    source: string;
    count: number;
    percentage: number;
}

export interface LeadsByStatus {
    status: string;
    count: number;
    percentage: number;
}

export const DashboardService = {
    // Universal stats endpoint - returns role-appropriate data
    async getStats() {
        const response = await apiClient.get("/dashboard/stats");
        return response.data;
    },

    // Super Admin specific endpoints
    async getSuperAdminStats(): Promise<SuperAdminStats> {
        const response = await apiClient.get("/dashboard/super-admin/stats");
        return response.data;
    },

    async getDealershipPerformance(limit: number = 10): Promise<DealershipPerformance[]> {
        const response = await apiClient.get("/dashboard/super-admin/dealership-performance", {
            params: { limit }
        });
        return response.data;
    },

    async getLeadsBySource(): Promise<LeadsBySource[]> {
        const response = await apiClient.get("/dashboard/super-admin/leads-by-source");
        return response.data;
    },

    // Dealership Admin specific endpoints
    async getDealershipAdminStats(): Promise<DealershipAdminStats> {
        const response = await apiClient.get("/dashboard/dealership-admin/stats");
        return response.data;
    },

    // Salesperson specific endpoints
    async getSalespersonStats(): Promise<SalespersonStats> {
        const response = await apiClient.get("/dashboard/salesperson/stats");
        return response.data;
    },

    // Legacy endpoints for backward compatibility
    async getDealershipStats(dealershipId: string) {
        const response = await apiClient.get(`/dashboard/dealership/${dealershipId}/stats`);
        return response.data;
    },

    async getPerformanceReport(params: { start_date?: string; end_date?: string } = {}) {
        const response = await apiClient.get("/dashboard/performance", { params });
        return response.data;
    }
};
