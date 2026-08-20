import { API_BASE_URL } from "@/lib/api-client";

export interface AiConversationBrief {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  tool_traces?: Array<{
    name: string;
    args?: Record<string, unknown>;
    result_summary?: string;
  }>;
  ui_blocks?: AiUiBlock[];
  created_at: string;
}

export interface AiUiBlock {
  type: string;
  title?: string;
  total?: number;
  leads?: Array<{
    id: string;
    name: string;
    down_payment?: number | null;
    has_ssn_stip?: boolean;
    has_dl_stip?: boolean;
    stage?: string | null;
    phone?: string | null;
    priority_score?: number;
    reasons?: string[];
    rank?: number;
  }>;
  filter_params?: Record<string, string | number | boolean>;
  actions?: Array<{
    tool: string;
    summary?: string;
    args?: Record<string, unknown>;
  }>;
}

export interface AiStreamHandlers {
  onConversation?: (data: { id: string; title: string }) => void;
  onThinkingStart?: () => void;
  onThinkingDelta?: (text: string) => void;
  onThinkingDone?: (data: { duration_ms: number; text: string }) => void;
  onToolStart?: (data: { name: string; args: Record<string, unknown>; label: string }) => void;
  onToolResult?: (data: {
    name: string;
    summary: string;
    result: Record<string, unknown>;
  }) => void;
  onMessageDelta?: (text: string) => void;
  onUiBlock?: (block: AiUiBlock) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

export const AiAssistantService = {
  async status(): Promise<{ enabled: boolean; model: string }> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to load AI status");
    return res.json();
  },

  async listConversations(): Promise<AiConversationBrief[]> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/conversations`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to load conversations");
    return res.json();
  },

  async getConversation(id: string): Promise<{
    id: string;
    title: string;
    messages: AiMessage[];
  }> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/conversations/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to load conversation");
    return res.json();
  },

  async deleteConversation(id: string): Promise<void> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/conversations/${id}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to delete conversation");
  },

  async confirmActions(
    conversationId: string | null,
    actions: Array<{ tool: string; args?: Record<string, unknown>; summary?: string }>
  ): Promise<{ results: Array<Record<string, unknown>>; message?: string }> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        conversation_id: conversationId || undefined,
        actions,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Confirm failed");
    }
    return res.json();
  },

  async streamChat(
    message: string,
    conversationId: string | null,
    handlers: AiStreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId || undefined,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      handlers.onError?.(text || `Request failed (${res.status})`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;

      for (const { event, data } of parsed.events) {
        let payload: Record<string, unknown> = {};
        try {
          payload = data ? JSON.parse(data) : {};
        } catch {
          payload = { text: data };
        }

        switch (event) {
          case "conversation":
            handlers.onConversation?.(payload as { id: string; title: string });
            break;
          case "thinking_start":
            handlers.onThinkingStart?.();
            break;
          case "thinking_delta":
            handlers.onThinkingDelta?.(String(payload.text || ""));
            break;
          case "thinking_done":
            handlers.onThinkingDone?.(
              payload as { duration_ms: number; text: string }
            );
            break;
          case "tool_start":
            handlers.onToolStart?.(
              payload as { name: string; args: Record<string, unknown>; label: string }
            );
            break;
          case "tool_result":
            handlers.onToolResult?.(
              payload as {
                name: string;
                summary: string;
                result: Record<string, unknown>;
              }
            );
            break;
          case "message_delta":
            handlers.onMessageDelta?.(String(payload.text || ""));
            break;
          case "ui_block":
            handlers.onUiBlock?.(payload as AiUiBlock);
            break;
          case "done":
            handlers.onDone?.(payload);
            break;
          case "error":
            handlers.onError?.(String(payload.message || "AI error"));
            break;
        }
      }
    }
  },
};

export function buildLeadsUrlFromFilters(
  filterParams?: Record<string, string | number | boolean>
): string {
  if (!filterParams) return "/leads";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filterParams)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `/leads?${s}` : "/leads";
}
