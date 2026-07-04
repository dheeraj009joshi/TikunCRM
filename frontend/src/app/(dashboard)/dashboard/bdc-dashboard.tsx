"use client"

import * as React from "react"
import Link from "next/link"
import { startOfDay, endOfDay } from "date-fns"
import {
    Inbox,
    CheckCircle,
    Clock,
    AlertTriangle,
    Loader2,
    UserPlus,
    ClipboardList,
    CalendarClock,
    Building2,
    ArrowUpRight,
    Sparkles,
    Phone,
    ChevronRight,
    Store,
    Mail,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, MetricCard } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { DashboardService, BdcStats, BdcDealershipBreakdown } from "@/services/dashboard-service"
import { LeadService, Lead, getLeadFullName, getLeadPhone, getLeadEmail } from "@/services/lead-service"
import { AppointmentService, Appointment, getAppointmentStatusLabel } from "@/services/appointment-service"
import { FollowUpService, FollowUp } from "@/services/follow-up-service"
import { ShowroomService } from "@/services/showroom-service"
import { getStageLabel, getStageColor } from "@/services/lead-stage-service"
import { useStatsRefresh, useShowroomUpdates, useWebSocketEvent } from "@/hooks/use-websocket"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone, formatRelativeTimeInTimezone } from "@/utils/timezone"
import { cn } from "@/lib/utils"
import { useBdcDealership } from "@/contexts/bdc-dealership-context"
import { BdcDealershipSwitcher } from "@/components/layout/bdc-dealership-switcher"

function getScopedMetrics(stats: BdcStats, selectedDealershipId: string | null) {
    if (!selectedDealershipId) {
        return {
            unassigned: stats.unassigned_to_salesperson,
            fresh: stats.fresh_leads ?? 0,
            pendingFollowUps: stats.todays_follow_ups,
            overdueFollowUps: stats.overdue_follow_ups,
        }
    }
    const row = stats.dealerships.find((d) => d.id === selectedDealershipId)
    if (!row) {
        return { unassigned: 0, fresh: 0, pendingFollowUps: 0, overdueFollowUps: 0 }
    }
    return {
        unassigned: row.unassigned_leads,
        fresh: row.fresh_leads,
        pendingFollowUps: row.todays_follow_ups,
        overdueFollowUps: row.overdue_follow_ups,
    }
}

function filterByDealership<T extends { dealership_id?: string; dealership?: { id?: string }; lead?: { dealership_id?: string } }>(
    items: T[],
    selectedDealershipId: string | null
): T[] {
    if (!selectedDealershipId) return items
    return items.filter((item) => {
        const id = item.dealership_id ?? item.dealership?.id ?? item.lead?.dealership_id
        return id === selectedDealershipId
    })
}

function followUpLeadName(fu: FollowUp): string {
    const c = fu.lead?.customer
    if (!c) return "Lead"
    return c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Lead"
}

function WorkQueueCard({
    title,
    icon,
    href,
    hrefLabel,
    accentClass,
    headerClass,
    emptyMessage,
    emptyAction,
    children,
}: {
    title: string
    icon: React.ReactNode
    href: string
    hrefLabel: string
    accentClass: string
    headerClass: string
    emptyMessage: string
    emptyAction?: { label: string; href: string }
    children: React.ReactNode
}) {
    const hasItems = React.Children.count(children) > 0

    return (
        <Card className={cn("flex flex-col overflow-hidden border-2", accentClass)}>
            <CardHeader className={cn("flex flex-row items-center justify-between space-y-0 pb-3", headerClass)}>
                <div className="flex items-center gap-2.5">
                    {icon}
                    <CardTitle className="text-base font-semibold">{title}</CardTitle>
                </div>
                <Button variant="secondary" size="sm" className="h-8 shrink-0" asChild>
                    <Link href={href}>
                        {hrefLabel}
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent className="flex-1 pt-0">
                {hasItems ? (
                    <ul className="space-y-2">{children}</ul>
                ) : (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-background/60 py-10 px-4 text-center">
                        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                        {emptyAction && (
                            <Button variant="outline" size="sm" className="mt-4" asChild>
                                <Link href={emptyAction.href}>{emptyAction.label}</Link>
                            </Button>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

function DealershipRow({ d, maxUnassigned }: { d: BdcDealershipBreakdown; maxUnassigned: number }) {
    const pct = maxUnassigned > 0 ? Math.min(100, Math.round((d.unassigned_leads / maxUnassigned) * 100)) : 0
    return (
        <TableRow>
            <TableCell>
                <Link href={`/leads?dealership_id=${d.id}`} className="font-medium hover:text-primary hover:underline">
                    {d.name}
                </Link>
                <div className="mt-2 h-1.5 max-w-[180px] rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${pct}%` }} />
                </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{d.total_leads.toLocaleString()}</TableCell>
            <TableCell className="text-right">
                {d.unassigned_leads > 0 ? (
                    <Link href={`/leads?dealership_id=${d.id}&filter=unassigned`}>
                        <Badge variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50">
                            {d.unassigned_leads}
                        </Badge>
                    </Link>
                ) : (
                    "0"
                )}
            </TableCell>
            <TableCell className="text-right">
                {d.fresh_leads > 0 ? (
                    <Link href={`/leads?dealership_id=${d.id}&filter=fresh`}>
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                            {d.fresh_leads}
                        </Badge>
                    </Link>
                ) : (
                    "0"
                )}
            </TableCell>
            <TableCell className="text-right">
                {d.overdue_follow_ups > 0 ? (
                    <Link href="/follow-ups?filter=overdue">
                        <Badge variant="outline" className="border-rose-300 text-rose-700">
                            {d.overdue_follow_ups}
                        </Badge>
                    </Link>
                ) : (
                    "0"
                )}
            </TableCell>
        </TableRow>
    )
}

export function BdcDashboard() {
    const { selectedDealershipId, selectedDealershipName } = useBdcDealership()
    const [stats, setStats] = React.useState<BdcStats | null>(null)
    const [freshLeads, setFreshLeads] = React.useState<Lead[]>([])
    const [freshLeadsTop, setFreshLeadsTop] = React.useState<Lead[]>([])
    const [overdueFollowUps, setOverdueFollowUps] = React.useState<FollowUp[]>([])
    const [todayFollowUps, setTodayFollowUps] = React.useState<FollowUp[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [upcomingAppointments, setUpcomingAppointments] = React.useState<Appointment[]>([])
    const [showroomInShowroom, setShowroomInShowroom] = React.useState(0)
    const [showroomCheckedInToday, setShowroomCheckedInToday] = React.useState(0)
    const [showroomSoldToday, setShowroomSoldToday] = React.useState(0)
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    const loadData = React.useCallback(async () => {
        const now = new Date()
        const todayFrom = startOfDay(now).toISOString()
        const todayTo = endOfDay(now).toISOString()
        const leadFilters = selectedDealershipId ? { dealership_id: selectedDealershipId } : {}

        try {
            const [
                statsData,
                freshData,
                freshTopData,
                overdueFuData,
                todayFuData,
                todayApptData,
                upcomingApptData,
                showroomCurrent,
            ] = await Promise.all([
                DashboardService.getBdcStats(),
                LeadService.listLeads({ fresh_only: true, page_size: 8, ...leadFilters }).catch(() => ({ items: [] })),
                LeadService.listLeads({ fresh_only: true, page_size: 5, ...leadFilters }).catch(() => ({ items: [] })),
                FollowUpService.listFollowUps({ overdue: true, status: "pending", page_size: 8 }).catch(() => ({
                    items: [],
                })),
                FollowUpService.listFollowUps({
                    status: "pending",
                    date_from: todayFrom,
                    date_to: todayTo,
                    page_size: 8,
                }).catch(() => ({ items: [] })),
                AppointmentService.list({ today_only: true, page_size: 10 }).catch(() => ({ items: [] })),
                AppointmentService.list({ upcoming_only: true, page_size: 3 }).catch(() => ({ items: [] })),
                ShowroomService.getCurrent().catch(() => ({ count: 0, visits: [] })),
            ])
            setStats(statsData)
            setFreshLeads(freshData.items || [])
            setFreshLeadsTop(freshTopData.items || [])
            setOverdueFollowUps(filterByDealership(overdueFuData.items || [], selectedDealershipId))
            setTodayFollowUps(filterByDealership(todayFuData.items || [], selectedDealershipId))
            setTodayAppointments(filterByDealership(todayApptData.items || [], selectedDealershipId))
            setUpcomingAppointments(filterByDealership(upcomingApptData.items || [], selectedDealershipId))

            const accessibleIds = new Set(statsData.dealerships.map((d) => d.id))
            const visits = (showroomCurrent.visits || []).filter((v) => {
                if (selectedDealershipId) return v.dealership_id === selectedDealershipId
                return accessibleIds.has(v.dealership_id)
            })
            setShowroomInShowroom(visits.length)
            const startToday = startOfDay(now)
            setShowroomCheckedInToday(
                visits.filter((v) => new Date(v.checked_in_at) >= startToday).length
            )
            setShowroomSoldToday(
                visits.filter((v) => v.outcome === "sold").length
            )
        } catch (error) {
            console.error("Failed to fetch BDC dashboard:", error)
        } finally {
            setIsLoading(false)
        }
    }, [selectedDealershipId])

    useStatsRefresh(loadData)
    useShowroomUpdates(loadData)
    useWebSocketEvent("lead:created", () => loadData(), [loadData])
    useWebSocketEvent("lead:updated", () => loadData(), [loadData])
    useWebSocketEvent("badges:refresh", () => loadData(), [loadData])
    useWebSocketEvent("stats:refresh", () => loadData(), [loadData])

    React.useEffect(() => {
        setIsLoading(true)
        loadData()
    }, [loadData])

    if (isLoading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!stats) {
        return (
            <div className="p-6 text-center text-muted-foreground">
                Unable to load dashboard. Ensure your Super Admin has assigned dealerships to your account.
            </div>
        )
    }

    const maxUnassigned = Math.max(...stats.dealerships.map((d) => d.unassigned_leads), 1)
    const freshCount = stats.fresh_leads ?? 0
    const scoped = getScopedMetrics(stats, selectedDealershipId)
    const unassignedHref = selectedDealershipId
        ? `/leads?dealership_id=${selectedDealershipId}&filter=unassigned`
        : "/leads?filter=unassigned"
    const freshHref = selectedDealershipId
        ? `/leads?dealership_id=${selectedDealershipId}&filter=fresh`
        : "/leads?filter=fresh"

    return (
        <div className="space-y-8 p-6 pb-10">
            {/* Header — aligned with dealership admin dashboard */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">BDC Dashboard</h1>
                    <p className="text-muted-foreground">
                        {selectedDealershipId
                            ? `Managing ${selectedDealershipName} — assign leads and track performance.`
                            : `Manage leads across ${stats.dealership_count} dealerships and track performance.`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <BdcDealershipSwitcher className="min-w-[180px]" />
                    {scoped.unassigned > 0 && (
                        <Link href={unassignedHref}>
                            <Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50">
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                {scoped.unassigned} Leads Need Assignment
                            </Button>
                        </Link>
                    )}
                    <Link href={selectedDealershipId ? `/leads?dealership_id=${selectedDealershipId}` : "/leads"}>
                        <Button leftIcon={<Inbox className="h-4 w-4" />}>
                            View All Leads
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Dealership live status */}
            {showroomInShowroom > 0 && (
                <Card className="border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950">
                    <CardContent className="flex flex-wrap items-center gap-4 p-4">
                        <div className="rounded-full bg-teal-100 p-3 dark:bg-teal-900">
                            <Store className="h-6 w-6 text-teal-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-3xl font-bold text-teal-700 dark:text-teal-300">
                                {showroomInShowroom}
                            </p>
                            <p className="text-sm text-teal-600 dark:text-teal-400">
                                Customers in Dealership Right Now
                                {selectedDealershipId ? ` · ${selectedDealershipName}` : ""}
                            </p>
                        </div>
                        <div className="text-right mr-4">
                            <p className="text-lg font-semibold text-teal-700 dark:text-teal-300">
                                {showroomCheckedInToday} today
                            </p>
                            <p className="text-sm text-teal-600 dark:text-teal-400">
                                {showroomSoldToday} sold
                            </p>
                        </div>
                        <Link href="/showroom">
                            <Button variant="outline" className="border-teal-300 text-teal-700">
                                View Dealership
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}

            {/* Follow-up alerts */}
            {(scoped.pendingFollowUps > 0 || scoped.overdueFollowUps > 0) && (
                <div className="flex flex-wrap gap-4">
                    {scoped.pendingFollowUps > 0 && (
                        <Card className="flex-1 min-w-[280px] border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
                            <CardContent className="flex items-center gap-4 p-4">
                                <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900">
                                    <Clock className="h-5 w-5 text-amber-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-amber-700 dark:text-amber-300">
                                        {scoped.pendingFollowUps} Follow-ups Due Today
                                    </p>
                                    <p className="text-sm text-amber-600 dark:text-amber-400">
                                        Scheduled for today
                                    </p>
                                </div>
                                <Link href="/follow-ups?filter=pending&date_preset=today" className="ml-auto">
                                    <Button variant="outline" size="sm" className="border-amber-300 text-amber-700">
                                        View All
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                    {scoped.overdueFollowUps > 0 && (
                        <Card className="flex-1 min-w-[280px] border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950">
                            <CardContent className="flex items-center gap-4 p-4">
                                <div className="rounded-full bg-rose-100 p-2 dark:bg-rose-900">
                                    <AlertTriangle className="h-5 w-5 text-rose-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-rose-700 dark:text-rose-300">
                                        {scoped.overdueFollowUps} Overdue Follow-ups
                                    </p>
                                    <p className="text-sm text-rose-600 dark:text-rose-400">
                                        Requires immediate attention
                                    </p>
                                </div>
                                <Link href="/follow-ups?filter=overdue" className="ml-auto">
                                    <Button variant="outline" size="sm" className="border-rose-300 text-rose-700">
                                        View All
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Today's & upcoming appointments */}
            {(todayAppointments.length > 0 || upcomingAppointments.length > 0) && (
                <div className="grid gap-4 md:grid-cols-2">
                    {todayAppointments.length > 0 && (
                        <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div className="flex items-center gap-2">
                                    <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900">
                                        <CalendarClock className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <CardTitle className="text-base font-semibold text-blue-700 dark:text-blue-300">
                                        Today&apos;s Appointments ({todayAppointments.length})
                                    </CardTitle>
                                </div>
                                <Link href="/appointments?filter=today">
                                    <Button variant="outline" size="sm" className="border-blue-300 text-blue-700">
                                        View All
                                    </Button>
                                </Link>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {todayAppointments.slice(0, 4).map((apt) => (
                                        <Link key={apt.id} href={apt.lead_id ? `/leads/${apt.lead_id}` : "/appointments"}>
                                            <div className="flex items-center justify-between bg-white dark:bg-blue-900/50 rounded-lg p-3 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors cursor-pointer">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="text-center min-w-[50px] shrink-0">
                                                        <p className="text-sm font-bold text-blue-600">
                                                            {formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" })}
                                                        </p>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-sm truncate">{apt.title}</p>
                                                        {apt.lead?.customer && (
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                with {apt.lead.customer.full_name || `${apt.lead.customer.first_name || ""} ${apt.lead.customer.last_name || ""}`.trim()}
                                                            </p>
                                                        )}
                                                        {apt.dealership?.name && (
                                                            <p className="text-xs text-muted-foreground truncate">{apt.dealership.name}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="shrink-0 ml-2">
                                                    {getAppointmentStatusLabel(apt.status)}
                                                </Badge>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {upcomingAppointments.length > 0 && (
                        <Card className="border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div className="flex items-center gap-2">
                                    <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900">
                                        <Clock className="h-5 w-5 text-purple-600" />
                                    </div>
                                    <CardTitle className="text-base font-semibold text-purple-700 dark:text-purple-300">
                                        Upcoming Appointments
                                    </CardTitle>
                                </div>
                                <Link href="/appointments?status=scheduled">
                                    <Button variant="outline" size="sm" className="border-purple-300 text-purple-700">
                                        View All
                                    </Button>
                                </Link>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {upcomingAppointments.map((apt) => (
                                        <Link key={apt.id} href={apt.lead_id ? `/leads/${apt.lead_id}` : "/appointments"}>
                                            <div className="flex items-center justify-between bg-white dark:bg-purple-900/50 rounded-lg p-3 hover:bg-purple-100 dark:hover:bg-purple-800/50 transition-colors cursor-pointer">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="text-center min-w-[70px] shrink-0">
                                                        <p className="text-xs text-purple-500">
                                                            {formatDateInTimezone(apt.scheduled_at, timezone, { dateStyle: "short" })}
                                                        </p>
                                                        <p className="text-sm font-bold text-purple-600">
                                                            {formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" })}
                                                        </p>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-sm truncate">{apt.title}</p>
                                                        {apt.dealership?.name && (
                                                            <p className="text-xs text-muted-foreground truncate">{apt.dealership.name}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="shrink-0 ml-2">
                                                    {getAppointmentStatusLabel(apt.status)}
                                                </Badge>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Fresh leads table */}
            {scoped.fresh > 0 && freshLeadsTop.length > 0 && (
                <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="flex items-center gap-2">
                            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900">
                                <Inbox className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                                <CardTitle className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
                                    Fresh Leads (untouched)
                                </CardTitle>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                                    No activity yet — assign and reach out
                                </p>
                            </div>
                        </div>
                        <Link href={freshHref}>
                            <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700">
                                View Fresh Leads
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-emerald-100/50 dark:bg-emerald-900/30 border-0">
                                    <TableHead className="text-emerald-800 dark:text-emerald-200">Lead</TableHead>
                                    <TableHead className="text-emerald-800 dark:text-emerald-200">Status</TableHead>
                                    <TableHead className="text-emerald-800 dark:text-emerald-200">Assigned</TableHead>
                                    <TableHead className="text-emerald-800 dark:text-emerald-200">Contact</TableHead>
                                    <TableHead className="text-right text-emerald-800 dark:text-emerald-200">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {freshLeadsTop.map((lead) => (
                                    <TableRow
                                        key={lead.id}
                                        className="cursor-pointer hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 border-emerald-200/50"
                                        onClick={() => { window.location.href = `/leads/${lead.id}` }}
                                    >
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold dark:bg-emerald-900 dark:text-emerald-300">
                                                    {(lead.customer?.first_name || "?").charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-sm text-emerald-900 dark:text-emerald-100">
                                                        {getLeadFullName(lead)}
                                                    </p>
                                                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                                        {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
                                                    </p>
                                                    {lead.dealership?.name && (
                                                        <p className="text-xs text-emerald-600/80">{lead.dealership.name}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge size="sm" style={{ backgroundColor: getStageColor(lead.stage), color: "#fff" }}>
                                                {getStageLabel(lead.stage)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <p className="text-xs">
                                                {lead.assigned_to_user
                                                    ? `${lead.assigned_to_user.first_name} ${lead.assigned_to_user.last_name}`
                                                    : "—"}
                                            </p>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {getLeadPhone(lead) && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {getLeadPhone(lead)}
                                                    </span>
                                                )}
                                                {getLeadEmail(lead) && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Mail className="h-3 w-3" />
                                                        {getLeadEmail(lead)}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Link href={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()}>
                                                <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700">
                                                    Open
                                                </Button>
                                            </Link>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Existing BDC dashboard sections */}
            <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Needs your attention
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard
                        title="Unassigned leads"
                        metric={stats.unassigned_to_salesperson.toLocaleString()}
                        description="Assign a primary salesperson"
                        icon={<UserPlus className="h-5 w-5" />}
                        color="amber"
                        href="/leads?filter=unassigned"
                        actionLabel="Assign now"
                    />
                    <MetricCard
                        title="Fresh leads"
                        metric={freshCount.toLocaleString()}
                        description="Untouched — reach out first"
                        icon={<Sparkles className="h-5 w-5" />}
                        color="emerald"
                        href="/leads?filter=fresh"
                        actionLabel="View fresh"
                    />
                    <MetricCard
                        title="Overdue follow-ups"
                        metric={stats.overdue_follow_ups.toLocaleString()}
                        description="Past due — contact today"
                        icon={<AlertTriangle className="h-5 w-5" />}
                        color="rose"
                        href="/follow-ups?filter=overdue"
                        actionLabel="Resolve overdue"
                    />
                    <MetricCard
                        title="Follow-ups today"
                        metric={stats.todays_follow_ups.toLocaleString()}
                        description="Scheduled for today"
                        icon={<ClipboardList className="h-5 w-5" />}
                        color="purple"
                        href="/follow-ups?filter=pending&date_preset=today"
                        actionLabel="View today"
                    />
                </div>
            </div>

            {/* Secondary metrics */}
            <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Pipeline overview
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard
                        title="Total leads"
                        metric={stats.total_leads.toLocaleString()}
                        icon={<Inbox className="h-5 w-5" />}
                        color="blue"
                        href="/leads?filter=all"
                        actionLabel="Browse all"
                    />
                    <MetricCard
                        title="Active leads"
                        metric={stats.active_leads.toLocaleString()}
                        icon={<CheckCircle className="h-5 w-5" />}
                        color="emerald"
                        href="/leads?filter=all"
                        actionLabel="View active"
                    />
                    <MetricCard
                        title="Conversion rate"
                        metric={stats.conversion_rate}
                        description={`${stats.converted_leads} converted`}
                        icon={<ArrowUpRight className="h-5 w-5" />}
                        color="blue"
                        href="/leads?filter=converted"
                        actionLabel="View converted"
                    />
                    <MetricCard
                        title="Upcoming appointments"
                        metric={stats.upcoming_appointments.toLocaleString()}
                        icon={<CalendarClock className="h-5 w-5" />}
                        color="purple"
                        href="/appointments?status=scheduled"
                        actionLabel="Open calendar"
                    />
                </div>
            </div>

            {/* Work queues — always visible */}
            <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Work queues
                </h2>
                <div className="grid gap-6 xl:grid-cols-3">
                    <WorkQueueCard
                        title="Fresh leads"
                        icon={<Sparkles className="h-5 w-5 text-emerald-600" />}
                        href="/leads?filter=fresh"
                        hrefLabel={`All (${freshCount})`}
                        accentClass="border-emerald-200/80 dark:border-emerald-900"
                        headerClass="bg-emerald-50/80 dark:bg-emerald-950/40"
                        emptyMessage="No untouched leads right now."
                        emptyAction={{ label: "View all leads", href: "/leads" }}
                    >
                        {freshLeads.map((lead) => (
                            <li key={lead.id}>
                                <Link
                                    href={`/leads/${lead.id}`}
                                    className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm">{getLeadFullName(lead)}</p>
                                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                            {lead.dealership?.name && (
                                                <span className="inline-flex items-center gap-0.5">
                                                    <Building2 className="h-3 w-3" />
                                                    {lead.dealership.name}
                                                </span>
                                            )}
                                            {getLeadPhone(lead) && (
                                                <span className="inline-flex items-center gap-0.5">
                                                    <Phone className="h-3 w-3" />
                                                    {getLeadPhone(lead)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="shrink-0 border-emerald-400 text-emerald-700">
                                        Fresh
                                    </Badge>
                                </Link>
                            </li>
                        ))}
                    </WorkQueueCard>

                    <WorkQueueCard
                        title="Follow-ups"
                        icon={<ClipboardList className="h-5 w-5 text-purple-600" />}
                        href="/follow-ups"
                        hrefLabel="All follow-ups"
                        accentClass="border-purple-200/80 dark:border-purple-900"
                        headerClass="bg-purple-50/80 dark:bg-purple-950/40"
                        emptyMessage="No overdue or due-today follow-ups."
                        emptyAction={{ label: "Schedule follow-up", href: "/follow-ups" }}
                    >
                        {overdueFollowUps.length > 0 && (
                            <li className="mb-3">
                                <p className="mb-2 text-xs font-semibold uppercase text-rose-600">Overdue</p>
                                <ul className="space-y-2">
                                    {overdueFollowUps.map((fu) => (
                                        <li key={fu.id}>
                                            <Link
                                                href={`/leads/${fu.lead_id}`}
                                                className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 hover:bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-medium text-sm">{followUpLeadName(fu)}</p>
                                                    <p className="text-xs text-rose-600">
                                                        Due{" "}
                                                        {formatRelativeTimeInTimezone(fu.scheduled_at, timezone)}
                                                    </p>
                                                </div>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-rose-400" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )}
                        {todayFollowUps.length > 0 && (
                            <li>
                                <p className="mb-2 text-xs font-semibold uppercase text-purple-600">Due today</p>
                                <ul className="space-y-2">
                                    {todayFollowUps.map((fu) => (
                                        <li key={fu.id}>
                                            <Link
                                                href={`/leads/${fu.lead_id}`}
                                                className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 hover:border-purple-300 hover:bg-purple-50/50"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-medium text-sm">{followUpLeadName(fu)}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatDateInTimezone(fu.scheduled_at, timezone, {
                                                            timeStyle: "short",
                                                        })}
                                                    </p>
                                                </div>
                                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )}
                    </WorkQueueCard>

                    <WorkQueueCard
                        title="Appointments"
                        icon={<CalendarClock className="h-5 w-5 text-blue-600" />}
                        href="/appointments"
                        hrefLabel="All appointments"
                        accentClass="border-blue-200/80 dark:border-blue-900"
                        headerClass="bg-blue-50/80 dark:bg-blue-950/40"
                        emptyMessage="No appointments today or coming up."
                        emptyAction={{ label: "Open appointments", href: "/appointments" }}
                    >
                        {todayAppointments.length > 0 && (
                            <li className="mb-3">
                                <p className="mb-2 text-xs font-semibold uppercase text-blue-600">Today</p>
                                <ul className="space-y-2">
                                    {todayAppointments.map((appt) => (
                                        <li key={appt.id}>
                                            <Link
                                                href={appt.lead_id ? `/leads/${appt.lead_id}` : "/appointments"}
                                                className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 hover:bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30"
                                            >
                                                <div className="min-w-0 flex items-center gap-3">
                                                    <span className="text-sm font-bold tabular-nums text-blue-700">
                                                        {formatDateInTimezone(appt.scheduled_at, timezone, {
                                                            timeStyle: "short",
                                                        })}
                                                    </span>
                                                    <div>
                                                        <p className="font-medium text-sm truncate">{appt.title}</p>
                                                        {appt.dealership?.name && (
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {appt.dealership.name}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="shrink-0 text-xs">
                                                    {getAppointmentStatusLabel(appt.status)}
                                                </Badge>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )}
                        {upcomingAppointments.length > 0 && (
                            <li>
                                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Upcoming</p>
                                <ul className="space-y-2">
                                    {upcomingAppointments.map((appt) => (
                                        <li key={appt.id}>
                                            <Link
                                                href={appt.lead_id ? `/leads/${appt.lead_id}` : "/appointments"}
                                                className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 hover:bg-muted/50"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatDateInTimezone(appt.scheduled_at, timezone, {
                                                            dateStyle: "short",
                                                        })}
                                                    </p>
                                                    <p className="font-medium text-sm">{appt.title}</p>
                                                </div>
                                                <span className="text-sm font-semibold text-primary tabular-nums">
                                                    {formatDateInTimezone(appt.scheduled_at, timezone, {
                                                        timeStyle: "short",
                                                    })}
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )}
                    </WorkQueueCard>
                </div>
            </div>

            {/* By dealership */}
            {stats.dealerships.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Building2 className="h-5 w-5 text-muted-foreground" />
                            By dealership
                        </CardTitle>
                        <p className="text-sm font-normal text-muted-foreground">
                            Click any number to open a filtered list for that store.
                        </p>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Dealership</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Unassigned</TableHead>
                                    <TableHead className="text-right">Fresh</TableHead>
                                    <TableHead className="text-right">Overdue F/U</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.dealerships.map((d) => (
                                    <DealershipRow key={d.id} d={d} maxUnassigned={maxUnassigned} />
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
