import apiClient from "@/lib/api-client";
import { useAuthStore, User } from "@/stores/auth-store";

const AUTH_PREFIX = "/auth";

export type DealershipOption = {
    id: string | null; // null for org-wide roles (super admin, BDC)
    name: string;
    is_super_admin: boolean;
    is_bdc?: boolean;
};

/** Form/login key sent as dealership_id to disambiguate org-wide accounts. */
export function dealershipLoginKey(option: DealershipOption): string {
    if (option.is_bdc) return "bdc";
    if (option.is_super_admin) return "super_admin";
    return option.id!;
}

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

    async forgotPassword(email: string, option?: DealershipOption | null) {
        return apiClient.post(`${AUTH_PREFIX}/forgot-password`, {
            email,
            dealership_id: option?.id ?? null,
            account_kind: option
                ? option.is_bdc
                    ? "bdc"
                    : option.is_super_admin
                      ? "super_admin"
                      : null
                : null,
        });
    },

    async getMyDealerships(): Promise<DealershipOption[]> {
        const response = await apiClient.get<{ dealerships: DealershipOption[] }>(
            `${AUTH_PREFIX}/my-dealerships`,
        );
        return response.data.dealerships;
    },

    async switchDealership(option: DealershipOption) {
        const response = await apiClient.post(`${AUTH_PREFIX}/switch-dealership`, {
            dealership_id: option.is_super_admin || option.is_bdc ? null : option.id,
            account_kind: option.is_bdc
                ? "bdc"
                : option.is_super_admin
                  ? "super_admin"
                  : null,
        });
        const { user, access_token, refresh_token } = response.data;
        useAuthStore.getState().setAuth(user, access_token, refresh_token);
        return response.data;
    },
};
