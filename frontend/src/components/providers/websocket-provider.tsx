"use client";

import * as React from "react";
import { useWebSocketConnection } from "@/hooks/use-websocket";

interface WebSocketContextValue {
    isConnected: boolean;
}

const WebSocketContext = React.createContext<WebSocketContextValue>({
    isConnected: false,
});

export function useWebSocket() {
    return React.useContext(WebSocketContext);
}

interface WebSocketProviderProps {
    children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
    const { isConnected } = useWebSocketConnection();

    return (
        <WebSocketContext.Provider value={{ isConnected }}>
            {children}
        </WebSocketContext.Provider>
    );
}
