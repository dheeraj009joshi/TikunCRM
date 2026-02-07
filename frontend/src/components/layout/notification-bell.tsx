"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    Bell,
    Mail,
    UserPlus,
    RefreshCw,
    Clock,
    AlertCircle,
    AlertTriangle,
    Info,
    AtSign,
    Check,
    CheckCheck,
    Loader2,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useNotificationEvents } from "@/hooks/use-websocket"
import { formatRelativeTimeInTimezone } from "@/utils/timezone"

import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

import {
    NotificationService,
    Notification,
    NotificationType,
    normalizeNotificationType,
} from "@/services/notification-service"

// Icon mapping for notification types
const typeIcons: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
    email_received: Mail,
    lead_assigned: UserPlus,
    lead_updated: RefreshCw,
    follow_up_due: Clock,
    follow_up_overdue: AlertCircle,
    system: Info,
    mention: AtSign,
    appointment_reminder: Clock,
    appointment_missed: AlertCircle,
    new_lead: UserPlus,
    admin_reminder: Bell,
    skate_alert: AlertTriangle,
}

// Color mapping for notification types
const typeColors: Record<NotificationType, string> = {
    email_received: "text-blue-500 bg-blue-100",
    lead_assigned: "text-green-500 bg-green-100",
    lead_updated: "text-yellow-500 bg-yellow-100",
    follow_up_due: "text-orange-500 bg-orange-100",
    follow_up_overdue: "text-red-500 bg-red-100",
    system: "text-gray-500 bg-gray-100",
    mention: "text-purple-500 bg-purple-100",
    appointment_reminder: "text-blue-500 bg-blue-100",
    appointment_missed: "text-red-500 bg-red-100",
    new_lead: "text-emerald-500 bg-emerald-100",
    admin_reminder: "text-indigo-500 bg-indigo-100",
    skate_alert: "text-amber-500 bg-amber-100",
}

export function NotificationBell() {
    const router = useRouter()
    const { timezone } = useBrowserTimezone()
    const [open, setOpen] = React.useState(false)
    const [notifications, setNotifications] = React.useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = React.useState(0)
    const [isLoading, setIsLoading] = React.useState(false)
    const [isMarkingAll, setIsMarkingAll] = React.useState(false)
    
    // Fetch notifications when popover opens
    const fetchNotifications = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const response = await NotificationService.listNotifications({
                page_size: 10,
            })
            setNotifications(response.items)
            setUnreadCount(response.unread_count)
        } catch (error) {
            console.error("Failed to fetch notifications:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])
    
    // Fetch unread count once on mount. Updates via WebSocket (notification:new) only.
    React.useEffect(() => {
        const fetchUnreadCount = async () => {
            try {
                const stats = await NotificationService.getStats()
                setUnreadCount(stats.unread)
            } catch (error) {
                console.error("Failed to fetch notification stats:", error)
            }
        }
        fetchUnreadCount()
    }, [])
    
    // Listen for real-time notification events via WebSocket
    const handleNewNotification = React.useCallback((notification: any) => {
        // Add the new notification to the top of the list
        setNotifications(prev => {
            // Avoid duplicates
            if (prev.some(n => n.id === notification.id)) {
                return prev
            }
            return [{
                id: notification.id,
                type: notification.notification_type,
                title: notification.title,
                message: notification.message,
                link: notification.link,
                is_read: false,
                created_at: notification.created_at,
            } as Notification, ...prev].slice(0, 10) // Keep only 10 most recent
        })
        // Increment unread count
        setUnreadCount(prev => prev + 1)
    }, [])
    
    useNotificationEvents(handleNewNotification)
    
    // Fetch notifications when popover opens
    React.useEffect(() => {
        if (open) {
            fetchNotifications()
        }
    }, [open, fetchNotifications])
    
    // Mark a notification as read
    const handleMarkAsRead = async (notification: Notification) => {
        if (notification.is_read) return
        
        try {
            await NotificationService.markAsRead(notification.id)
            setNotifications(prev =>
                prev.map(n =>
                    n.id === notification.id ? { ...n, is_read: true } : n
                )
            )
            setUnreadCount(prev => Math.max(0, prev - 1))
            window.dispatchEvent(new CustomEvent("leads-crm:badges-refresh", { detail: { notifications: true } }))
        } catch (error) {
            console.error("Failed to mark notification as read:", error)
        }
    }
    
    // Mark all as read
    const handleMarkAllAsRead = async () => {
        setIsMarkingAll(true)
        try {
            await NotificationService.markAllAsRead()
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
            setUnreadCount(0)
            window.dispatchEvent(new CustomEvent("leads-crm:badges-refresh", { detail: { notifications: true } }))
        } catch (error) {
            console.error("Failed to mark all as read:", error)
        } finally {
            setIsMarkingAll(false)
        }
    }
    
    // Handle notification click – navigate immediately, mark as read in background
    const handleNotificationClick = (notification: Notification) => {
        if (notification.link) {
            setOpen(false)
            router.push(notification.link)
        }
        if (!notification.is_read) {
            handleMarkAsRead(notification)
        }
    }
    
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button className="relative rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 p-0"
                align="end"
                sideOffset={8}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="font-semibold">Notifications</h3>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto px-2 py-1 text-xs"
                            onClick={handleMarkAllAsRead}
                            disabled={isMarkingAll}
                        >
                            {isMarkingAll ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                                <CheckCheck className="mr-1 h-3 w-3" />
                            )}
                            Mark all read
                        </Button>
                    )}
                </div>
                
                {/* Notification list */}
                <div className="max-h-[400px] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                            <Bell className="mx-auto h-8 w-8 opacity-50 mb-2" />
                            <p className="text-sm">No notifications</p>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {notifications.map((notification) => {
                                const typeKey = normalizeNotificationType(notification.type) as NotificationType
                                const Icon = typeIcons[typeKey] || Info
                                const colorClass = typeColors[typeKey] || "text-gray-500 bg-gray-100"
                                
                                return (
                                    <div
                                        key={notification.id}
                                        className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                                            !notification.is_read ? "bg-primary/5" : ""
                                        }`}
                                        onClick={() => handleNotificationClick(notification)}
                                    >
                                        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${colorClass}`}>
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm ${!notification.is_read ? "font-medium" : ""}`}>
                                                {notification.title}
                                            </p>
                                            {notification.message && (
                                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                                    {notification.message}
                                                </p>
                                            )}
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {formatRelativeTimeInTimezone(notification.created_at, timezone)}
                                            </p>
                                        </div>
                                        {!notification.is_read && (
                                            <div className="flex-shrink-0 self-center">
                                                <div className="h-2 w-2 rounded-full bg-primary" />
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                
                {/* Footer */}
                {notifications.length > 0 && (
                    <div className="border-t p-2">
                        <Button
                            variant="ghost"
                            className="w-full text-sm"
                            onClick={() => {
                                setOpen(false)
                                router.push("/notifications")
                            }}
                        >
                            View all notifications
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    )
}
