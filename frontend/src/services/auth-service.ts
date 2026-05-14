import apiClient from "@/lib/api-client";
import { useAuthStore, User } from "@/stores/auth-store";

const AUTH_PREFIX = "/auth";

export type DealershipOption = {
    id: string | null; // null for super admin
    name: string;
    is_super_admin: boolean;
};

export type DealershipRequiredDetail = {
    code: "dealership_required";
    message: string;
    dealerships: DealershipOption[];
};

export const AuthService = {
    async login(credentials: { email: string; password: string }) {
        const response = await apiClient.post(`${AUTH_PREFIX}/login`, credentials);
        const { user, access_token } = response.data;

        useAuthStore.getState().setAuth(user, access_token);

        return response.data;
    },

    async getCurrentUser() {
        const response = await apiClient.get(`${AUTH_PREFIX}/me`);
        const user: User = response.data;

        if (user && localStorage.getItem('auth_token')) {
            const token = localStorage.getItem('auth_token') || "";
            useAuthStore.getState().setAuth(user, token);
        }

        return user;
    },

    async logout() {
        useAuthStore.getState().logout();
    },

    /**
     * Returns every dealership the given email is registered with, so the UI
     * can show a picker before asking for the password / sending the reset email.
     * Empty list = no account found.
     */
    async lookupDealerships(email: string): Promise<DealershipOption[]> {
        const response = await apiClient.post<{ dealerships: DealershipOption[] }>(
            `${AUTH_PREFIX}/lookup-dealerships`,
            { email },
        );
        return response.data.dealerships;
    },

    async forgotPassword(email: string, dealershipId?: string | null) {
        return apiClient.post(`${AUTH_PREFIX}/forgot-password`, {
            email,
            dealership_id: dealershipId ?? null,
        });
    }
};
