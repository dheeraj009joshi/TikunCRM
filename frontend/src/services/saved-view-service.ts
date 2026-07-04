import apiClient from "@/lib/api-client";

export interface SavedView {
    id: string;
    user_id: string;
    name: string;
    entity_type: string;
    filters: Record<string, string>;
    columns: string[] | null;
    sort: { key: string; direction: "asc" | "desc" } | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface SavedViewCreate {
    name: string;
    entity_type: string;
    filters: Record<string, string>;
    columns?: string[] | null;
    sort?: { key: string; direction: "asc" | "desc" } | null;
    is_default?: boolean;
}

export const SavedViewService = {
    async list(entityType?: string): Promise<SavedView[]> {
        const response = await apiClient.get("/saved-views/", {
            params: entityType ? { entity_type: entityType } : undefined,
        });
        return response.data;
    },

    async create(data: SavedViewCreate): Promise<SavedView> {
        const response = await apiClient.post("/saved-views/", data);
        return response.data;
    },

    async update(id: string, data: Partial<SavedViewCreate>): Promise<SavedView> {
        const response = await apiClient.patch(`/saved-views/${id}`, data);
        return response.data;
    },

    async delete(id: string): Promise<void> {
        await apiClient.delete(`/saved-views/${id}`);
    },
};
