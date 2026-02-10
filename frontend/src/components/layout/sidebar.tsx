"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
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
    ChevronLeft,
    ChevronDown,
    Search,
    LayoutDashboard,
    Share2,
    UserPlus,
    InboxIcon,
    ClipboardList,
    Bell,
    MessageSquare,
    MessageCircle,
    Phone,
    MessagesSquare,
    Store,
    Contact
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuthStore, UserRole } from "@/stores/auth-store"
import { useRole, getRoleDisplayName } from "@/hooks/use-role"
import { useNotificationEvents, useLeadUpdateEvents, useBadgesRefresh, useStatsRefresh } from "@/hooks/use-websocket"
import { useSidebarOptional } from "@/contexts/sidebar-context"
import { UserAvatar } from "@/components/ui/avatar"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import { AppointmentService } from "@/services/appointment-service"
import { FollowUpService } from "@/services/follow-up-service"
import { LeadService } from "@/services/lead-service"
import apiClient from "@/lib/api-client"
import { GlobalSearchModal } from "@/components/search/global-search-modal"

interface SidebarLink {
    name: string
    icon: React.ComponentType<{ className?: string }>
    href: string
}

interface SidebarItem {
    name: string
    icon: React.ComponentType<{ className?: string }>
    href?: string
    badge?: string | number
    roles?: UserRole[]
    /** If set, this item is a dropdown with child links */
    children?: SidebarLink[]
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
        name: "Customers",
        icon: Contact,
        href: "/customers",
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
        name: "Dealership", 
        icon: Store, 
        href: "/showroom" 
    },
    { 
        name: "Follow-ups", 
        icon: ClipboardList, 
        href: "/follow-ups" 
    },
    {
        name: "Conversations",
        icon: MessagesSquare,
        children: [
            { name: "WhatsApp", icon: MessageCircle, href: "/whatsapp" },
            { name: "Text", icon: MessageSquare, href: "/sms" },
            { name: "Calls", icon: Phone, href: "/calls" },
        ],
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
    const sidebarContext = useSidebarOptional()
    const collapsed = sidebarContext?.collapsed ?? false
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
        
        // Fetch once on mount when user is logged in. Pool/unassigned count updates via WebSocket (lead:updated, badges:refresh, stats:refresh).
        if (user && role) {
            fetchBadgeCounts()
        }
    }, [user, role])
    
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
    
    // When stats refresh (lead/appointment/follow-up/showroom changes), update all sidebar counts via WebSocket
    const handleStatsRefresh = React.useCallback((_data: { dealership_id?: string; timestamp?: string }) => {
        refetchBadgeCounts({ unassigned: true, appointments: true, followUps: true })
    }, [refetchBadgeCounts])
    useStatsRefresh(handleStatsRefresh)
    
    // Expand Conversations when on WhatsApp, SMS, or Calls
    const isConversationsActive = pathname === "/whatsapp" || pathname === "/sms" || pathname === "/calls"
    const [expandedGroup, setExpandedGroup] = React.useState<string | null>(() =>
        isConversationsActive ? "Conversations" : null
    )
    React.useEffect(() => {
        if (isConversationsActive) setExpandedGroup("Conversations")
    }, [isConversationsActive])

    // Build sidebar items with dynamic badges
    const sidebarItems = React.useMemo(() => {
        const items = getSidebarItemsForRole(role)
        return items.map(item => {
            if (!item.children && item.href === "/appointments" && badgeCounts.appointments > 0) {
                return { ...item, badge: badgeCounts.appointments }
            }
            if (!item.children && item.href === "/follow-ups" && badgeCounts.followUps > 0) {
                return { ...item, badge: badgeCounts.followUps }
            }
            if (!item.children && item.href === "/leads?filter=unassigned" && badgeCounts.unassigned > 0) {
                return { ...item, badge: badgeCounts.unassigned }
            }
            if (!item.children && item.href === "/notifications" && badgeCounts.notifications > 0) {
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
        <aside
            className={cn(
                "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-background transition-[width] duration-200",
                collapsed ? "w-16" : "w-64"
            )}
        >
            <div className="flex min-h-0 flex-1 flex-col px-2 py-4">
                {/* Logo - click navigates to dashboard */}
                <Link
                    href="/dashboard"
                    className={cn(
                        "shrink-0 flex items-center hover:opacity-90 transition-opacity",
                        collapsed ? "mb-6 justify-center px-0" : "mb-10 px-2"
                    )}
                >
                    <Image
                        src="/Gemini_Generated_Image_iauae6iauae6iaua.png"
                        alt="TikunCRM"
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-lg object-contain shrink-0"
                    />
                    {!collapsed && <span className="ml-3 text-xl font-bold tracking-tight truncate">TikunCRM</span>}
                </Link>

                {/* Search */}
                <button
                    onClick={() => setShowSearch(true)}
                    className={cn(
                        "relative shrink-0 flex items-center rounded-md border border-input bg-muted/50 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
                        collapsed ? "mb-6 w-10 justify-center px-0" : "mb-6 w-full gap-2 px-3"
                    )}
                    title="Quick search (⌘K)"
                >
                    <Search className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                        <>
                            <span className="flex-1 text-left">Quick search...</span>
                            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium">
                                <span className="text-xs">⌘</span>K
                            </kbd>
                        </>
                    )}
                </button>

                {/* Navigation - scrollable when many items */}
                <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-1">
                    {sidebarItems.map((item) => {
                        if (item.children) {
                            const isOpen = expandedGroup === item.name
                            const isChildActive = item.children.some(
                                c => pathname === c.href || (c.href !== "/dashboard" && pathname.startsWith(c.href))
                            )
                            if (collapsed) {
                                return (
                                    <div key={item.name} className="space-y-1">
                                        {item.children.map((child) => {
                                            const active = pathname === child.href || pathname.startsWith(child.href + "/")
                                            return (
                                                <Link
                                                    key={child.href}
                                                    href={child.href}
                                                    title={child.name}
                                                    className={cn(
                                                        "flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors hover:bg-accent",
                                                        active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                                                    )}
                                                >
                                                    <child.icon className="h-4 w-4 shrink-0" />
                                                </Link>
                                            )
                                        })}
                                    </div>
                                )
                            }
                            return (
                                <div key={item.name} className="space-y-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedGroup(isOpen ? null : item.name)}
                                        title={item.name}
                                        className={cn(
                                            "group relative flex w-full items-center rounded-md py-2 text-sm font-medium transition-colors hover:bg-accent",
                                            "justify-between px-3",
                                            isChildActive ? "text-accent-foreground" : "text-muted-foreground"
                                        )}
                                    >
                                        <div className="flex items-center min-w-0">
                                            <item.icon
                                                className={cn(
                                                    "h-4 w-4 shrink-0 mr-3",
                                                    isChildActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                                )}
                                            />
                                            <span className="truncate">{item.name}</span>
                                        </div>
                                        <ChevronDown
                                            className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                                        />
                                    </button>
                                    {isOpen && (
                                        <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                                            {item.children.map((child) => {
                                                const active = pathname === child.href || pathname.startsWith(child.href + "/")
                                                return (
                                                    <Link
                                                        key={child.href}
                                                        href={child.href}
                                                        className={cn(
                                                            "flex items-center rounded-md py-1.5 pl-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                                                            active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                                                        )}
                                                    >
                                                        <child.icon className="h-3.5 w-3.5 shrink-0 mr-2 text-muted-foreground" />
                                                        <span className="truncate">{child.name}</span>
                                                    </Link>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        }
                        const isActive = pathname === item.href || (item.href != null && item.href !== "/dashboard" && pathname.startsWith(item.href))
                        return (
                            <Link
                                key={item.href!}
                                href={item.href!}
                                title={collapsed ? item.name : undefined}
                                className={cn(
                                    "group relative flex items-center rounded-md py-2 text-sm font-medium transition-colors hover:bg-accent",
                                    collapsed ? "justify-center px-0" : "justify-between px-3",
                                    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                                )}
                            >
                                <div className={cn("flex items-center min-w-0", collapsed && "justify-center")}>
                                    <item.icon
                                        className={cn(
                                            "h-4 w-4 shrink-0",
                                            !collapsed && "mr-3",
                                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                        )}
                                    />
                                    {!collapsed && <span className="truncate">{item.name}</span>}
                                </div>
                                {!collapsed && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        {item.badge && (
                                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                                                {item.badge}
                                            </span>
                                        )}
                                        {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
                                    </div>
                                )}
                                {collapsed && item.badge && (
                                    <span className="absolute top-1/2 right-1 -translate-y-1/2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                                        {item.badge}
                                    </span>
                                )}
                            </Link>
                        )
                    })}
                </nav>

                {/* Collapse toggle */}
                {sidebarContext && (
                    <div className={cn("shrink-0 border-t pt-2", collapsed ? "px-0 flex justify-center" : "px-2")}>
                        <button
                            type="button"
                            onClick={sidebarContext.toggle}
                            className={cn(
                                "flex items-center justify-center rounded-md py-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
                                collapsed ? "w-full" : "w-full gap-2"
                            )}
                            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        >
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                            {!collapsed && <span className="text-xs">Collapse</span>}
                        </button>
                    </div>
                )}

                {/* User / Bottom Section */}
                <div className="mt-2 shrink-0 border-t pt-4">
                    <div className={cn("flex items-center py-2", collapsed ? "flex-col justify-center gap-2 px-0" : "px-2")}>
                        <UserAvatar user={user || undefined} size={collapsed ? "sm" : "md"} />
                        {!collapsed && (
                            <>
                                <div className="ml-3 flex-1 overflow-hidden min-w-0">
                                    <p className="truncate text-sm font-medium text-foreground">
                                        {user?.first_name} {user?.last_name}
                                    </p>
                                    <Badge variant={getRoleVariant(role || "")} size="sm" className="mt-0.5">
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
                            </>
                        )}
                        {collapsed && (
                            <button
                                onClick={handleLogout}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                title="Logout"
                            >
                                <LogOut className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <GlobalSearchModal open={showSearch} onOpenChange={setShowSearch} />
        </aside>
    )
}
