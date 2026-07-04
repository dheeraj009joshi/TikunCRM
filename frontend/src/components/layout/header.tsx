"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Command, Menu } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { NotificationBell } from "@/components/layout/notification-bell"
import { useSidebarOptional } from "@/contexts/sidebar-context"

const SEGMENT_LABELS: Record<string, string> = {
    dashboard: "Dashboard",
    leads: "Leads",
    unassigned: "Unassigned Pool",
    customers: "Customers",
    appointments: "Appointments",
    "follow-ups": "Follow-ups",
    showroom: "Showroom",
    schedules: "Schedules",
    notifications: "Notifications",
    whatsapp: "WhatsApp",
    sms: "Text (SMS)",
    calls: "Calls",
    inbox: "Inbox",
    communications: "Communications",
    "auto-whatsapp": "Auto WhatsApp",
    jobs: "Jobs",
    dealerships: "Dealerships",
    team: "Team",
    "team-activity": "Team Activity",
    integrations: "Integrations",
    analytics: "Analytics",
    salesperson: "Salesperson",
    "sold-cars": "Sold Cars",
    reports: "Reports",
    "team-sales-touch": "Team Touch & Close",
    settings: "Settings",
    "email-config": "Email Config",
    "dealership-email": "Dealership Email",
    "email-templates": "Email Templates",
    "whatsapp-templates": "WhatsApp Templates",
    profile: "Profile",
    appearance: "Appearance",
    dealership: "Dealership",
    "lead-stages": "Lead Stages",
    "campaign-mappings": "Campaign Mappings",
    "sync-sources": "Sync Sources",
    "stips-categories": "Stips Categories",
    eligibility: "Eligibility",
    security: "Security",
    pipeline: "Pipeline",
    tasks: "Tasks",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function labelFor(segment: string): string {
    if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment]
    if (UUID_RE.test(segment) || /^\d+$/.test(segment)) return "Detail"
    return segment
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
}

export function Header() {
    const pathname = usePathname()
    const sidebar = useSidebarOptional()
    const segments = (pathname || "/dashboard").split("/").filter(Boolean)

    const crumbs = segments.map((segment, i) => ({
        label: labelFor(segment),
        href: "/" + segments.slice(0, i + 1).join("/"),
        isLast: i === segments.length - 1,
    }))

    return (
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
            {/* Mobile hamburger */}
            <button
                type="button"
                onClick={() => sidebar?.setMobileOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
                aria-label="Open navigation menu"
            >
                <Menu className="h-5 w-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
                {crumbs.length === 0 ? (
                    <span className="text-foreground">Dashboard</span>
                ) : (
                    crumbs.map((crumb) => (
                        <React.Fragment key={crumb.href}>
                            {crumb.isLast ? (
                                <span className="truncate text-foreground">{crumb.label}</span>
                            ) : (
                                <>
                                    <Link
                                        href={crumb.href}
                                        className="hidden truncate transition-colors hover:text-foreground sm:inline"
                                    >
                                        {crumb.label}
                                    </Link>
                                    <span className="hidden text-muted-foreground/40 sm:inline">/</span>
                                </>
                            )}
                        </React.Fragment>
                    ))
                )}
            </nav>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
                {/* Shortcut hint */}
                <div className="hidden items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:flex">
                    <Command className="h-3 w-3" />
                    <span>K</span>
                </div>

                <NotificationBell />

                <div className="mx-1 h-6 w-px bg-border sm:mx-2" />

                <ThemeToggle />
            </div>
        </header>
    )
}
