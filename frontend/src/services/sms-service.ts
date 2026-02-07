/**
 * SMS Service - API client for SMS messaging
 */
import apiClient from "@/lib/api-client";

export interface SMSConfig {
  sms_enabled: boolean;
  phone_number: string | null;
}

export interface SendSMSRequest {
  to_number: string;
  body: string;
  lead_id?: string;
}

export interface SendSMSResponse {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface SMSMessage {
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

export interface Conversation {
  lead_id: string;
  lead_name: string;
  lead_phone: string | null;
  messages: SMSMessage[];
}

export interface ConversationListItem {
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

export interface ConversationsListResponse {
  items: ConversationListItem[];
  total_unread: number;
}

class SMSService {
  /**
   * Get SMS configuration status
   */
  async getConfig(): Promise<SMSConfig> {
    const response = await apiClient.get<SMSConfig>("/sms/config");
    return response.data;
  }

  /**
   * Send an SMS message
   */
  async sendSMS(request: SendSMSRequest): Promise<SendSMSResponse> {
    const response = await apiClient.post<SendSMSResponse>("/sms/send", request);
    return response.data;
  }

  /**
   * List SMS conversations
   */
  async listConversations(params?: {
    unread_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ConversationsListResponse> {
    const response = await apiClient.get<ConversationsListResponse>("/sms/conversations", { params });
    return response.data;
  }

  /**
   * Get conversation with a lead
   */
  async getConversation(leadId: string, params?: {
    limit?: number;
    before?: string;
  }): Promise<Conversation> {
    const response = await apiClient.get<Conversation>(`/sms/conversations/${leadId}`, { params });
    return response.data;
  }

  /**
   * Send SMS to a specific lead
   */
  async sendToLead(leadId: string, body: string): Promise<SendSMSResponse> {
    const response = await apiClient.post<SendSMSResponse>(
      `/sms/conversations/${leadId}/send`,
      { body, to_number: "" }  // to_number not needed for lead
    );
    return response.data;
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await apiClient.patch(`/sms/messages/${messageId}/read`);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<{ count: number }>("/sms/unread-count");
    return response.data.count;
  }
}

export const smsService = new SMSService();
export default smsService;
