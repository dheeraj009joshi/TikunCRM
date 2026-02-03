"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    BarChart3,
    Users,
    Building2,
    Inbox,
    Calendar,
    CalendarClock,
    Settings,
    LogOut,
    ChevronRight,
    Search,
    LayoutDashboard,
    Share2,
    UserPlus,
    InboxIcon,
    ClipboardList,
    Mail,
    Bell
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore, UserRole } from "@/stores/auth-store"
import { useRole, getRoleDisplayName } from "@/hooks/use-role"
import { useNotificationEvents, useLeadUpdateEvents, useBadgesRefresh } from "@/hooks/use-websocket"
import { UserAvatar } from "@/components/ui/avatar"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import { AppointmentService } from "@/services/appointment-service"
import { FollowUpService } from "@/services/follow-up-service"
import { LeadService } from "@/services/lead-service"
import apiClient from "@/lib/api-client"
import { GlobalSearchModal } from "@/components/search/global-search-modal"

interface SidebarItem {
    name: string
    icon: React.ComponentType<{ className?: string }>
    href: string
    badge?: string | number
    roles?: UserRole[]  // If undefined, visible to all roles
}

// All sidebar items with role restrictions
const allSidebarItems: SidebarItem[] = [
    { 
        name: "Dashboard", 
        icon: LayoutDashboard, 
        href: "/dashboard" 
    },
    { 
        name: "Leads", 
        icon: Inbox, 
        href: "/leads" 
    },
    { 
        name: "Unassigned Pool", 
        icon: InboxIcon, 
        href: "/leads?filter=unassigned",
        roles: undefined  // Visible to all users
    },
    { 
        name: "Dealerships", 
        icon: Building2, 
        href: "/dealerships",
        roles: ["super_admin"]  // Only Super Admin
    },
    { 
        name: "Team", 
        icon: Users, 
        href: "/team",
        roles: ["super_admin", "dealership_admin", "dealership_owner"]  // Not for Salesperson
    },
    { 
        name: "Schedules", 
        icon: Calendar, 
        href: "/schedules",
        roles: ["super_admin", "dealership_admin", "dealership_owner"]
    },
    { 
        name: "Appointments", 
        icon: CalendarClock, 
        href: "/appointments" 
    },
    { 
        name: "Follow-ups", 
        icon: ClipboardList, 
        href: "/follow-ups" 
    },
    { 
        name: "Communications", 
        icon: Mail, 
        href: "/communications" 
    },
    { 
        name: "Notifications", 
        icon: Bell, 
        href: "/notifications" 
    },
    { 
        name: "Analytics", 
        icon: BarChart3, 
        href: "/analytics",
        roles: ["super_admin", "dealership_admin", "dealership_owner"]
    },
    { 
        name: "Integrations", 
        icon: Share2, 
        href: "/integrations",
        roles: ["super_admin", "dealership_owner"]  // Dealership Owner can manage integrations
    },
    { 
        name: "Settings", 
        icon: Settings, 
        href: "/settings" 
    },
]

function getSidebarItemsForRole(role: UserRole | null): SidebarItem[] {
    if (!role) return []
    
    return allSidebarItems.filter(item => {
        // If no roles specified, visible to all
        if (!item.roles) return true
        // Check if user's role is in the allowed roles
        return item.roles.includes(role)
    })
}

// Badge counts interface
interface BadgeCounts {
    appointments: number
    followUps: number
    unassigned: number
    notifications: number
}

export function Sidebar() {
    const pathname = usePathname()
    const { user, logout } = useAuthStore()
    const { role, isSuperAdmin, isDealershipAdmin, isSalesperson } = useRole()
    const [showSearch, setShowSearch] = React.useState(false)
    const [badgeCounts, setBadgeCounts] = React.useState<BadgeCounts>({
        appointments: 0,
        followUps: 0,
        unassigned: 0,
        notifications: 0
    })
    
    // Fetch badge counts
    React.useEffect(() => {
        const fetchBadgeCounts = async () => {
            try {
                // Fetch appointment stats (today's count)
                let appointmentsToday = 0
                try {
                    const appointmentStats = await AppointmentService.getStats()
                    appointmentsToday = appointmentStats.today || 0
                } catch {
                    appointmentsToday = 0
                }
                
                // Fetch overdue follow-ups count
                let overdueFollowUps = 0
                try {
                    const followUps = await FollowUpService.listFollowUps({ overdue: true })
                    overdueFollowUps = followUps.length
                } catch {
                    overdueFollowUps = 0
                }
                
                // Unassigned pool count - visible to all users
                let unassignedCount = 0
                try {
                    const unassignedRes = await LeadService.listLeads({ 
                        pool: "unassigned",
                        page_size: 1 
                    })
                    unassignedCount = unassignedRes.total
                } catch {
                    unassignedCount = 0
                }
                
                // Fetch unread notifications count
                let unreadNotifications = 0
                try {
                    const notifStats = await apiClient.get("/notifications/stats")
                    unreadNotifications = notifStats.data?.unread || 0
                } catch {
                    unreadNotifications = 0
                }
                
                setBadgeCounts({
                    appointments: appointmentsToday,
                    followUps: overdueFollowUps,
                    unassigned: unassignedCount,
                    notifications: unreadNotifications
                })
            } catch (error) {
                console.error("Failed to fetch badge counts:", error)
            }
        }
        
        // Only fetch if user is logged in
        if (user && role) {
            fetchBadgeCounts()
            
            // Poll every 60 seconds (as fallback if WebSocket is not connected)
            const interval = setInterval(fetchBadgeCounts, 60000)
            return () => clearInterval(interval)
        }
    }, [user, role, pathname])
    
    // Refetch specific badge counts (used by WebSocket handlers)
    const refetchBadgeCounts = React.useCallback((which: { unassigned?: boolean; notifications?: boolean; appointments?: boolean; followUps?: boolean }) => {
        if (which.unassigned) {
            LeadService.listLeads({ pool: "unassigned", page_size: 1 })
                .then(res => setBadgeCounts(prev => ({ ...prev, unassigned: res.total })))
                .catch(() => {})
        }
        if (which.notifications) {
            apiClient.get("/notifications/stats")
                .then(res => setBadgeCounts(prev => ({ ...prev, notifications: res.data?.unread ?? 0 })))
                .catch(() => {})
        }
        if (which.appointments) {
            AppointmentService.getStats()
                .then(stats => setBadgeCounts(prev => ({ ...prev, appointments: stats.today ?? 0 })))
                .catch(() => {})
        }
        if (which.followUps) {
            FollowUpService.listFollowUps({ overdue: true })
                .then(list => setBadgeCounts(prev => ({ ...prev, followUps: list.length })))
                .catch(() => {})
        }
    }, [])

    // Refetch badge counts when user marks notifications as read (custom event from notifications page or bell)
    React.useEffect(() => {
        const handler = (e: CustomEvent<{ notifications?: boolean; unassigned?: boolean }>) => {
            const detail = e.detail || {}
            refetchBadgeCounts({
                notifications: detail.notifications ?? false,
                unassigned: detail.unassigned ?? false,
            })
        }
        window.addEventListener("leads-crm:badges-refresh" as any, handler as any)
        return () => window.removeEventListener("leads-crm:badges-refresh" as any, handler as any)
    }, [refetchBadgeCounts])

    // Listen for real-time notification events via WebSocket – refetch count so numbers stay in sync
    const handleNewNotification = React.useCallback(() => {
        refetchBadgeCounts({ notifications: true })
    }, [refetchBadgeCounts])
    
    useNotificationEvents(handleNewNotification)
    
    // Listen for lead assignment events (updates unassigned pool count via WebSocket)
    const handleLeadUpdate = React.useCallback((data: any) => {
        if (data.update_type === "assigned" || data.update_type === "unassigned" || data.update_type === "created") {
            refetchBadgeCounts({ unassigned: true })
        }
    }, [refetchBadgeCounts])
    
    useLeadUpdateEvents(null, handleLeadUpdate)
    
    // Listen for explicit badge refresh (e.g. stale leads returned to pool, new unassigned lead created)
    const handleBadgesRefresh = React.useCallback((data: { unassigned?: boolean; notifications?: boolean }) => {
        refetchBadgeCounts({
            unassigned: data.unassigned ?? false,
            notifications: data.notifications ?? false,
        })
    }, [refetchBadgeCounts])
    
    useBadgesRefresh(handleBadgesRefresh)
    
    // Build sidebar items with dynamic badges
    const sidebarItems = React.useMemo(() => {
        const items = getSidebarItemsForRole(role)
        
        // Add dynamic badges
        return items.map(item => {
            if (item.href === "/appointments" && badgeCounts.appointments > 0) {
                return { ...item, badge: badgeCounts.appointments }
            }
            if (item.href === "/follow-ups" && badgeCounts.followUps > 0) {
                return { ...item, badge: badgeCounts.followUps }
            }
            if (item.href === "/leads?filter=unassigned" && badgeCounts.unassigned > 0) {
                return { ...item, badge: badgeCounts.unassigned }
            }
            if (item.href === "/notifications" && badgeCounts.notifications > 0) {
                return { ...item, badge: badgeCounts.notifications }
            }
            return item
        })
    }, [role, badgeCounts])

    const handleLogout = () => {
        logout()
        window.location.href = "/login"
    }
    
    // Keyboard shortcut for search (Cmd+K / Ctrl+K)
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault()
                setShowSearch(true)
            }
        }
        
        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [])

    return (
        <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-background transition-transform">
            <div className="flex h-full flex-col px-3 py-4">
                {/* Logo */}
                <div className="mb-10 flex items-center px-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="font-bold">L</span>
                    </div>
                    <span className="ml-3 text-xl font-bold tracking-tight">LeadsCRM</span>
                </div>

                {/* Search */}
                <button
                    onClick={() => setShowSearch(true)}
                    className="relative mb-6 w-full flex items-center gap-2 rounded-md border border-input bg-muted/50 py-2 px-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                    <Search className="h-4 w-4" />
                    <span className="flex-1 text-left">Quick search...</span>
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </button>

                {/* Navigation */}
                <nav className="flex-1 space-y-1">
                    {sidebarItems.map((item) => {
                        const isActive = pathname === item.href || 
                            (item.href !== "/dashboard" && pathname.startsWith(item.href))
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "group flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                                    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                                )}
                            >
                                <div className="flex items-center">
                                    <item.icon className={cn(
                                        "mr-3 h-4 w-4", 
                                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                    )} />
                                    <span>{item.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {item.badge && (
                                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                                            {item.badge}
                                        </span>
                                    )}
                                    {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
                                </div>
                            </Link>
                        )
                    })}
                </nav>

                {/* User / Bottom Section */}
                <div className="mt-auto border-t pt-4">
                    <div className="flex items-center px-2 py-2">
                        <UserAvatar user={user || undefined} size="md" />
                        <div className="ml-3 flex-1 overflow-hidden">
                            <p className="truncate text-sm font-medium text-foreground">
                                {user?.first_name} {user?.last_name}
                            </p>
                            <Badge 
                                variant={getRoleVariant(role || "")} 
                                size="sm"
                                className="mt-0.5"
                            >
                                {role ? getRoleDisplayName(role) : "Unknown"}
                            </Badge>
                        </div>
                        <button 
                            onClick={handleLogout}
                            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Global Search Modal */}
            <GlobalSearchModal open={showSearch} onOpenChange={setShowSearch} />
        </aside>
    )
}
