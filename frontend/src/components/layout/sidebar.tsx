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
import { UserAvatar } from "@/components/ui/avatar"
import { Badge, getRoleVariant } from "@/components/ui/badge"

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
        href: "/leads/unassigned",
        roles: ["super_admin"]  // Only Super Admin
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

export function Sidebar() {
    const pathname = usePathname()
    const { user, logout } = useAuthStore()
    const { role, isSuperAdmin, isDealershipAdmin, isSalesperson } = useRole()
    
    const sidebarItems = React.useMemo(() => {
        return getSidebarItemsForRole(role)
    }, [role])

    const handleLogout = () => {
        logout()
        window.location.href = "/login"
    }

    return (
        <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-background transition-transform">
            <div className="flex h-full flex-col px-3 py-4">
                {/* Logo */}
                <div className="mb-10 flex items-center px-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <span className="font-bold">L</span>
                    </div>
                    <span className="ml-3 text-xl font-bold tracking-tight">LeedsCRM</span>
                </div>

                {/* Search */}
                <div className="relative mb-6">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <input
                        type="text"
                        className="block w-full rounded-md border border-input bg-muted/50 py-2 pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Quick search..."
                    />
                </div>

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
        </aside>
    )
}
