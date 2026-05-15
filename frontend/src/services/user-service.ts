import apiClient from "@/lib/api-client";

const USERS_PREFIX = "/users";

export const UserService = {
    async listUsers() {
        const response = await apiClient.get(`${USERS_PREFIX}/`);
        return response.data;
    },

    async getUser(id: string) {
        const response = await apiClient.get(`${USERS_PREFIX}/${id}`);
        return response.data;
    },

    async createUser(data: any) {
        const { phone, ...rest } = data;
        const payload: Record<string, unknown> = { ...rest };
        const trimmed = typeof phone === "string" ? phone.trim() : "";
        if (trimmed) payload.phone = trimmed;
        const response = await apiClient.post(`${USERS_PREFIX}/`, payload);
        return response.data;
    },

    async updateUser(id: string, data: any) {
        const response = await apiClient.patch(`${USERS_PREFIX}/${id}`, data);
        return response.data;
    }
};
