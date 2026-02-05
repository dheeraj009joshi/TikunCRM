"use client"

import * as React from "react"
import Link from "next/link"
import {
    TrendingUp,
    Users,
    Building2,
    Inbox,
    Plus,
    ArrowUpRight,
    ArrowDownRight,
    Loader2,
    InboxIcon,
    Eye,
    CalendarClock
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
    TableEmpty,
    TableLoading
} from "@/components/ui/table"
import { 
    DashboardService, 
    SuperAdminStats, 
    DealershipPerformance,
    LeadsBySource 
} from "@/services/dashboard-service"
import { AppointmentService, Appointment, getAppointmentStatusLabel } from "@/services/appointment-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { DonutChart, BarChart } from "@tremor/react"

export function SuperAdminDashboard() {
    const [stats, setStats] = React.useState<SuperAdminStats | null>(null)
    const [dealerships, setDealerships] = React.useState<DealershipPerformance[]>([])
    const [leadsBySource, setLeadsBySource] = React.useState<LeadsBySource[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useBrowserTimezone()

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsData, dealershipData, sourceData, appointmentsData] = await Promise.all([
                    DashboardService.getSuperAdminStats(),
                    DashboardService.getDealershipPerformance(10),
                    DashboardService.getLeadsBySource(),
                    AppointmentService.list({ today_only: true, page_size: 10 }).catch(() => ({ items: [] }))
                ])
                setStats(statsData)
                setDealerships(dealershipData)
                setLeadsBySource(sourceData)
                setTodayAppointments(appointmentsData.items || [])
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
            name: "Total Leads",
            value: stats.total_leads.toLocaleString(),
            change: stats.leads_change,
            trend: stats.leads_change.startsWith("+") ? "up" : "down",
            icon: Inbox,
            color: "blue" as const,
            href: "/leads"
        },
        {
            name: "Unassigned Leads",
            value: stats.unassigned_leads.toLocaleString(),
            trend: "neutral",
            icon: InboxIcon,
            color: "amber" as const,
            href: "/leads/unassigned"
        },
        {
            name: "Active Dealerships",
            value: `${stats.active_dealerships}/${stats.total_dealerships}`,
            change: stats.dealerships_change,
            trend: "up",
            icon: Building2,
            color: "purple" as const,
            href: "/dealerships"
        },
        {
            name: "Conversion Rate",
            value: stats.conversion_rate,
            change: stats.conversion_change,
            trend: stats.conversion_change.startsWith("+") ? "up" : "down",
            icon: TrendingUp,
            color: "emerald" as const,
            href: "/leads?status=converted"
        },
        {
            name: "Sales Force",
            value: stats.total_salesforce.toLocaleString(),
            change: stats.salesforce_change,
            trend: "up",
            icon: Users,
            color: "blue" as const,
            href: "/team"
        },
    ] : []

    // Format source data for chart
    const sourceChartData = leadsBySource.map(item => ({
        name: item.source.replace('_', ' ').toUpperCase(),
        value: item.count
    }))

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
                    <p className="text-muted-foreground">Monitor performance across all dealerships.</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/leads/unassigned">
                        <Button variant="outline" leftIcon={<InboxIcon className="h-4 w-4" />}>
                            Unassigned Pool
                            {stats && stats.unassigned_leads > 0 && (
                                <Badge variant="new" className="ml-2">
                                    {stats.unassigned_leads}
                                </Badge>
                            )}
                        </Button>
                    </Link>
                    <Link href="/dealerships">
                        <Button leftIcon={<Plus className="h-4 w-4" />}>
                            Create Dealership
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Today's Appointments Widget */}
            {todayAppointments.length > 0 && (
                <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="flex items-center gap-2">
                            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900">
                                <CalendarClock className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                                <CardTitle className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
                                    Today's Appointments ({todayAppointments.length})
                                </CardTitle>
                            </div>
                        </div>
                        <Link href="/appointments?filter=today">
                            <Button variant="outline" size="sm" className="border-emerald-300 text-emerald-700">
                                View All
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                            {todayAppointments.slice(0, 4).map((apt) => (
                                <div 
                                    key={apt.id} 
                                    className="flex items-center gap-3 bg-white dark:bg-emerald-900/50 rounded-lg p-3"
                                >
                                    <div className="text-center min-w-[50px]">
                                        <p className="text-sm font-bold text-emerald-600">
                                            {formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" })}
                                        </p>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm truncate">{apt.title}</p>
                                        {apt.lead && (
                                            <p className="text-xs text-muted-foreground truncate">
                                                {apt.lead.first_name} {apt.lead.last_name || ""}
                                            </p>
                                        )}
                                    </div>
                                    <Badge variant={
                                        apt.status === "completed" ? "converted" :
                                        apt.status === "cancelled" ? "destructive" :
                                        "outline"
                                    } className="shrink-0">
                                        {getAppointmentStatusLabel(apt.status)}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <Card key={i} className="h-32 animate-pulse">
                            <CardContent className="flex h-full items-center justify-center">
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
                            trend={stat.change ? {
                                value: stat.change,
                                isPositive: stat.trend === "up"
                            } : undefined}
                            color={stat.color}
                            href={stat.href}
                        />
                    ))
                )}
            </div>

            {/* Charts Row */}
            <div className="grid gap-6 lg:grid-cols-3">
                {/* Lead Sources Chart */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-base font-semibold">Lead Sources</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex h-48 items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <DonutChart
                                data={sourceChartData}
                                category="value"
                                index="name"
                                colors={["emerald", "blue", "gray", "indigo", "amber", "teal"]}
                                className="h-48"
                                showLabel
                                valueFormatter={(value) => value.toLocaleString()}
                            />
                        )}
                    </CardContent>
                </Card>

                {/* Dealership Performance Preview */}
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-semibold">Top Performing Dealerships</CardTitle>
                        <Link href="/analytics">
                            <Button variant="ghost" size="sm">
                                View All
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex h-48 items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <BarChart
                                data={dealerships.slice(0, 5).map(d => ({
                                    name: d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name,
                                    "Conversion Rate": d.conversion_rate,
                                    "Total Leads": d.total_leads
                                }))}
                                index="name"
                                categories={["Conversion Rate"]}
                                colors={["emerald"]}
                                className="h-48"
                                valueFormatter={(value) => `${value}%`}
                            />
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Dealership Performance Table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between border-b">
                    <CardTitle className="text-base font-semibold">Dealership Performance</CardTitle>
                    <Link href="/dealerships">
                        <Button variant="ghost" size="sm">
                            View detailed reports
                            <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Button>
                    </Link>
                </CardHeader>
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Dealership</TableHead>
                            <TableHead className="text-right">Total Leads</TableHead>
                            <TableHead className="text-right">Active</TableHead>
                            <TableHead className="text-right">Converted</TableHead>
                            <TableHead className="text-right">Conversion Rate</TableHead>
                            <TableHead className="text-right">Status</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableLoading columns={7} rows={5} />
                        ) : dealerships.length === 0 ? (
                            <TableEmpty
                                icon={<Building2 className="h-10 w-10" />}
                                title="No dealerships yet"
                                description="Create your first dealership to get started"
                                action={
                                    <Link href="/dealerships">
                                        <Button size="sm">
                                            <Plus className="mr-2 h-4 w-4" />
                                            Create Dealership
                                        </Button>
                                    </Link>
                                }
                            />
                        ) : (
                            dealerships.map((dealership, index) => (
                                <TableRow 
                                    key={dealership.id} 
                                    className="cursor-pointer hover:bg-muted/30"
                                >
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">
                                                {dealership.name.charAt(0)}
                                            </div>
                                            {dealership.name}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {dealership.total_leads.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {dealership.active_leads}
                                    </TableCell>
                                    <TableCell className="text-right text-emerald-600 font-medium">
                                        {dealership.converted_leads}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={
                                            dealership.conversion_rate >= 20 
                                                ? "text-emerald-600 font-bold" 
                                                : dealership.conversion_rate >= 10 
                                                    ? "text-amber-600" 
                                                    : "text-muted-foreground"
                                        }>
                                            {dealership.conversion_rate}%
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {index === 0 ? (
                                            <Badge variant="converted">Top Performer</Badge>
                                        ) : dealership.conversion_rate >= 15 ? (
                                            <Badge variant="interested">High</Badge>
                                        ) : (
                                            <Badge variant="outline">Normal</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Link href={`/dealerships/${dealership.id}`}>
                                            <Button variant="ghost" size="icon">
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>
        </div>
    )
}
