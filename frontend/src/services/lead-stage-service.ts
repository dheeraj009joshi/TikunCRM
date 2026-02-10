/**
 * LeadStage Service — configurable pipeline stages.
 */
import apiClient from "@/lib/api-client";

const PREFIX = "/lead-stages";

export interface LeadStage {
    id: string;
    name: string;
    display_name: string;
    order: number;
    color?: string;
    dealership_id?: string;
    is_terminal: boolean;
    is_active: boolean;
    created_at: string;
}

export const LeadStageService = {
    async list(dealershipId?: string): Promise<LeadStage[]> {
        const params = dealershipId ? { dealership_id: dealershipId } : {};
        const response = await apiClient.get(`${PREFIX}/`, { params });
        return response.data;
    },

    async create(data: Partial<LeadStage>): Promise<LeadStage> {
        const response = await apiClient.post(`${PREFIX}/`, data);
        return response.data;
    },

    async update(id: string, data: Partial<LeadStage>): Promise<LeadStage> {
        const response = await apiClient.patch(`${PREFIX}/${id}`, data);
        return response.data;
    },

    async reorder(orderedIds: string[]): Promise<void> {
        await apiClient.post(`${PREFIX}/reorder`, { ordered_ids: orderedIds });
    },

    async delete(id: string): Promise<void> {
        await apiClient.delete(`${PREFIX}/${id}`);
    },

    async seed(): Promise<void> {
        await apiClient.post(`${PREFIX}/seed`);
    },
};

/** Get display color for a stage, with fallback */
export function getStageColor(stage?: LeadStage | null): string {
    return stage?.color || "#6B7280";
}

/** Get display label */
export function getStageLabel(stage?: LeadStage | null): string {
    return stage?.display_name || stage?.name || "Unknown";
}
