/**
 * Voice Service - API client for Twilio Voice calling
 */
import apiClient from "@/lib/api-client";

export interface VoiceConfig {
  voice_enabled: boolean;
  phone_number: string | null;
  recording_enabled: boolean;
  azure_storage_configured: boolean;
}

export interface VoiceToken {
  token: string;
  identity: string;
  expires_in: number;
}

export interface InitiateCallRequest {
  to_number: string;
  lead_id?: string;
}

export interface InitiateCallResponse {
  call_log_id: string | null;
  call_sid: string;
  status: string;
}

export interface CallLog {
  id: string;
  lead_id: string | null;
  user_id: string | null;
  dealership_id: string | null;
  twilio_call_sid: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  status: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  recording_url: string | null;
  notes: string | null;
  outcome: string | null;
  created_at: string;
  lead_name: string | null;
  user_name: string | null;
}

export interface CallLogListResponse {
  items: CallLog[];
  total: number;
  page: number;
  page_size: number;
}

export interface RecordingUrlResponse {
  recording_url: string;
  expires_in: number | null;
}

class VoiceService {
  /**
   * Get voice configuration status
   */
  async getConfig(): Promise<VoiceConfig> {
    const response = await apiClient.get<VoiceConfig>("/voice/config");
    return response.data;
  }

  /**
   * Get Twilio access token for WebRTC client
   */
  async getToken(): Promise<VoiceToken> {
    const response = await apiClient.post<VoiceToken>("/voice/token");
    return response.data;
  }

  /**
   * Initiate an outbound call
   */
  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    const response = await apiClient.post<InitiateCallResponse>("/voice/call", request);
    return response.data;
  }

  /**
   * List call history
   */
  async listCalls(params?: {
    page?: number;
    page_size?: number;
    lead_id?: string;
    direction?: string;
  }): Promise<CallLogListResponse> {
    const response = await apiClient.get<CallLogListResponse>("/voice/calls", { params });
    return response.data;
  }

  /**
   * Get a specific call log
   */
  async getCall(callId: string): Promise<CallLog> {
    const response = await apiClient.get<CallLog>(`/voice/calls/${callId}`);
    return response.data;
  }

  /**
   * Update call notes and outcome
   */
  async updateCallNotes(callId: string, data: { notes?: string; outcome?: string }): Promise<void> {
    await apiClient.patch(`/voice/calls/${callId}`, data);
  }

  /**
   * Get secure recording URL
   */
  async getRecordingUrl(callId: string): Promise<RecordingUrlResponse> {
    const response = await apiClient.get<RecordingUrlResponse>(`/voice/calls/${callId}/recording-url`);
    return response.data;
  }
}

export const voiceService = new VoiceService();
export default voiceService;
