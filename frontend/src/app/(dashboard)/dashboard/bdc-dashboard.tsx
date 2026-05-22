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
import { LeadService, Lead, getLeadFullName, getLeadPhone } from "@/services/lead-service"
import { AppointmentService, Appointment, getAppointmentStatusLabel } from "@/services/appointment-service"
import { FollowUpService, FollowUp } from "@/services/follow-up-service"
import { useStatsRefresh, useWebSocketEvent } from "@/hooks/use-websocket"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone, formatRelativeTimeInTimezone } from "@/utils/timezone"
import { cn } from "@/lib/utils"

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
    const [stats, setStats] = React.useState<BdcStats | null>(null)
    const [freshLeads, setFreshLeads] = React.useState<Lead[]>([])
    const [overdueFollowUps, setOverdueFollowUps] = React.useState<FollowUp[]>([])
    const [todayFollowUps, setTodayFollowUps] = React.useState<FollowUp[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [upcomingAppointments, setUpcomingAppointments] = React.useState<Appointment[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    const loadData = React.useCallback(async () => {
        const now = new Date()
        const todayFrom = startOfDay(now).toISOString()
        const todayTo = endOfDay(now).toISOString()

        try {
            const [
                statsData,
                freshData,
                overdueFuData,
                todayFuData,
                todayApptData,
                upcomingApptData,
            ] = await Promise.all([
                DashboardService.getBdcStats(),
                LeadService.listLeads({ fresh_only: true, page_size: 8 }).catch(() => ({ items: [] })),
                FollowUpService.listFollowUps({ overdue: true, status: "pending", page_size: 8 }).catch(() => ({
                    items: [],
                })),
                FollowUpService.listFollowUps({
                    status: "pending",
                    date_from: todayFrom,
                    date_to: todayTo,
                    page_size: 8,
                }).catch(() => ({ items: [] })),
                AppointmentService.list({ today_only: true, page_size: 8 }).catch(() => ({ items: [] })),
                AppointmentService.list({ upcoming_only: true, page_size: 6 }).catch(() => ({ items: [] })),
            ])
            setStats(statsData)
            setFreshLeads(freshData.items || [])
            setOverdueFollowUps(overdueFuData.items || [])
            setTodayFollowUps(todayFuData.items || [])
            setTodayAppointments(todayApptData.items || [])
            setUpcomingAppointments(upcomingApptData.items || [])
        } catch (error) {
            console.error("Failed to fetch BDC dashboard:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useStatsRefresh(loadData)
    useWebSocketEvent("lead:created", () => loadData(), [loadData])
    useWebSocketEvent("lead:updated", () => loadData(), [loadData])
    useWebSocketEvent("badges:refresh", () => loadData(), [loadData])
    useWebSocketEvent("stats:refresh", () => loadData(), [loadData])

    React.useEffect(() => {
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

    return (
        <div className="space-y-8 p-6 pb-10">
            {/* Hero header */}
            <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-background to-background p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">BDC Dashboard</h1>
                        <p className="mt-2 max-w-2xl text-muted-foreground">
                            Your command center across{" "}
                            <strong className="text-foreground">{stats.dealership_count} dealerships</strong>.
                            Tap any metric to jump straight into action.
                        </p>
                        {stats.dealerships.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {stats.dealerships.map((d) => (
                                    <Badge key={d.id} variant="secondary" className="font-normal">
                                        <Building2 className="mr-1 h-3 w-3" />
                                        {d.name}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>
                    <Button size="lg" asChild>
                        <Link href="/leads">
                            <Inbox className="mr-2 h-4 w-4" />
                            All leads
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Primary actions — click-through */}
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
