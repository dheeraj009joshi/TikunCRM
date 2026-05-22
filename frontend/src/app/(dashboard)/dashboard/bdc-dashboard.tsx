"use client"

import * as React from "react"
import Link from "next/link"
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
import { DashboardService, BdcStats } from "@/services/dashboard-service"
import { LeadService, Lead, getLeadFullName } from "@/services/lead-service"
import { AppointmentService, Appointment } from "@/services/appointment-service"
import { useStatsRefresh } from "@/hooks/use-websocket"

export function BdcDashboard() {
    const [stats, setStats] = React.useState<BdcStats | null>(null)
    const [freshLeads, setFreshLeads] = React.useState<Lead[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [isLoading, setIsLoading] = React.useState(true)

    const loadData = React.useCallback(async () => {
        try {
            const [statsData, freshData, todayData] = await Promise.all([
                DashboardService.getBdcStats(),
                LeadService.listLeads({ fresh_only: true, page_size: 8 }).catch(() => ({ items: [] })),
                AppointmentService.list({ today_only: true, page_size: 8 }).catch(() => ({ items: [] })),
            ])
            setStats(statsData)
            setFreshLeads(freshData.items || [])
            setTodayAppointments(todayData.items || [])
        } catch (error) {
            console.error("Failed to fetch BDC dashboard:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useStatsRefresh(loadData)

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

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">BDC Dashboard</h1>
                    <p className="text-muted-foreground">
                        All assigned dealerships in one view ({stats.dealership_count} store
                        {stats.dealership_count !== 1 ? "s" : ""})
                    </p>
                </div>
                <Button asChild>
                    <Link href="/leads">
                        <Inbox className="mr-2 h-4 w-4" />
                        View all leads
                    </Link>
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    title="Total leads"
                    metric={stats.total_leads}
                    icon={<Inbox className="h-5 w-5" />}
                    color="blue"
                />
                <MetricCard
                    title="Unassigned"
                    metric={stats.unassigned_to_salesperson}
                    icon={<UserPlus className="h-5 w-5" />}
                    color="amber"
                />
                <MetricCard
                    title="Today's follow-ups"
                    metric={stats.todays_follow_ups}
                    icon={<ClipboardList className="h-5 w-5" />}
                    color="purple"
                />
                <MetricCard
                    title="Overdue follow-ups"
                    metric={stats.overdue_follow_ups}
                    icon={<AlertTriangle className="h-5 w-5" />}
                    color="rose"
                />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                    title="Active leads"
                    metric={stats.active_leads}
                    icon={<CheckCircle className="h-5 w-5" />}
                    color="emerald"
                />
                <MetricCard
                    title="Conversion rate"
                    metric={stats.conversion_rate}
                    icon={<Clock className="h-5 w-5" />}
                    color="blue"
                />
                <MetricCard
                    title="Upcoming appointments"
                    metric={stats.upcoming_appointments}
                    icon={<CalendarClock className="h-5 w-5" />}
                    color="purple"
                />
            </div>

            {stats.dealerships.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Building2 className="h-5 w-5" />
                            By dealership
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Dealership</TableHead>
                                    <TableHead className="text-right">Total leads</TableHead>
                                    <TableHead className="text-right">Unassigned</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.dealerships.map((d) => (
                                    <TableRow key={d.id}>
                                        <TableCell className="font-medium">{d.name}</TableCell>
                                        <TableCell className="text-right">{d.total_leads}</TableCell>
                                        <TableCell className="text-right">
                                            {d.unassigned_leads > 0 ? (
                                                <Badge variant="outline" className="text-amber-600 border-amber-300">
                                                    {d.unassigned_leads}
                                                </Badge>
                                            ) : (
                                                "0"
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">Fresh leads</CardTitle>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/leads?filter=fresh">View all</Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {freshLeads.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No untouched leads right now.</p>
                        ) : (
                            <ul className="space-y-2">
                                {freshLeads.map((lead) => (
                                    <li key={lead.id}>
                                        <Link
                                            href={`/leads/${lead.id}`}
                                            className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50"
                                        >
                                            <span className="font-medium">{getLeadFullName(lead)}</span>
                                            {lead.dealership?.name && (
                                                <Badge variant="outline">{lead.dealership.name}</Badge>
                                            )}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">Today&apos;s appointments</CardTitle>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/appointments">View all</Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {todayAppointments.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No appointments scheduled for today.</p>
                        ) : (
                            <ul className="space-y-2">
                                {todayAppointments.map((appt) => (
                                    <li
                                        key={appt.id}
                                        className="rounded-md border p-3 text-sm"
                                    >
                                        <p className="font-medium">{appt.title}</p>
                                        {appt.dealership?.name && (
                                            <p className="text-muted-foreground">{appt.dealership.name}</p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
