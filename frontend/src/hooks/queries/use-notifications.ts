"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    NotificationService,
    type NotificationListParams,
    type NotificationListResponse,
    type NotificationStats,
} from "@/services/notification-service"

export const notificationKeys = {
    all: ["notifications"] as const,
    lists: () => [...notificationKeys.all, "list"] as const,
    list: (params: NotificationListParams) => [...notificationKeys.lists(), params] as const,
    stats: () => [...notificationKeys.all, "stats"] as const,
}

export function useNotificationsList(params: NotificationListParams = {}, enabled = true) {
    return useQuery<NotificationListResponse>({
        queryKey: notificationKeys.list(params),
        queryFn: () => NotificationService.listNotifications(params),
        enabled,
        placeholderData: (prev) => prev,
    })
}

export function useNotificationStats(enabled = true) {
    return useQuery<NotificationStats>({
        queryKey: notificationKeys.stats(),
        queryFn: () => NotificationService.getStats(),
        enabled,
    })
}

export function useMarkNotificationRead() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => NotificationService.markAsRead(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    })
}

export function useMarkAllNotificationsRead() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => NotificationService.markAllAsRead(),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    })
}

/** Invalidate all notification queries — call on WebSocket notification events */
export function useInvalidateNotifications() {
    const queryClient = useQueryClient()
    return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all })
}
