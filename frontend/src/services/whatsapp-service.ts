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
  media_urls?: string[];
  media_content_types?: string[];
}

/** Get the proxied URL for a WhatsApp media item */
export function getMediaProxyUrl(messageId: string, mediaIndex: number): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
  return `${apiUrl}/whatsapp/media/${messageId}/${mediaIndex}`;
}

/** Helper to determine media type category */
export function getMediaCategory(contentType: string): "image" | "video" | "audio" | "document" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "document";
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
  dealership_id?: string | null;
}

export interface WhatsAppTemplatesListResponse {
  items: WhatsAppTemplateItem[];
}

export interface CreateWhatsAppTemplateRequest {
  content_sid: string;
  name: string;
  variable_names?: string[];
  dealership_id?: string | null;
}

export interface UpdateWhatsAppTemplateRequest {
  content_sid?: string;
  name?: string;
  variable_names?: string[];
  dealership_id?: string | null;
}

export interface BulkSendRequest {
  campaign_mapping_id?: string;
  lead_ids?: string[];
  content_sid: string;
  content_variables?: Record<string, string>;
  name?: string;
}

export interface BulkSendResponse {
  id: string;
  status: string;
  total_recipients: number;
  message: string;
}

export interface BulkSendStatusResponse {
  id: string;
  name: string | null;
  status: string;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface UploadMediaResponse {
  url: string;
  content_type: string;
  filename: string;
}

export interface SendMediaRequest {
  media_url: string;
  content_type?: string;
  caption?: string;
}

export interface CallLogItem {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  status: string;
  duration_seconds: number;
  recording_url: string | null;
  recording_duration_seconds: number | null;
  notes: string | null;
  outcome: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

export interface TimelineItem {
  item_type: "message" | "call";
  id: string;
  created_at: string;
  message?: WhatsAppMessage;
  call?: CallLogItem;
}

export interface TimelineResponse {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  items: TimelineItem[];
  has_more: boolean;
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

  async getTemplate(templateId: string): Promise<WhatsAppTemplateItem> {
    const response = await apiClient.get<WhatsAppTemplateItem>(`/whatsapp/templates/${templateId}`);
    return response.data;
  }

  async createTemplate(data: CreateWhatsAppTemplateRequest): Promise<WhatsAppTemplateItem> {
    const response = await apiClient.post<WhatsAppTemplateItem>("/whatsapp/templates", data);
    return response.data;
  }

  async updateTemplate(templateId: string, data: UpdateWhatsAppTemplateRequest): Promise<WhatsAppTemplateItem> {
    const response = await apiClient.put<WhatsAppTemplateItem>(`/whatsapp/templates/${templateId}`, data);
    return response.data;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await apiClient.delete(`/whatsapp/templates/${templateId}`);
  }

  async initiateBulkSend(data: BulkSendRequest): Promise<BulkSendResponse> {
    const response = await apiClient.post<BulkSendResponse>("/whatsapp/bulk-send", data);
    return response.data;
  }

  async listBulkSends(params?: { limit?: number; offset?: number }): Promise<BulkSendStatusResponse[]> {
    const response = await apiClient.get<BulkSendStatusResponse[]>("/whatsapp/bulk-sends", { params });
    return response.data;
  }

  async getBulkSendStatus(bulkSendId: string): Promise<BulkSendStatusResponse> {
    const response = await apiClient.get<BulkSendStatusResponse>(`/whatsapp/bulk-sends/${bulkSendId}`);
    return response.data;
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

  /** Upload media file for sending via WhatsApp */
  async uploadMedia(file: File): Promise<UploadMediaResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<UploadMediaResponse>("/whatsapp/upload-media", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  }

  /** Send media to a lead */
  async sendMediaToLead(
    leadId: string,
    mediaUrl: string,
    contentType?: string,
    caption?: string
  ): Promise<SendWhatsAppResponse> {
    const response = await apiClient.post<SendWhatsAppResponse>(
      `/whatsapp/conversations/${leadId}/send-media`,
      { media_url: mediaUrl, content_type: contentType, caption }
    );
    return response.data;
  }

  /** Get unified timeline of messages and calls */
  async getTimeline(leadId: string, limit = 50): Promise<TimelineResponse> {
    const response = await apiClient.get<TimelineResponse>(
      `/whatsapp/conversations/${leadId}/timeline`,
      { params: { limit } }
    );
    return response.data;
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
