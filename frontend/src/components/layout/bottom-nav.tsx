"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Inbox, CalendarClock, Bell } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
    { name: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    { name: "Leads", icon: Inbox, href: "/leads" },
    { name: "Appointments", icon: CalendarClock, href: "/appointments" },
    { name: "Alerts", icon: Bell, href: "/notifications" },
]

/**
 * Mobile-only bottom tab bar for the primary destinations.
 * Hidden at md+ where the sidebar takes over.
 */
export function BottomNav() {
    const pathname = usePathname()

    return (
        <nav
            className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t bg-background/95 backdrop-blur md:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            aria-label="Primary"
        >
            {TABS.map((tab) => {
                const active =
                    pathname === tab.href || (tab.href !== "/dashboard" && pathname.startsWith(tab.href + "/"))
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={cn(
                            "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                            active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <tab.icon className="h-5 w-5" />
                        <span>{tab.name}</span>
                    </Link>
                )
            })}
        </nav>
    )
}
