import apiClient from "@/lib/api-client";

// Types
export interface UserEmailConfig {
    email: string | null;
    email_config_verified: boolean;
    has_password: boolean;
    last_sync_at: string | null;
}

export interface UserEmailConfigUpdate {
    email: string;
    password: string;
}

export interface ViewPasswordResponse {
    password: string;
}

export interface EmailTestResponse {
    success: boolean;
    message: string;
    details?: {
        sending: { success: boolean; message: string };
        receiving: { success: boolean; message: string };
    };
}

// Service methods
export const UserEmailService = {
    /**
     * Get current user's email configuration
     */
    async getConfig(): Promise<UserEmailConfig> {
        const response = await apiClient.get<UserEmailConfig>("/user-email/config");
        return response.data;
    },

    /**
     * Save email configuration
     */
    async saveConfig(data: UserEmailConfigUpdate): Promise<UserEmailConfig> {
        const response = await apiClient.post<UserEmailConfig>("/user-email/config", data);
        return response.data;
    },

    /**
     * View password (requires account password)
     */
    async viewPassword(accountPassword: string): Promise<ViewPasswordResponse> {
        const response = await apiClient.post<ViewPasswordResponse>("/user-email/view-password", {
            account_password: accountPassword,
        });
        return response.data;
    },

    /**
     * Test email configuration (tests both sending and receiving)
     */
    async testConfig(testEmail: string): Promise<EmailTestResponse> {
        const response = await apiClient.post<EmailTestResponse>("/user-email/test", {
            test_email: testEmail,
        });
        return response.data;
    },

    /**
     * Delete email configuration
     */
    async deleteConfig(): Promise<void> {
        await apiClient.delete("/user-email/config");
    },

    /**
     * Manually sync inbox now
     */
    async syncNow(): Promise<{ success: boolean; message: string; stats?: any }> {
        const response = await apiClient.post("/user-email/sync");
        return response.data;
    },
};
