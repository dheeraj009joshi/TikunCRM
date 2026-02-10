/**
 * Stips Service — categories (admin) and lead documents (upload/view/delete).
 */
import apiClient from "@/lib/api-client";

const CATEGORIES_PREFIX = "/stips/categories";

export interface StipsCategory {
    id: string;
    name: string;
    display_order: number;
    scope: "customer" | "lead";
    dealership_id?: string | null;
    created_at: string;
    updated_at: string;
}

export interface StipDocument {
    id: string;
    category_id: string;
    category_name: string;
    scope: "customer" | "lead";
    file_name: string;
    content_type: string;
    file_size?: number | null;
    uploaded_at: string;
    uploaded_by_name?: string | null;
    customer_scope?: "primary" | "secondary" | null;
}

export const StipsService = {
    async getStatus(): Promise<{ configured: boolean }> {
        const response = await apiClient.get("/stips/status");
        return response.data;
    },

    async listCategories(dealershipId?: string): Promise<StipsCategory[]> {
        const params = dealershipId ? { dealership_id: dealershipId } : {};
        const response = await apiClient.get(`${CATEGORIES_PREFIX}`, { params });
        return response.data;
    },

    async createCategory(data: {
        name: string;
        display_order?: number;
        scope?: "customer" | "lead";
        dealership_id?: string | null;
    }): Promise<StipsCategory> {
        const response = await apiClient.post(CATEGORIES_PREFIX, data);
        return response.data;
    },

    async updateCategory(
        id: string,
        data: Partial<{ name: string; display_order: number; scope: "customer" | "lead" }>
    ): Promise<StipsCategory> {
        const response = await apiClient.patch(`${CATEGORIES_PREFIX}/${id}`, data);
        return response.data;
    },

    async deleteCategory(id: string): Promise<void> {
        await apiClient.delete(`${CATEGORIES_PREFIX}/${id}`);
    },

    async reorderCategories(orderedIds: string[]): Promise<void> {
        await apiClient.post(`${CATEGORIES_PREFIX}/reorder`, { ordered_ids: orderedIds });
    },

    async listDocuments(leadId: string, categoryId?: string): Promise<StipDocument[]> {
        const params = categoryId ? { category_id: categoryId } : {};
        const response = await apiClient.get(`/leads/${leadId}/stips/documents`, { params });
        return response.data;
    },

    async uploadDocument(
        leadId: string,
        stipsCategoryId: string,
        file: File,
        onUploadProgress?: (percent: number) => void
    ): Promise<StipDocument> {
        const form = new FormData();
        form.append("file", file);
        const response = await apiClient.post(
            `/leads/${leadId}/stips/documents?stips_category_id=${stipsCategoryId}`,
            form,
            {
                headers: { "Content-Type": "multipart/form-data" },
                onUploadProgress: onUploadProgress
                    ? (e) => {
                          const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
                          onUploadProgress(percent);
                      }
                    : undefined,
            }
        );
        return response.data;
    },

    async deleteDocument(leadId: string, documentId: string): Promise<void> {
        await apiClient.delete(`/leads/${leadId}/stips/documents/${documentId}`);
    },

    async getViewUrl(leadId: string, documentId: string): Promise<{ url: string }> {
        const response = await apiClient.get(
            `/leads/${leadId}/stips/documents/${documentId}/view`
        );
        return response.data;
    },
};
