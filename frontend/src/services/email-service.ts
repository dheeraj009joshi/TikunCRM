import apiClient from "@/lib/api-client";

const EMAILS_PREFIX = "/emails";

export type TemplateCategory = 
    | "follow_up"
    | "introduction"
    | "quote"
    | "thank_you"
    | "appointment"
    | "custom";

export interface EmailTemplate {
    id: string;
    name: string;
    description?: string;
    category: TemplateCategory;
    subject: string;
    body_text?: string;
    body_html?: string;
    available_variables: string[];
    is_system: boolean;
    dealership_id?: string;
    created_by?: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface EmailTemplateListResponse {
    items: EmailTemplate[];
    total: number;
    page: number;
    page_size: number;
}

export interface EmailTemplateCreate {
    name: string;
    description?: string;
    category?: TemplateCategory;
    subject: string;
    body_text?: string;
    body_html?: string;
    available_variables?: string[];
}

export interface EmailTemplateUpdate {
    name?: string;
    description?: string;
    category?: TemplateCategory;
    subject?: string;
    body_text?: string;
    body_html?: string;
    available_variables?: string[];
    is_active?: boolean;
}

export interface EmailComposeRequest {
    to_email: string;
    cc_emails?: string[];
    bcc_emails?: string[];
    subject: string;
    body_text?: string;
    body_html?: string;
    template_id?: string;
    lead_id?: string;
}

export interface EmailSendResponse {
    success: boolean;
    message: string;
    email_log_id?: string;
    gmail_message_id?: string;
}

export interface EmailPreviewRequest {
    template_id?: string;
    subject?: string;
    body_text?: string;
    body_html?: string;
    lead_id?: string;
}

export interface EmailPreviewResponse {
    subject: string;
    body_text?: string;
    body_html?: string;
    to_email?: string;
    lead_name?: string;
}

export type EmailDeliveryStatus = 
    | 'pending'
    | 'sent'
    | 'delivered'
    | 'opened'
    | 'clicked'
    | 'bounced'
    | 'dropped'
    | 'spam'
    | 'failed';

export interface EmailLogItem {
    id: string;
    direction: 'sent' | 'received';
    from_email: string;
    to_email: string;
    subject: string;
    body?: string;
    body_html?: string;
    sent_at?: string;
    created_at: string;
    is_read: boolean;
    // SendGrid tracking fields
    delivery_status?: EmailDeliveryStatus;
    opened_at?: string;
    clicked_at?: string;
    delivered_at?: string;
    bounce_reason?: string;
    open_count?: number;
    click_count?: number;
}

export interface LeadBrief {
    id: string;
    customer?: {
        first_name: string;
        last_name?: string;
        full_name?: string;
        email?: string;
        phone?: string;
    };
}

export interface UserBrief {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role?: string;
}

export interface EmailInboxItem extends EmailLogItem {
    cc_emails?: string;
    gmail_thread_id?: string;
    received_at?: string;
    lead_id?: string;
    user_id?: string;
    lead?: LeadBrief;
    sender_user?: UserBrief;
}

export interface InboxResponse {
    items: EmailInboxItem[];
    total: number;
    unread_count: number;
    page: number;
    page_size: number;
}

export interface EmailDetail extends EmailInboxItem {
    bcc_emails?: string;
    gmail_message_id?: string;
    attachments?: unknown[];
}

export interface EmailThread {
    thread_id: string;
    subject: string;
    lead?: LeadBrief;
    emails: EmailInboxItem[];
    total_count: number;
}

export interface EmailStats {
    total_sent: number;
    total_received: number;
    unread_count: number;
    total: number;
}

export interface TemplateVariable {
    [key: string]: string;
}

export interface CategoryOption {
    value: string;
    label: string;
}

export const TEMPLATE_CATEGORIES: CategoryOption[] = [
    { value: "follow_up", label: "Follow Up" },
    { value: "introduction", label: "Introduction" },
    { value: "quote", label: "Quote" },
    { value: "thank_you", label: "Thank You" },
    { value: "appointment", label: "Appointment" },
    { value: "custom", label: "Custom" },
];

export const EmailTemplateService = {
    // List templates
    async listTemplates(params: {
        page?: number;
        page_size?: number;
        category?: TemplateCategory;
        search?: string;
    } = {}): Promise<EmailTemplateListResponse> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/templates`, { params });
        return response.data;
    },

    // Get single template
    async getTemplate(templateId: string): Promise<EmailTemplate> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/templates/${templateId}`);
        return response.data;
    },

    // Create template
    async createTemplate(data: EmailTemplateCreate): Promise<EmailTemplate> {
        const response = await apiClient.post(`${EMAILS_PREFIX}/templates`, data);
        return response.data;
    },

    // Update template
    async updateTemplate(templateId: string, data: EmailTemplateUpdate): Promise<EmailTemplate> {
        const response = await apiClient.put(`${EMAILS_PREFIX}/templates/${templateId}`, data);
        return response.data;
    },

    // Delete template
    async deleteTemplate(templateId: string): Promise<void> {
        await apiClient.delete(`${EMAILS_PREFIX}/templates/${templateId}`);
    },

    // Get available variables
    async getVariables(): Promise<TemplateVariable> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/variables`);
        return response.data;
    },

    // Get template categories
    async getCategories(): Promise<CategoryOption[]> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/categories`);
        return response.data;
    },

    // Preview email
    async previewEmail(data: EmailPreviewRequest): Promise<EmailPreviewResponse> {
        const response = await apiClient.post(`${EMAILS_PREFIX}/preview`, data);
        return response.data;
    },

    // Send email
    async sendEmail(data: EmailComposeRequest): Promise<EmailSendResponse> {
        const response = await apiClient.post(`${EMAILS_PREFIX}/send`, data);
        return response.data;
    },

    // Get lead email history
    async getLeadEmailHistory(leadId: string, params: {
        page?: number;
        page_size?: number;
    } = {}): Promise<{ items: EmailLogItem[]; total: number; page: number; page_size: number }> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/lead/${leadId}/history`, { params });
        return response.data;
    },

    // ============== Inbox / Communications ==============

    // Get email inbox
    async getInbox(params: {
        page?: number;
        page_size?: number;
        direction?: 'sent' | 'received';
        search?: string;
        unread_only?: boolean;
    } = {}): Promise<InboxResponse> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/inbox`, { params });
        return response.data;
    },

    // Get single email detail
    async getEmailDetail(emailId: string): Promise<EmailDetail> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/inbox/${emailId}`);
        return response.data;
    },

    // Get email thread
    async getEmailThread(threadId: string): Promise<EmailThread> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/inbox/thread/${threadId}`);
        return response.data;
    },

    // Mark email as read/unread
    async markEmailRead(emailId: string, isRead: boolean = true): Promise<void> {
        await apiClient.patch(`${EMAILS_PREFIX}/inbox/${emailId}/read`, null, {
            params: { is_read: isRead }
        });
    },

    // Reply to email
    async replyToEmail(originalEmailId: string, bodyText: string, bodyHtml?: string): Promise<EmailSendResponse> {
        const response = await apiClient.post(`${EMAILS_PREFIX}/inbox/reply`, null, {
            params: {
                original_email_id: originalEmailId,
                body_text: bodyText,
                body_html: bodyHtml
            }
        });
        return response.data;
    },

    // Get email stats
    async getEmailStats(): Promise<EmailStats> {
        const response = await apiClient.get(`${EMAILS_PREFIX}/inbox/stats`);
        return response.data;
    }
};
