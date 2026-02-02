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
    Info,
    AtSign,
    Check,
    CheckCheck,
    Loader2,
    Trash2,
    Filter,
    X,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Tabs,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import {
    NotificationService,
    Notification,
    NotificationType,
    NotificationStats,
} from "@/services/notification-service"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatRelativeTimeInTimezone } from "@/utils/timezone"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// Icon mapping for notification types
const typeIcons: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
    email_received: Mail,
    lead_assigned: UserPlus,
    lead_updated: RefreshCw,
    follow_up_due: Clock,
    follow_up_overdue: AlertCircle,
    system: Info,
    mention: AtSign,
}

// Color mapping for notification types
const typeColors: Record<NotificationType, string> = {
    email_received: "text-blue-500 bg-blue-100 dark:bg-blue-900/30",
    lead_assigned: "text-green-500 bg-green-100 dark:bg-green-900/30",
    lead_updated: "text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30",
    follow_up_due: "text-orange-500 bg-orange-100 dark:bg-orange-900/30",
    follow_up_overdue: "text-red-500 bg-red-100 dark:bg-red-900/30",
    system: "text-gray-500 bg-gray-100 dark:bg-gray-900/30",
    mention: "text-purple-500 bg-purple-100 dark:bg-purple-900/30",
}

// Type labels
const typeLabels: Record<NotificationType, string> = {
    email_received: "Email",
    lead_assigned: "Lead Assigned",
    lead_updated: "Lead Updated",
    follow_up_due: "Follow-up Due",
    follow_up_overdue: "Overdue",
    system: "System",
    mention: "Mention",
}

export default function NotificationsPage() {
    const router = useRouter()
    const { timezone } = useDealershipTimezone()
    
    const [notifications, setNotifications] = React.useState<Notification[]>([])
    const [stats, setStats] = React.useState<NotificationStats | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [isMarkingAll, setIsMarkingAll] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    
    // Filters
    const [filter, setFilter] = React.useState<"all" | "unread">("all")
    const [typeFilter, setTypeFilter] = React.useState<NotificationType | "all">("all")
    
    // Pagination
    const [page, setPage] = React.useState(1)
    const [total, setTotal] = React.useState(0)
    const pageSize = 20
    
    // Delete confirmation
    const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
    const [notificationToDelete, setNotificationToDelete] = React.useState<Notification | null>(null)
    
    // Fetch notifications
    const fetchNotifications = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const params: any = {
                page,
                page_size: pageSize,
                unread_only: filter === "unread",
            }
            if (typeFilter !== "all") {
                params.notification_type = typeFilter
            }
            
            const response = await NotificationService.listNotifications(params)
            setNotifications(response.items)
            setTotal(response.total)
        } catch (error) {
            console.error("Failed to fetch notifications:", error)
        } finally {
            setIsLoading(false)
        }
    }, [page, filter, typeFilter])
    
    // Fetch stats
    const fetchStats = React.useCallback(async () => {
        try {
            const statsData = await NotificationService.getStats()
            setStats(statsData)
        } catch (error) {
            console.error("Failed to fetch notification stats:", error)
        }
    }, [])
    
    React.useEffect(() => {
        fetchNotifications()
        fetchStats()
    }, [fetchNotifications, fetchStats])
    
    // Mark notification as read
    const handleMarkAsRead = async (notification: Notification) => {
        if (notification.is_read) return
        
        try {
            await NotificationService.markAsRead(notification.id)
            setNotifications(prev =>
                prev.map(n =>
                    n.id === notification.id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
                )
            )
            fetchStats()
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
            fetchStats()
        } catch (error) {
            console.error("Failed to mark all as read:", error)
        } finally {
            setIsMarkingAll(false)
        }
    }
    
    // Delete notification
    const handleDeleteClick = (notification: Notification) => {
        setNotificationToDelete(notification)
        setDeleteDialogOpen(true)
    }
    
    const handleDeleteConfirm = async () => {
        if (!notificationToDelete) return
        
        setIsDeleting(true)
        try {
            await NotificationService.deleteNotification(notificationToDelete.id)
            setNotifications(prev => prev.filter(n => n.id !== notificationToDelete.id))
            setTotal(prev => prev - 1)
            setDeleteDialogOpen(false)
            setNotificationToDelete(null)
            fetchStats()
        } catch (error) {
            console.error("Failed to delete notification:", error)
        } finally {
            setIsDeleting(false)
        }
    }
    
    // Handle notification click
    const handleNotificationClick = (notification: Notification) => {
        // Mark as read if unread
        if (!notification.is_read) {
            handleMarkAsRead(notification)
        }
        
        // Navigate to link if available
        if (notification.link) {
            router.push(notification.link)
        }
    }
    
    const unreadCount = stats?.unread || 0
    
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
                    <p className="text-muted-foreground">
                        Manage and view all your notifications
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <Button
                            variant="outline"
                            onClick={handleMarkAllAsRead}
                            disabled={isMarkingAll}
                        >
                            {isMarkingAll ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Marking...
                                </>
                            ) : (
                                <>
                                    <CheckCheck className="mr-2 h-4 w-4" />
                                    Mark All Read
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </div>
            
            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-muted-foreground">Total</p>
                                    <p className="text-2xl font-bold">{stats.total}</p>
                                </div>
                                <Bell className="h-8 w-8 text-muted-foreground" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-muted-foreground">Unread</p>
                                    <p className="text-2xl font-bold text-primary">{stats.unread}</p>
                                </div>
                                <AlertCircle className="h-8 w-8 text-primary" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-muted-foreground">Read</p>
                                    <p className="text-2xl font-bold text-green-600">{stats.total - stats.unread}</p>
                                </div>
                                <Check className="h-8 w-8 text-green-600" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-muted-foreground">By Type</p>
                                    <p className="text-sm font-medium">{Object.keys(stats.by_type || {}).length} types</p>
                                </div>
                                <Filter className="h-8 w-8 text-muted-foreground" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
            
            {/* Filters */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                        <Tabs value={filter} onValueChange={(v) => {
                            setFilter(v as "all" | "unread")
                            setPage(1)
                        }}>
                            <TabsList>
                                <TabsTrigger value="all">All</TabsTrigger>
                                <TabsTrigger value="unread">
                                    Unread
                                    {unreadCount > 0 && (
                                        <Badge variant="secondary" className="ml-2">
                                            {unreadCount}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        
                        <Select value={typeFilter} onValueChange={(v) => {
                            setTypeFilter(v as NotificationType | "all")
                            setPage(1)
                        }}>
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Filter by type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                <SelectItem value="email_received">Email</SelectItem>
                                <SelectItem value="lead_assigned">Lead Assigned</SelectItem>
                                <SelectItem value="lead_updated">Lead Updated</SelectItem>
                                <SelectItem value="follow_up_due">Follow-up Due</SelectItem>
                                <SelectItem value="follow_up_overdue">Overdue</SelectItem>
                                <SelectItem value="system">System</SelectItem>
                                <SelectItem value="mention">Mention</SelectItem>
                            </SelectContent>
                        </Select>
                        
                        {(filter !== "all" || typeFilter !== "all") && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setFilter("all")
                                    setTypeFilter("all")
                                    setPage(1)
                                }}
                            >
                                <X className="h-4 w-4 mr-1" />
                                Clear Filters
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
            
            {/* Notifications List */}
            <Card>
                <CardHeader>
                    <CardTitle>
                        {filter === "unread" ? "Unread Notifications" : "All Notifications"}
                        {total > 0 && (
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                                ({total} {total === 1 ? "notification" : "notifications"})
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Bell className="h-12 w-12 text-muted-foreground/20 mb-4" />
                            <p className="text-lg font-medium">No notifications</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {filter === "unread"
                                    ? "You're all caught up! No unread notifications."
                                    : "You don't have any notifications yet."}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {notifications.map((notification) => {
                                const Icon = typeIcons[notification.type]
                                const colorClass = typeColors[notification.type]
                                const label = typeLabels[notification.type]
                                
                                return (
                                    <div
                                        key={notification.id}
                                        className={`p-4 hover:bg-muted/50 transition-colors ${
                                            !notification.is_read ? "bg-primary/5" : ""
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${colorClass}`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            
                                            <div
                                                className="flex-1 min-w-0 cursor-pointer"
                                                onClick={() => handleNotificationClick(notification)}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <p className={`font-medium ${!notification.is_read ? "" : "text-muted-foreground"}`}>
                                                                {notification.title}
                                                            </p>
                                                            {!notification.is_read && (
                                                                <div className="h-2 w-2 rounded-full bg-primary" />
                                                            )}
                                                            <Badge variant="outline" size="sm">
                                                                {label}
                                                            </Badge>
                                                        </div>
                                                        {notification.message && (
                                                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                                                                {notification.message}
                                                            </p>
                                                        )}
                                                        <p className="text-xs text-muted-foreground mt-2">
                                                            {formatRelativeTimeInTimezone(notification.created_at, timezone)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {!notification.is_read && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleMarkAsRead(notification)
                                                        }}
                                                        title="Mark as read"
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleDeleteClick(notification)
                                                    }}
                                                    className="text-destructive hover:text-destructive"
                                                    title="Delete notification"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {/* Pagination */}
            {total > pageSize && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                        Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} notifications
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 1 || isLoading}
                            onClick={() => setPage(page - 1)}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page * pageSize >= total || isLoading}
                            onClick={() => setPage(page + 1)}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
            
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Notification</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this notification? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                "Delete"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
