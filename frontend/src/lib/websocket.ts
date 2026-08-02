/**
 * WebSocket Service for real-time updates
 */

import { API_BASE_URL } from "@/lib/api-client";

export interface WebSocketMessage {
    type: string;
    data?: unknown;
}

class WebSocketService {
    private ws: WebSocket | null = null;
    private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
    private reconnectAttempts = 0;
    /** Soft cap per backoff cycle; resets on successful open / tab visibility. */
    private maxReconnectAttempts = 20;
    private reconnectDelay = 1000;
    private maxReconnectDelay = 30_000;
    private userId: string | null = null;
    private token: string | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private pingWorker: Worker | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isConnecting = false;
    private lifecycleBound = false;
    private intentionalClose = false;

    /**
     * Connect to the WebSocket server
     */
    connect(userId: string, token: string): void {
        this.userId = userId;
        this.token = token;
        this.intentionalClose = false;
        this.bindLifecycleListeners();

        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log("[WS] Already connected");
            return;
        }

        if (this.ws?.readyState === WebSocket.CONNECTING || this.isConnecting) {
            console.log("[WS] Connection already in progress");
            return;
        }

        // Drop a half-closed socket before opening a new one
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                this.ws.close();
            } catch {
                /* ignore */
            }
            this.ws = null;
        }

        this.isConnecting = true;

        const wsUrl = this.getWebSocketUrl(token);
        console.log("[WS] Connecting to:", `${wsUrl.split("?")[0]}?token=***`);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log("[WS] Connected");
                this.isConnecting = false;
                this.reconnectAttempts = 0;
                this.startPingInterval();
                this.emit("connection:open", {});
            };

            this.ws.onmessage = (event) => {
                try {
                    const message: WebSocketMessage & { payload?: unknown } = JSON.parse(event.data);
                    console.log("[WS] Received:", message.type);
                    const payload = message.data !== undefined ? message.data : message.payload;
                    this.emit(message.type, payload);
                } catch {
                    // Handle non-JSON messages (like pong)
                    if (event.data === "pong") {
                        console.log("[WS] Pong received");
                    }
                }
            };

            this.ws.onclose = (event) => {
                console.log("[WS] Disconnected:", event.code, event.reason);
                this.isConnecting = false;
                this.stopPingInterval();
                this.emit("connection:close", { code: event.code, reason: event.reason });

                // Attempt reconnection if not a clean/auth close
                if (!this.intentionalClose && event.code !== 1000 && event.code !== 4001) {
                    this.attemptReconnect();
                }
            };

            this.ws.onerror = (event: Event) => {
                // Browser WebSocket error events carry almost no detail; failures usually mean
                // TLS/DNS/network, wrong API base URL, or reverse-proxy missing Upgrade headers.
                const errorInfo = {
                    type: event.type,
                    readyState: this.ws?.readyState,
                    readyStateText: this.getReadyStateText(this.ws?.readyState),
                    message:
                        "WebSocket failed to connect. Confirm the API host is reachable (same as REST), " +
                        "NEXT_PUBLIC_API_URL is correct at build time, and nginx/Caddy proxies " +
                        "/api/v1/ws with Upgrade and Connection headers.",
                };
                console.error("[WS] Error:", errorInfo);
                this.isConnecting = false;
                this.emit("connection:error", errorInfo);
            };
        } catch (error) {
            console.error("[WS] Failed to create WebSocket:", error);
            this.isConnecting = false;
        }
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect(): void {
        this.intentionalClose = true;
        this.clearReconnectTimer();
        this.stopPingInterval();
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                this.ws.close(1000, "Client disconnect");
            } catch {
                /* ignore */
            }
            this.ws = null;
        }
        this.userId = null;
        this.token = null;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
    }

    /**
     * Reconnect if the socket is not OPEN (e.g. after tab wake / network restore).
     * Resets the reconnect budget so background tabs can recover indefinitely.
     */
    ensureConnected(): void {
        if (!this.userId || !this.token) return;
        if (this.ws?.readyState === WebSocket.OPEN) return;
        if (this.ws?.readyState === WebSocket.CONNECTING || this.isConnecting) return;

        console.log("[WS] ensureConnected — reconnecting after wake/offline");
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        this.connect(this.userId, this.token);
    }

    /**
     * Get human-readable WebSocket ready state
     */
    private getReadyStateText(state: number | undefined): string {
        switch (state) {
            case WebSocket.CONNECTING: return "CONNECTING";
            case WebSocket.OPEN: return "OPEN";
            case WebSocket.CLOSING: return "CLOSING";
            case WebSocket.CLOSED: return "CLOSED";
            default: return "UNKNOWN";
        }
    }

    /**
     * Subscribe to an event
     */
    on<T = unknown>(event: string, callback: (data: T) => void): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const wrapper = (data: unknown) => {
            callback(data as T);
        };
        this.listeners.get(event)!.add(wrapper);

        return () => {
            this.listeners.get(event)?.delete(wrapper);
        };
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, callback: (data: unknown) => void): void {
        this.listeners.get(event)?.delete(callback);
    }

    /**
     * Emit an event to all listeners
     */
    private emit(event: string, data: unknown): void {
        this.listeners.get(event)?.forEach((callback) => {
            try {
                callback(data);
            } catch (listenerErr) {
                console.error(`[WS] Error in listener for ${event}:`, listenerErr);
            }
        });
    }

    /**
     * Send a message to the server
     */
    send(message: string): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        }
    }

    /**
     * Get the WebSocket URL
     */
    private getWebSocketUrl(token: string): string {
        // Same base as axios (api-client) so dev/prod never drift.
        const wsUrl = API_BASE_URL.replace(/^http/, "ws");
        return `${wsUrl}/ws?token=${encodeURIComponent(token)}`;
    }

    /**
     * Attempt to reconnect
     */
    private attemptReconnect(): void {
        if (this.intentionalClose) return;

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log("[WS] Max reconnect attempts reached — will retry on tab focus/online");
            return;
        }

        if (!this.userId || !this.token) {
            console.log("[WS] No credentials for reconnect");
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.userId && this.token && !this.intentionalClose) {
                this.connect(this.userId, this.token);
            }
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Start ping interval to keep connection alive.
     * Prefers a Web Worker so pings are not throttled in background tabs.
     */
    private startPingInterval(): void {
        this.stopPingInterval();

        const sendPing = () => {
            this.send("ping");
        };

        if (typeof Worker !== "undefined") {
            try {
                this.pingWorker = new Worker("/ws-keepalive-worker.js");
                this.pingWorker.addEventListener("message", (e) => {
                    if (e.data?.type === "ping") sendPing();
                });
                this.pingWorker.postMessage({ type: "start" });
                return;
            } catch (e) {
                console.warn("[WS] Keep-alive Worker failed, falling back to setInterval:", e);
            }
        }

        this.pingInterval = setInterval(sendPing, 30000);
    }

    /**
     * Stop ping interval
     */
    private stopPingInterval(): void {
        if (this.pingWorker) {
            try {
                this.pingWorker.postMessage({ type: "stop" });
                this.pingWorker.terminate();
            } catch {
                /* ignore */
            }
            this.pingWorker = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Reconnect when the tab wakes or network returns.
     */
    private bindLifecycleListeners(): void {
        if (this.lifecycleBound || typeof window === "undefined") return;
        this.lifecycleBound = true;

        const onWake = () => {
            if (document.visibilityState === "visible") {
                this.ensureConnected();
            }
        };

        document.addEventListener("visibilitychange", onWake);
        window.addEventListener("focus", () => this.ensureConnected());
        window.addEventListener("online", () => this.ensureConnected());
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const wsService = new WebSocketService();
