"use client"

import * as React from "react"
import Link from "next/link"
import {
    Inbox,
    CheckCircle,
    Clock,
    AlertTriangle,
    XCircle,
    ArrowUpRight,
    Loader2,
    Phone,
    Mail,
    Calendar,
    CalendarClock
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, MetricCard } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, getStatusVariant } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
    TableLoading
} from "@/components/ui/table"
import { DashboardService, SalespersonStats } from "@/services/dashboard-service"
import { LeadService, Lead } from "@/services/lead-service"
import { AppointmentService, Appointment, getAppointmentStatusLabel } from "@/services/appointment-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { DonutChart } from "@tremor/react"
import { useStatsRefresh } from "@/hooks/use-websocket"

export function SalespersonDashboard() {
    const [stats, setStats] = React.useState<SalespersonStats | null>(null)
    const [recentLeads, setRecentLeads] = React.useState<Lead[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [upcomingAppointments, setUpcomingAppointments] = React.useState<Appointment[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    const fetchStats = React.useCallback(async () => {
        try {
            const statsData = await DashboardService.getSalespersonStats()
            setStats(statsData)
        } catch (error) {
            console.error("Failed to fetch dashboard stats:", error)
        }
    }, [])

    // Listen for real-time stats refresh via WebSocket
    useStatsRefresh(React.useCallback(() => {
        fetchStats()
    }, [fetchStats]))

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsData, leadsData, todayData, upcomingData] = await Promise.all([
                    DashboardService.getSalespersonStats(),
                    LeadService.listLeads({ page: 1, page_size: 5 }),
                    AppointmentService.list({ today_only: true, page_size: 10 }).catch(() => ({ items: [] })),
                    AppointmentService.list({ upcoming_only: true, page_size: 3 }).catch(() => ({ items: [] }))
                ])
                setStats(statsData)
                setRecentLeads(leadsData.items)
                setTodayAppointments(todayData.items || [])
                setUpcomingAppointments(upcomingData.items || [])
            } catch (error) {
                console.error("Failed to fetch dashboard stats:", error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchData()
    }, [])

    const statCards = stats ? [
        {
            name: "My Leads",
            value: stats.total_leads.toLocaleString(),
            icon: Inbox,
            color: "blue" as const,
            href: "/leads"
        },
        {
            name: "Active Leads",
            value: stats.active_leads.toLocaleString(),
            icon: Clock,
            color: "purple" as const,
            href: "/leads?status=active"
        },
        {
            name: "Converted",
            value: stats.converted_leads.toLocaleString(),
            icon: CheckCircle,
            color: "emerald" as const,
            href: "/leads?filter=converted"
        },
        {
            name: "Lost",
            value: stats.lost_leads.toLocaleString(),
            icon: XCircle,
            color: "rose" as const,
            href: "/leads?status=lost"
        },
        {
            name: "Conversion Rate",
            value: stats.conversion_rate,
            icon: ArrowUpRight,
            color: "emerald" as const,
            href: "/leads?filter=converted"
        },
    ] : []

    // Lead status distribution for chart
    const statusChartData = stats ? Object.entries(stats.leads_by_status)
        .filter(([_, count]) => count > 0)
        .map(([status, count]) => ({
            name: status.replace('_', ' ').toUpperCase(),
            value: count
        })) : []

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
                    <p className="text-muted-foreground">Track your leads and follow-ups.</p>
                </div>
                <Link href="/leads">
                    <Button leftIcon={<Inbox className="h-4 w-4" />}>
                        View All Leads
                    </Button>
                </Link>
            </div>

            {/* Follow-up Alerts */}
            {stats && (stats.todays_follow_ups > 0 || stats.overdue_follow_ups > 0) && (
                <div className="flex gap-4">
                    {stats.overdue_follow_ups > 0 && (
                        <Card className="flex-1 border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950">
                            <CardContent className="flex items-center gap-4 p-4">
                                <div className="rounded-full bg-rose-100 p-2 dark:bg-rose-900">
                                    <AlertTriangle className="h-5 w-5 text-rose-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-rose-700 dark:text-rose-300">
                                        {stats.overdue_follow_ups} Overdue Follow-ups
                                    </p>
                                    <p className="text-sm text-rose-600 dark:text-rose-400">
                                        These need your immediate attention
                                    </p>
                                </div>
                                <Link href="/follow-ups?filter=overdue" className="ml-auto">
                                    <Button size="sm" className="bg-rose-600 hover:bg-rose-700">
                                        Handle Now
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                    {stats.todays_follow_ups > 0 && (
                        <Card className="flex-1 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
                            <CardContent className="flex items-center gap-4 p-4">
                                <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900">
                                    <Calendar className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-blue-700 dark:text-blue-300">
                                        {stats.todays_follow_ups} Follow-ups Today
                                    </p>
                                    <p className="text-sm text-blue-600 dark:text-blue-400">
                                        Scheduled for today
                                    </p>
                                </div>
                                <Link href="/follow-ups?filter=today" className="ml-auto">
                                    <Button variant="outline" size="sm" className="border-blue-300 text-blue-700">
                                        View Schedule
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Appointments Widgets - Today and Upcoming - Only show if there are any */}
            {(todayAppointments.length > 0 || upcomingAppointments.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
                {/* Today's Appointments - Only show if > 0 */}
                {todayAppointments.length > 0 && (
                <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="flex items-center gap-2">
                            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900">
                                <CalendarClock className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <CardTitle className="text-base font-semibold text-blue-700 dark:text-blue-300">
                                    Today's Appointments ({todayAppointments.length})
                                </CardTitle>
                            </div>
                        </div>
                        <Link href="/appointments?filter=today">
                            <Button variant="outline" size="sm" className="border-blue-300 text-blue-700">
                                View All
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                                {todayAppointments.slice(0, 3).map((apt) => (
                                    <Link key={apt.id} href={`/leads/${apt.lead_id}`}>
                                        <div 
                                            className="flex items-center justify-between bg-white dark:bg-blue-900/50 rounded-lg p-3 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="text-center min-w-[50px]">
                                                    <p className="text-sm font-bold text-blue-600">
                                                        {formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-sm">{apt.title}</p>
                                                    {apt.lead && (
                                                        <p className="text-xs text-muted-foreground">
                                                            with {apt.lead.first_name} {apt.lead.last_name || ""}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <Badge variant={
                                                apt.status === "completed" ? "converted" :
                                                apt.status === "cancelled" ? "destructive" :
                                                "outline"
                                            }>
                                                {getAppointmentStatusLabel(apt.status)}
                                            </Badge>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                    </CardContent>
                </Card>
                )}

                {/* Upcoming Appointments (next 3 days) - Only show if > 0 */}
                {upcomingAppointments.length > 0 && (
                <Card className="border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="flex items-center gap-2">
                            <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900">
                                <Clock className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <CardTitle className="text-base font-semibold text-purple-700 dark:text-purple-300">
                                    Upcoming Appointments
                                </CardTitle>
                            </div>
                        </div>
                        <Link href="/appointments">
                            <Button variant="outline" size="sm" className="border-purple-300 text-purple-700">
                                View All
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                                {upcomingAppointments.map((apt) => (
                                    <Link key={apt.id} href={`/leads/${apt.lead_id}`}>
                                        <div 
                                            className="flex items-center justify-between bg-white dark:bg-purple-900/50 rounded-lg p-3 hover:bg-purple-100 dark:hover:bg-purple-800/50 transition-colors cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="text-center min-w-[70px]">
                                                    <p className="text-xs text-purple-500">
                                                        {formatDateInTimezone(apt.scheduled_at, timezone, { dateStyle: "short" })}
                                                    </p>
                                                    <p className="text-sm font-bold text-purple-600">
                                                        {formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-sm">{apt.title}</p>
                                                    {apt.lead && (
                                                        <p className="text-xs text-muted-foreground">
                                                            with {apt.lead.first_name} {apt.lead.last_name || ""}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <Badge variant="outline">
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

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
                {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <Card key={i} className="animate-pulse">
                            <CardContent className="flex h-28 items-center justify-center">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground opacity-20" />
                            </CardContent>
                        </Card>
                    ))
                ) : (
                    statCards.map((stat) => (
                        <MetricCard
                            key={stat.name}
                            title={stat.name}
                            metric={stat.value}
                            icon={<stat.icon className="h-5 w-5" />}
                            color={stat.color}
                            href={stat.href}
                        />
                    ))
                )}
            </div>

            {/* Content Grid */}
            <div className="grid gap-6 lg:grid-cols-3">
                {/* Lead Status Distribution */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold">Lead Pipeline</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex h-48 items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : statusChartData.length === 0 ? (
                            <div className="flex h-48 flex-col items-center justify-center text-center">
                                <Inbox className="h-10 w-10 text-muted-foreground/20 mb-2" />
                                <p className="text-sm text-muted-foreground">No leads assigned yet</p>
                            </div>
                        ) : (
                            <DonutChart
                                data={statusChartData}
                                category="value"
                                index="name"
                                colors={["blue", "amber", "purple", "emerald", "gray", "rose"]}
                                className="h-48"
                                showLabel
                            />
                        )}
                    </CardContent>
                </Card>

                {/* Recent Leads */}
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-semibold">Recent Leads</CardTitle>
                        <Link href="/leads">
                            <Button variant="ghost" size="sm">
                                View All
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead>Lead</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableLoading columns={4} rows={5} />
                            ) : recentLeads.length === 0 ? (
                                <TableEmpty
                                    icon={<Inbox className="h-8 w-8" />}
                                    title="No leads assigned"
                                    description="Leads will appear here once assigned to you"
                                />
                            ) : (
                                recentLeads.map((lead) => (
                                    <TableRow 
                                        key={lead.id} 
                                        className="cursor-pointer hover:bg-muted/30"
                                        onClick={() => window.location.href = `/leads/${lead.id}`}
                                    >
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                                                    {lead.first_name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-sm">
                                                        {lead.first_name} {lead.last_name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
                                                    </p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getStatusVariant(lead.status)}>
                                                {lead.status.replace('_', ' ')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {lead.phone && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {lead.phone}
                                                    </span>
                                                )}
                                                {lead.email && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Mail className="h-3 w-3" />
                                                        {lead.email}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                {lead.phone && (
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            window.location.href = `tel:${lead.phone}`
                                                        }}
                                                    >
                                                        <Phone className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {lead.email && (
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            window.location.href = `mailto:${lead.email}`
                                                        }}
                                                    >
                                                        <Mail className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </Card>
            </div>
        </div>
    )
}
