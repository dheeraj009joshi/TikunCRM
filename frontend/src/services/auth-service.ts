import apiClient from "@/lib/api-client";
import { useAuthStore, User } from "@/stores/auth-store";

const AUTH_PREFIX = "/auth";

export const AuthService = {
    async login(credentials: { email: string; password: string }) {
        const response = await apiClient.post(`${AUTH_PREFIX}/login`, credentials);
        const { user, access_token } = response.data;

        // Update store
        useAuthStore.getState().setAuth(user, access_token);

        return response.data;
    },

    async getCurrentUser() {
        const response = await apiClient.get(`${AUTH_PREFIX}/me`);
        const user: User = response.data;

        // Update store if token exists but user doesn't
        if (user && localStorage.getItem('auth_token')) {
            const token = localStorage.getItem('auth_token') || "";
            useAuthStore.getState().setAuth(user, token);
        }

        return user;
    },

    async logout() {
        useAuthStore.getState().logout();
    },

    async forgotPassword(email: string) {
        return apiClient.post(`${AUTH_PREFIX}/forgot-password`, { email });
    }
};
