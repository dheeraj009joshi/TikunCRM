/**
 * WhatsApp Service - API client for WhatsApp messaging
 */
import apiClient from "@/lib/api-client";

export interface WhatsAppConfig {
  whatsapp_enabled: boolean;
  phone_number: string | null;
}

export interface SendWhatsAppRequest {
  to_number: string;
  body?: string;
  lead_id?: string;
  content_sid?: string;
  content_variables?: Record<string, string>;
}

export interface SendWhatsAppResponse {
  success: boolean;
  message_id?: string;
  error?: string;
  error_code?: string;
}

export interface WhatsAppMessage {
  id: string;
  lead_id: string | null;
  user_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  status: string;
  is_read: boolean;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface WhatsAppConversation {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  messages: WhatsAppMessage[];
}

export interface WhatsAppConversationListItem {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  last_message: {
    id: string;
    body: string;
    direction: string;
    created_at: string;
    status: string;
  };
  unread_count: number;
}

export interface WhatsAppConversationsListResponse {
  items: WhatsAppConversationListItem[];
  total_unread: number;
}

export interface WhatsAppLeadSearchItem {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
}

export interface SessionWindowResponse {
  within_window: boolean;
  last_inbound_at: string | null;
}

export interface WhatsAppTemplateItem {
  id: string;
  content_sid: string;
  name: string;
  variable_names: string[];
}

export interface WhatsAppTemplatesListResponse {
  items: WhatsAppTemplateItem[];
}

class WhatsAppService {
  async getConfig(): Promise<WhatsAppConfig> {
    const response = await apiClient.get<WhatsAppConfig>("/whatsapp/config");
    return response.data;
  }

  async sendWhatsApp(request: SendWhatsAppRequest): Promise<SendWhatsAppResponse> {
    const response = await apiClient.post<SendWhatsAppResponse>("/whatsapp/send", request);
    return response.data;
  }

  async listConversations(params?: {
    unread_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<WhatsAppConversationsListResponse> {
    const response = await apiClient.get<WhatsAppConversationsListResponse>("/whatsapp/conversations", { params });
    return response.data;
  }

  async getConversation(leadId: string, params?: {
    limit?: number;
    before?: string;
  }): Promise<WhatsAppConversation> {
    const response = await apiClient.get<WhatsAppConversation>(`/whatsapp/conversations/${leadId}`, { params });
    return response.data;
  }

  async sendToLead(leadId: string, body: string, toNumber?: string): Promise<SendWhatsAppResponse> {
    const response = await apiClient.post<SendWhatsAppResponse>(
      `/whatsapp/conversations/${leadId}/send`,
      { body, to_number: toNumber ?? "" }
    );
    return response.data;
  }

  async sendTemplateToLead(
    leadId: string,
    contentSid: string,
    contentVariables: Record<string, string>,
    toNumber?: string
  ): Promise<SendWhatsAppResponse> {
    const response = await apiClient.post<SendWhatsAppResponse>(
      `/whatsapp/conversations/${leadId}/send`,
      {
        to_number: toNumber ?? "",
        content_sid: contentSid,
        content_variables: contentVariables,
      }
    );
    return response.data;
  }

  async getSessionWindow(leadId: string): Promise<SessionWindowResponse> {
    const response = await apiClient.get<SessionWindowResponse>(
      `/whatsapp/conversations/${leadId}/session-window`
    );
    return response.data;
  }

  async listTemplates(): Promise<WhatsAppTemplateItem[]> {
    const response = await apiClient.get<WhatsAppTemplatesListResponse>("/whatsapp/templates");
    return response.data.items;
  }

  async markAsRead(messageId: string): Promise<void> {
    await apiClient.patch(`/whatsapp/messages/${messageId}/read`);
  }

  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<{ count: number }>("/whatsapp/unread-count");
    return response.data.count;
  }

  /** Search leads by name or phone for starting a new WhatsApp chat */
  async searchLeads(q: string, limit = 20): Promise<WhatsAppLeadSearchItem[]> {
    if (!q.trim()) return [];
    const response = await apiClient.get<WhatsAppLeadSearchItem[]>("/whatsapp/leads/search", {
      params: { q: q.trim(), limit },
    });
    return response.data;
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
