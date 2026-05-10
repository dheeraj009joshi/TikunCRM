/**
 * Auto WhatsApp Service - API client for Selenium-based bulk WhatsApp messaging
 */
import apiClient from "@/lib/api-client";

// ==================== PROFILE TYPES ====================

export interface AutoWhatsAppProfile {
  id: string;
  dealership_id: string;
  dealership_name: string | null;
  phone_number: string | null;
  status: "disconnected" | "connecting" | "connected" | "qr_ready" | "error";
  last_connected_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutoWhatsAppProfileSetupResponse {
  profile_id: string;
  status: string;
  message: string;
  qr_code_base64: string | null;
}

export interface AutoWhatsAppProfileStatusResponse {
  profile_id: string;
  status: string;
  phone_number: string | null;
  is_connected: boolean;
  error_message: string | null;
}

// ==================== LEAD PREVIEW TYPES ====================

export interface LeadPreviewFilter {
  stage_ids?: string[];
  campaign_ids?: string[];
  source?: string;
  salesperson_id?: string;
  is_active?: boolean;
  has_phone?: boolean;
  created_after?: string;
  created_before?: string;
  search?: string;
}

export interface LeadPreviewItem {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  stage_name: string | null;
  stage_color: string | null;
  source: string | null;
  interested_in: string | null;
  created_at: string;
}

export interface LeadPreviewResponse {
  leads: LeadPreviewItem[];
  total_count: number;
  has_phone_count: number;
  missing_phone_count: number;
}

// ==================== JOB TYPES ====================

export interface AutoWhatsAppJobCreate {
  name: string;
  message_text: string;
  lead_ids: string[];
  filter_criteria?: Record<string, unknown>;
}

export interface AutoWhatsAppJob {
  id: string;
  dealership_id: string;
  profile_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  name: string;
  message_text: string;
  status: "pending" | "running" | "paused" | "completed" | "cancelled" | "failed";
  total_leads: number;
  sent_count: number;
  failed_count: number;
  remaining_count: number;
  progress_percent: number;
  current_index: number;
  error_count: number;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutoWhatsAppJobError {
  lead_id: string;
  lead_name: string;
  phone: string;
  error: string;
  timestamp: string;
}

export interface AutoWhatsAppJobLog {
  id: string;
  job_id: string;
  action: string;
  message: string;
  meta_data: Record<string, unknown> | null;
  created_at: string;
}

export interface AutoWhatsAppJobDetail extends AutoWhatsAppJob {
  lead_ids: string[];
  filter_criteria: Record<string, unknown> | null;
  errors: AutoWhatsAppJobError[];
  logs: AutoWhatsAppJobLog[];
}

export interface AutoWhatsAppJobListResponse {
  jobs: AutoWhatsAppJob[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AutoWhatsAppJobActionResponse {
  job_id: string;
  status: string;
  message: string;
  sent_count: number;
  failed_count: number;
}

// ==================== WEBSOCKET MESSAGE TYPES ====================

export type WSMessage =
  | WSProgressMessage
  | WSErrorMessage
  | WSStateChangeMessage
  | WSHeartbeatMessage
  | WSStatusMessage;

export interface WSProgressMessage {
  type: "progress";
  job_id: string;
  status: string;
  sent: number;
  failed: number;
  total: number;
  current_index: number;
  current_lead_name?: string;
  percent: number;
}

export interface WSErrorMessage {
  type: "error";
  job_id: string;
  lead_id: string;
  lead_name?: string;
  phone?: string;
  error: string;
  timestamp: string;
}

export interface WSStateChangeMessage {
  type: "started" | "paused" | "resumed" | "completed" | "cancelled" | "failed";
  job_id: string;
  status: string;
  sent: number;
  failed: number;
  message?: string;
  at_index?: number;
  duration_seconds?: number;
}

export interface WSHeartbeatMessage {
  type: "heartbeat";
}

export interface WSStatusMessage {
  type: "status";
  job_id: string;
  status: string;
  sent: number;
  failed: number;
  total: number;
  percent: number;
}

// ==================== SERVICE CLASS ====================

class AutoWhatsAppService {
  // ==================== PROFILE METHODS ====================

  /**
   * Get the WhatsApp profile for current dealership
   * @param verify - If true, actually opens browser to verify session (slower, 10-15s)
   */
  async getProfile(verify: boolean = false): Promise<AutoWhatsAppProfile> {
    const response = await apiClient.get<AutoWhatsAppProfile>("/auto-whatsapp/profile", {
      params: { verify },
    });
    return response.data;
  }

  /**
   * Start profile setup (generates QR code)
   */
  async setupProfile(): Promise<AutoWhatsAppProfileSetupResponse> {
    const response = await apiClient.post<AutoWhatsAppProfileSetupResponse>("/auto-whatsapp/profile/setup");
    return response.data;
  }

  /**
   * Get current QR code or check login status
   */
  async getQRCode(): Promise<AutoWhatsAppProfileSetupResponse> {
    const response = await apiClient.get<AutoWhatsAppProfileSetupResponse>("/auto-whatsapp/profile/qr");
    return response.data;
  }

  /**
   * Verify profile connection status
   */
  async verifyProfile(): Promise<AutoWhatsAppProfileStatusResponse> {
    const response = await apiClient.post<AutoWhatsAppProfileStatusResponse>("/auto-whatsapp/profile/verify");
    return response.data;
  }

  /**
   * Delete the WhatsApp profile
   */
  async deleteProfile(): Promise<void> {
    await apiClient.delete("/auto-whatsapp/profile");
  }

  // ==================== LEAD PREVIEW METHODS ====================

  /**
   * Preview leads matching filters
   */
  async previewLeads(filters: LeadPreviewFilter, limit: number = 500): Promise<LeadPreviewResponse> {
    const response = await apiClient.post<LeadPreviewResponse>(
      "/auto-whatsapp/leads/preview",
      filters,
      { params: { limit } }
    );
    return response.data;
  }

  // ==================== JOB METHODS ====================

  /**
   * Create a new bulk send job
   */
  async createJob(request: AutoWhatsAppJobCreate): Promise<AutoWhatsAppJob> {
    const response = await apiClient.post<AutoWhatsAppJob>("/auto-whatsapp/jobs", request);
    return response.data;
  }

  /**
   * List jobs for the dealership
   */
  async listJobs(params?: {
    status?: string;
    page?: number;
    page_size?: number;
  }): Promise<AutoWhatsAppJobListResponse> {
    const response = await apiClient.get<AutoWhatsAppJobListResponse>("/auto-whatsapp/jobs", { params });
    return response.data;
  }

  /**
   * Get job details
   */
  async getJob(jobId: string): Promise<AutoWhatsAppJobDetail> {
    const response = await apiClient.get<AutoWhatsAppJobDetail>(`/auto-whatsapp/jobs/${jobId}`);
    return response.data;
  }

  /**
   * Pause a running job
   */
  async pauseJob(jobId: string): Promise<AutoWhatsAppJobActionResponse> {
    const response = await apiClient.post<AutoWhatsAppJobActionResponse>(`/auto-whatsapp/jobs/${jobId}/pause`);
    return response.data;
  }

  /**
   * Resume a paused job
   */
  async resumeJob(jobId: string): Promise<AutoWhatsAppJobActionResponse> {
    const response = await apiClient.post<AutoWhatsAppJobActionResponse>(`/auto-whatsapp/jobs/${jobId}/resume`);
    return response.data;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<AutoWhatsAppJobActionResponse> {
    const response = await apiClient.post<AutoWhatsAppJobActionResponse>(`/auto-whatsapp/jobs/${jobId}/cancel`);
    return response.data;
  }

  // ==================== WEBSOCKET METHODS ====================

  /**
   * Create a WebSocket connection for job progress updates
   */
  createJobWebSocket(jobId: string): WebSocket {
    const token = localStorage.getItem("auth_token");
    // NEXT_PUBLIC_API_URL already includes /api/v1, so we just replace http with ws
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.tikuncrm.com/api/v1";
    const wsUrl = baseUrl.replace(/^http/, "ws");
    const wsEndpoint = `${wsUrl}/auto-whatsapp/jobs/${jobId}/ws`;
    
    const ws = new WebSocket(wsEndpoint);
    
    // Keep-alive ping
    let pingInterval: NodeJS.Timeout | null = null;
    
    ws.onopen = () => {
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 25000);
    };
    
    ws.onclose = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
      }
    };
    
    return ws;
  }
}

export const autoWhatsAppService = new AutoWhatsAppService();
