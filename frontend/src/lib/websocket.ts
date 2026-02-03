/**
 * WebSocket Service for real-time updates
 */

type EventCallback = (data: any) => void;

export interface WebSocketMessage {
    type: string;
    data: any;
}

class WebSocketService {
    private ws: WebSocket | null = null;
    private listeners: Map<string, Set<EventCallback>> = new Map();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000;
    private userId: string | null = null;
    private token: string | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private isConnecting = false;

    /**
     * Connect to the WebSocket server
     */
    connect(userId: string, token: string): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log("[WS] Already connected");
            return;
        }

        if (this.isConnecting) {
            console.log("[WS] Connection already in progress");
            return;
        }

        this.userId = userId;
        this.token = token;
        this.isConnecting = true;

        const wsUrl = this.getWebSocketUrl(token);
        console.log("[WS] Connecting to:", wsUrl.replace(token, "***"));

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
                    const message: WebSocketMessage = JSON.parse(event.data);
                    console.log("[WS] Received:", message.type);
                    this.emit(message.type, message.data);
                } catch (e) {
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
                
                // Attempt reconnection if not a clean close
                if (event.code !== 1000 && event.code !== 4001) {
                    this.attemptReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error("[WS] Error:", error);
                this.isConnecting = false;
                this.emit("connection:error", { error });
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
        this.stopPingInterval();
        if (this.ws) {
            this.ws.close(1000, "Client disconnect");
            this.ws = null;
        }
        this.userId = null;
        this.token = null;
        this.reconnectAttempts = 0;
    }

    /**
     * Subscribe to an event
     */
    on(event: string, callback: EventCallback): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, callback: EventCallback): void {
        this.listeners.get(event)?.delete(callback);
    }

    /**
     * Emit an event to all listeners
     */
    private emit(event: string, data: any): void {
        this.listeners.get(event)?.forEach((callback) => {
            try {
                callback(data);
            } catch (e) {
                console.error(`[WS] Error in listener for ${event}:`, e);
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";
        // Convert http(s) to ws(s)
        const wsUrl = apiUrl.replace(/^http/, "ws");
        return `${wsUrl}/ws?token=${token}`;
    }

    /**
     * Attempt to reconnect
     */
    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log("[WS] Max reconnect attempts reached");
            return;
        }

        if (!this.userId || !this.token) {
            console.log("[WS] No credentials for reconnect");
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (this.userId && this.token) {
                this.connect(this.userId, this.token);
            }
        }, delay);
    }

    /**
     * Start ping interval to keep connection alive
     */
    private startPingInterval(): void {
        this.stopPingInterval();
        this.pingInterval = setInterval(() => {
            this.send("ping");
        }, 30000); // Ping every 30 seconds
    }

    /**
     * Stop ping interval
     */
    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
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
