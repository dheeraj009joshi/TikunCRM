"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface WhatsAppSocketMessage {
  id: string;
  phone: string;
  remoteJid: string;
  isGroup: boolean;
  content: string;
  mediaType?: string;
  mediaUrl?: string;
  timestamp: number;
  pushName?: string;
}

export interface WhatsAppSocketStatus {
  isConnected: boolean;
  state: string;
  phoneNumber?: string;
  hasQr: boolean;
  qr?: string;
}

export interface MessageStatusUpdate {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  remoteJid: string;
}

export interface PresenceUpdate {
  phone: string;
  remoteJid: string;
  presence: "available" | "unavailable" | "composing" | "recording" | "paused";
  lastSeen?: number;
}

export interface MessageSentUpdate {
  messageId: string;
  waMessageId: string;
  phone: string;
  status: string;
  timestamp: number;
}

interface UseWhatsAppSocketOptions {
  url?: string;
  onMessage?: (message: WhatsAppSocketMessage) => void;
  onStatusChange?: (status: WhatsAppSocketStatus) => void;
  onMessageStatus?: (update: MessageStatusUpdate) => void;
  onPresenceUpdate?: (update: PresenceUpdate) => void;
  onMessageSent?: (update: MessageSentUpdate) => void;
  enabled?: boolean;
}

interface UseWhatsAppSocketReturn {
  isConnected: boolean;
  whatsappStatus: WhatsAppSocketStatus | null;
  lastMessage: WhatsAppSocketMessage | null;
  lastStatusUpdate: MessageStatusUpdate | null;
  lastPresenceUpdate: PresenceUpdate | null;
  reconnect: () => void;
}

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWhatsAppSocket({
  url = "ws://localhost:3001/ws",
  onMessage,
  onStatusChange,
  onMessageStatus,
  onPresenceUpdate,
  onMessageSent,
  enabled = true,
}: UseWhatsAppSocketOptions = {}): UseWhatsAppSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppSocketStatus | null>(null);
  const [lastMessage, setLastMessage] = useState<WhatsAppSocketMessage | null>(null);
  const [lastStatusUpdate, setLastStatusUpdate] = useState<MessageStatusUpdate | null>(null);
  const [lastPresenceUpdate, setLastPresenceUpdate] = useState<PresenceUpdate | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Store callbacks in refs to avoid reconnecting when they change
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  const onMessageStatusRef = useRef(onMessageStatus);
  const onPresenceUpdateRef = useRef(onPresenceUpdate);
  const onMessageSentRef = useRef(onMessageSent);
  
  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  
  useEffect(() => {
    onMessageStatusRef.current = onMessageStatus;
  }, [onMessageStatus]);
  
  useEffect(() => {
    onPresenceUpdateRef.current = onPresenceUpdate;
  }, [onPresenceUpdate]);
  
  useEffect(() => {
    onMessageSentRef.current = onMessageSent;
  }, [onMessageSent]);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("WhatsApp WebSocket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onclose = () => {
        console.log("WhatsApp WebSocket disconnected");
        setIsConnected(false);
        wsRef.current = null;

        if (enabled && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = RECONNECT_DELAY * Math.min(reconnectAttemptsRef.current, 5);
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error("WhatsApp WebSocket error:", error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "status": {
              const status: WhatsAppSocketStatus = {
                isConnected: data.data?.isConnected || data.status === "connected",
                state: data.status || data.data?.state || "unknown",
                phoneNumber: data.data?.phoneNumber,
                hasQr: data.data?.hasQr || data.status === "qr",
                qr: data.data?.qr,
              };
              setWhatsappStatus(status);
              onStatusChangeRef.current?.(status);
              break;
            }

            case "message": {
              const message: WhatsAppSocketMessage = {
                id: data.data?.id,
                phone: data.data?.phone?.replace("@s.whatsapp.net", "") || "",
                remoteJid: data.data?.remoteJid || "",
                isGroup: data.data?.isGroup || false,
                content: data.data?.content || "",
                mediaType: data.data?.mediaType,
                mediaUrl: data.data?.mediaUrl,
                timestamp: data.data?.timestamp || Date.now(),
                pushName: data.data?.pushName,
              };
              setLastMessage(message);
              onMessageRef.current?.(message);
              break;
            }

            case "message_status": {
              const statusUpdate: MessageStatusUpdate = {
                messageId: data.data?.messageId || data.messageId,
                status: data.data?.status || data.status,
                remoteJid: data.data?.remoteJid || data.remoteJid,
              };
              setLastStatusUpdate(statusUpdate);
              onMessageStatusRef.current?.(statusUpdate);
              break;
            }

            case "presence": {
              const presenceUpdate: PresenceUpdate = {
                phone: data.data?.phone?.replace(/\D/g, "") || "",
                remoteJid: data.data?.remoteJid || "",
                presence: data.data?.presence || "unavailable",
                lastSeen: data.data?.lastSeen,
              };
              setLastPresenceUpdate(presenceUpdate);
              onPresenceUpdateRef.current?.(presenceUpdate);
              break;
            }

            case "message_sent": {
              const sentUpdate: MessageSentUpdate = {
                messageId: data.data?.messageId,
                waMessageId: data.data?.waMessageId,
                phone: data.data?.phone?.replace(/\D/g, "") || "",
                status: data.data?.status || "sent",
                timestamp: data.data?.timestamp || Date.now(),
              };
              onMessageSentRef.current?.(sentUpdate);
              break;
            }

            default:
              console.log("Unknown WebSocket message type:", data.type, data);
          }
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Failed to create WebSocket connection:", err);
    }
  }, [url, enabled]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected,
    whatsappStatus,
    lastMessage,
    lastStatusUpdate,
    lastPresenceUpdate,
    reconnect,
  };
}
