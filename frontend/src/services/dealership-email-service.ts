import apiClient from "@/lib/api-client";

// Types
export interface DealershipEmailConfig {
    id: string;
    dealership_id: string;
    smtp_host: string;
    smtp_port: number;
    smtp_username: string;
    smtp_use_ssl: boolean;
    smtp_use_tls: boolean;
    imap_host: string | null;
    imap_port: number;
    imap_username: string | null;
    imap_use_ssl: boolean;
    from_name: string | null;
    is_verified: boolean;
    is_active: boolean;
    last_sync_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface DealershipEmailConfigCreate {
    smtp_host: string;
    smtp_port: number;
    smtp_username: string;
    smtp_password: string;
    smtp_use_ssl: boolean;
    smtp_use_tls: boolean;
    imap_host?: string | null;
    imap_port?: number;
    imap_username?: string | null;
    imap_password?: string | null;
    imap_use_ssl?: boolean;
    from_name?: string | null;
}

export interface DealershipEmailConfigUpdate {
    smtp_host?: string;
    smtp_port?: number;
    smtp_username?: string;
    smtp_password?: string;
    smtp_use_ssl?: boolean;
    smtp_use_tls?: boolean;
    imap_host?: string | null;
    imap_port?: number;
    imap_username?: string | null;
    imap_password?: string | null;
    imap_use_ssl?: boolean;
    from_name?: string | null;
    is_active?: boolean;
}

export interface EmailConfigStatus {
    has_config: boolean;
    is_verified: boolean;
    is_active: boolean;
    smtp_host: string | null;
    last_sync_at: string | null;
}

export interface EmailTestRequest {
    test_email: string;
}

export interface EmailTestResponse {
    success: boolean;
    message: string;
    details: string | null;
}

// Common SMTP presets
export const SMTP_PRESETS = {
    hostinger: {
        name: "Hostinger",
        smtp_host: "smtp.hostinger.com",
        smtp_port: 465,
        smtp_use_ssl: true,
        smtp_use_tls: false,
        imap_host: "imap.hostinger.com",
        imap_port: 993,
        imap_use_ssl: true,
    },
    gmail: {
        name: "Gmail / Google Workspace",
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
        smtp_use_ssl: false,
        smtp_use_tls: true,
        imap_host: "imap.gmail.com",
        imap_port: 993,
        imap_use_ssl: true,
    },
    outlook: {
        name: "Microsoft 365 / Outlook",
        smtp_host: "smtp-mail.outlook.com",
        smtp_port: 587,
        smtp_use_ssl: false,
        smtp_use_tls: true,
        imap_host: "outlook.office365.com",
        imap_port: 993,
        imap_use_ssl: true,
    },
    zoho: {
        name: "Zoho Mail",
        smtp_host: "smtp.zoho.com",
        smtp_port: 465,
        smtp_use_ssl: true,
        smtp_use_tls: false,
        imap_host: "imap.zoho.com",
        imap_port: 993,
        imap_use_ssl: true,
    },
} as const;

export type SmtpPresetKey = keyof typeof SMTP_PRESETS;

// Service methods
export const DealershipEmailService = {
    /**
     * Get email configuration status
     */
    async getStatus(): Promise<EmailConfigStatus> {
        const response = await apiClient.get<EmailConfigStatus>("/dealership-email/status");
        return response.data;
    },

    /**
     * Get email configuration details
     */
    async getConfig(): Promise<DealershipEmailConfig> {
        const response = await apiClient.get<DealershipEmailConfig>("/dealership-email/config");
        return response.data;
    },

    /**
     * Create or update email configuration
     */
    async saveConfig(data: DealershipEmailConfigCreate): Promise<DealershipEmailConfig> {
        const response = await apiClient.post<DealershipEmailConfig>("/dealership-email/config", data);
        return response.data;
    },

    /**
     * Partially update email configuration
     */
    async updateConfig(data: DealershipEmailConfigUpdate): Promise<DealershipEmailConfig> {
        const response = await apiClient.patch<DealershipEmailConfig>("/dealership-email/config", data);
        return response.data;
    },

    /**
     * Delete email configuration
     */
    async deleteConfig(): Promise<void> {
        await apiClient.delete("/dealership-email/config");
    },

    /**
     * Test email configuration
     */
    async testConfig(testEmail: string): Promise<EmailTestResponse> {
        const response = await apiClient.post<EmailTestResponse>("/dealership-email/test", {
            test_email: testEmail,
        });
        return response.data;
    },
};
