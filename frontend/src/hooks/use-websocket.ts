/**
 * React hooks for WebSocket functionality
 */
import { useEffect, useCallback, useState } from "react";
import { wsService } from "@/lib/websocket";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Hook to connect to WebSocket when user is authenticated
 */
export function useWebSocketConnection() {
    const user = useAuthStore((state) => state.user);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!user?.id) {
            wsService.disconnect();
            setIsConnected(false);
            return;
        }

        const token = localStorage.getItem("auth_token");
        if (!token) {
            return;
        }

        // Connect
        wsService.connect(user.id, token);

        // Listen for connection events
        const unsubOpen = wsService.on("connection:open", () => {
            setIsConnected(true);
        });

        const unsubClose = wsService.on("connection:close", () => {
            setIsConnected(false);
        });

        return () => {
            unsubOpen();
            unsubClose();
        };
    }, [user?.id]);

    return { isConnected };
}

/**
 * Hook to subscribe to a specific WebSocket event
 */
export function useWebSocketEvent<T = any>(
    event: string,
    callback: (data: T) => void,
    deps: any[] = []
) {
    // Memoize callback to prevent unnecessary re-subscriptions
    const memoizedCallback = useCallback(callback, deps);

    useEffect(() => {
        const unsubscribe = wsService.on(event, memoizedCallback);
        return unsubscribe;
    }, [event, memoizedCallback]);
}

/**
 * Hook for notification events
 */
export function useNotificationEvents(onNewNotification: (notification: any) => void) {
    useWebSocketEvent("notification:new", onNewNotification, [onNewNotification]);
}

/**
 * Hook for lead update events
 */
export function useLeadUpdateEvents(
    leadId: string | null,
    onUpdate: (data: any) => void
) {
    useWebSocketEvent(
        "lead:updated",
        (data) => {
            // Only call handler if this is for the current lead
            if (!leadId || data.lead_id === leadId) {
                onUpdate(data);
            }
        },
        [leadId, onUpdate]
    );
}

/**
 * Hook for sidebar badge refresh events (unassigned count, notifications, etc.)
 */
export function useBadgesRefresh(
    onRefresh: (data: { unassigned?: boolean; notifications?: boolean }) => void
) {
    useWebSocketEvent("badges:refresh", onRefresh, [onRefresh]);
}

/**
 * Hook for activity events on a lead
 */
export function useActivityEvents(
    leadId: string | null,
    onNewActivity: (activity: any) => void
) {
    useWebSocketEvent(
        "activity:new",
        (data) => {
            // Only call handler if this is for the current lead
            if (!leadId || data.lead_id === leadId) {
                onNewActivity(data);
            }
        },
        [leadId, onNewActivity]
    );
}
