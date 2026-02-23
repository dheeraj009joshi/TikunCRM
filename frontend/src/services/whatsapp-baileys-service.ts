/**
 * WhatsApp Baileys Service - Admin bulk messaging
 */
import apiClient from "@/lib/api-client";

export interface BaileysStatus {
  connected: boolean;
  status: string;
  phone_number?: string;
  qr_available: boolean;
}

export interface BaileysQR {
  qr?: string;
  status: string;
  connected: boolean;
}

export interface SendMessageRequest {
  phone: string;
  message: string;
  customer_id?: string;
  lead_id?: string;
}

export interface SendMessageResponse {
  success: boolean;
  message_id?: string;
  wa_message_id?: string;
  error?: string;
}

export interface BulkSendRequest {
  message: string;
  lead_statuses?: string[];
  dealership_id?: string;
  customer_ids?: string[];
  name?: string;
  min_delay?: number;
  max_delay?: number;
}

export interface BulkSendResponse {
  success: boolean;
  bulk_send_id?: string;
  total: number;
  sent: number;
  failed: number;
  error?: string;
}

export interface RecipientPreview {
  customer_id: string;
  customer_name: string;
  phone: string;
  lead_id?: string;
  lead_status?: string;
}

export interface RecipientPreviewResponse {
  recipients: RecipientPreview[];
  total: number;
}

export interface ConversationItem {
  phone_number: string;
  customer_id?: string;
  customer_name?: string;
  lead_id?: string;
  lead_name?: string;
  last_message?: string;
  last_message_at?: string;
  direction: string;
  last_message_status?: string;
  unread_count: number;
}

export interface ConversationsResponse {
  items: ConversationItem[];
  total: number;
}

export interface MessageItem {
  id: string;
  wa_message_id?: string;
  direction: string;
  body?: string;
  media_url?: string;
  media_type?: string;
  status: string;
  sent_at?: string;
  received_at?: string;
  created_at?: string;
  is_read: boolean;
}

export interface MessagesResponse {
  phone_number: string;
  customer_name?: string;
  messages: MessageItem[];
}

export interface BulkSendHistoryItem {
  id: string;
  name?: string;
  message_template: string;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  status: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
}

export interface BulkSendHistoryResponse {
  items: BulkSendHistoryItem[];
}

export interface CheckNumberResponse {
  phone: string;
  exists: boolean;
  jid?: string;
}

class WhatsAppBaileysService {
  private basePath = "/whatsapp-baileys";

  async getStatus(): Promise<BaileysStatus> {
    const response = await apiClient.get<BaileysStatus>(`${this.basePath}/status`);
    return response.data;
  }

  async getQR(): Promise<BaileysQR> {
    const response = await apiClient.get<BaileysQR>(`${this.basePath}/qr`);
    return response.data;
  }

  async disconnect(): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.post(`${this.basePath}/disconnect`);
    return response.data;
  }

  async reconnect(): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.post(`${this.basePath}/reconnect`);
    return response.data;
  }

  async checkNumber(phone: string): Promise<CheckNumberResponse> {
    const response = await apiClient.post<CheckNumberResponse>(
      `${this.basePath}/check-number`,
      { phone }
    );
    return response.data;
  }

  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await apiClient.post<SendMessageResponse>(
      `${this.basePath}/send`,
      request
    );
    return response.data;
  }

  async previewRecipients(request: BulkSendRequest): Promise<RecipientPreviewResponse> {
    const response = await apiClient.post<RecipientPreviewResponse>(
      `${this.basePath}/bulk-send/preview`,
      request
    );
    return response.data;
  }

  async sendBulk(request: BulkSendRequest): Promise<BulkSendResponse> {
    const response = await apiClient.post<BulkSendResponse>(
      `${this.basePath}/bulk-send`,
      request
    );
    return response.data;
  }

  async getConversations(
    limit: number = 50,
    offset: number = 0
  ): Promise<ConversationsResponse> {
    const response = await apiClient.get<ConversationsResponse>(
      `${this.basePath}/conversations`,
      { params: { limit, offset } }
    );
    return response.data;
  }

  async getMessages(
    phoneNumber: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<MessagesResponse> {
    const response = await apiClient.get<MessagesResponse>(
      `${this.basePath}/conversations/${encodeURIComponent(phoneNumber)}`,
      { params: { limit, offset } }
    );
    return response.data;
  }

  async getBulkSendHistory(
    limit: number = 20,
    offset: number = 0
  ): Promise<BulkSendHistoryResponse> {
    const response = await apiClient.get<BulkSendHistoryResponse>(
      `${this.basePath}/bulk-sends`,
      { params: { limit, offset } }
    );
    return response.data;
  }

  async cleanupMessages(): Promise<{
    success: boolean;
    deleted_count: number;
    normalized_count: number;
    merged_count: number;
    message: string;
  }> {
    const response = await apiClient.post(`${this.basePath}/cleanup`);
    return response.data;
  }

  async deleteAllMessages(): Promise<{
    success: boolean;
    deleted_count: number;
    message: string;
  }> {
    const response = await apiClient.delete(`${this.basePath}/messages/all`);
    return response.data;
  }
}

export const whatsappBaileysService = new WhatsAppBaileysService();
