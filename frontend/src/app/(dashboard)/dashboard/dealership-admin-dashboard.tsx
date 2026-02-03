"use client"

import * as React from "react"
import Link from "next/link"
import {
    Users,
    Inbox,
    CheckCircle,
    Clock,
    AlertTriangle,
    Plus,
    ArrowUpRight,
    Loader2,
    UserPlus,
    ClipboardList,
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
import { UserAvatar } from "@/components/ui/avatar"
import { DashboardService, DealershipAdminStats } from "@/services/dashboard-service"
import { TeamService, UserWithStats } from "@/services/team-service"
import { AppointmentService, Appointment, getAppointmentStatusLabel } from "@/services/appointment-service"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { BarChart } from "@tremor/react"

export function DealershipAdminDashboard() {
    const [stats, setStats] = React.useState<DealershipAdminStats | null>(null)
    const [team, setTeam] = React.useState<UserWithStats[]>([])
    const [todayAppointments, setTodayAppointments] = React.useState<Appointment[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const { timezone } = useDealershipTimezone()

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const [statsData, teamData, appointmentsData] = await Promise.all([
                    DashboardService.getDealershipAdminStats(),
                    TeamService.getTeamWithStats(),
                    AppointmentService.list({ today_only: true, page_size: 10 }).catch(() => ({ items: [] }))
                ])
                setStats(statsData)
                setTeam(teamData.items)
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
            icon: Inbox,
            color: "blue" as const
        },
        {
            name: "Unassigned Leads",
            value: stats.unassigned_to_salesperson.toLocaleString(),
            icon: ClipboardList,
            color: "amber" as const,
            urgent: stats.unassigned_to_salesperson > 10
        },
        {
            name: "Active Leads",
            value: stats.active_leads.toLocaleString(),
            icon: Clock,
            color: "purple" as const
        },
        {
            name: "Converted",
            value: stats.converted_leads.toLocaleString(),
            icon: CheckCircle,
            color: "emerald" as const
        },
        {
            name: "Conversion Rate",
            value: stats.conversion_rate,
            icon: ArrowUpRight,
            color: "emerald" as const
        },
        {
            name: "Team Size",
            value: stats.team_size.toString(),
            icon: Users,
            color: "blue" as const
        },
    ] : []

    // Team performance chart data
    const teamChartData = team.slice(0, 6).map(member => ({
        name: `${member.first_name} ${member.last_name.charAt(0)}.`,
        "Active Leads": member.active_leads,
        "Converted": member.converted_leads
    }))

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dealership Dashboard</h1>
                    <p className="text-muted-foreground">Manage your team and track lead performance.</p>
                </div>
                <div className="flex gap-2">
                    {stats && stats.unassigned_to_salesperson > 0 && (
                        <Link href="/leads?filter=unassigned">
                            <Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50">
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                {stats.unassigned_to_salesperson} Leads Need Assignment
                            </Button>
                        </Link>
                    )}
                    <Link href="/team">
                        <Button leftIcon={<UserPlus className="h-4 w-4" />}>
                            Add Team Member
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Follow-up Alerts */}
            {stats && (stats.pending_follow_ups > 0 || stats.overdue_follow_ups > 0) && (
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
                    {stats.pending_follow_ups > 0 && (
                        <Card className="flex-1 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
                            <CardContent className="flex items-center gap-4 p-4">
                                <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900">
                                    <Clock className="h-5 w-5 text-amber-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-amber-700 dark:text-amber-300">
                                        {stats.pending_follow_ups} Follow-ups Due Today
                                    </p>
                                    <p className="text-sm text-amber-600 dark:text-amber-400">
                                        Scheduled for today
                                    </p>
                                </div>
                                <Link href="/follow-ups?filter=today" className="ml-auto">
                                    <Button variant="outline" size="sm" className="border-amber-300 text-amber-700">
                                        View All
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Today's Appointments Widget */}
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
                            {todayAppointments.slice(0, 4).map((apt) => (
                                <div 
                                    key={apt.id} 
                                    className="flex items-center justify-between bg-white dark:bg-blue-900/50 rounded-lg p-3"
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
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
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
                        />
                    ))
                )}
            </div>

            {/* Team Performance */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Team Chart */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold">Team Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex h-64 items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : team.length === 0 ? (
                            <div className="flex h-64 flex-col items-center justify-center text-center">
                                <Users className="h-10 w-10 text-muted-foreground/20 mb-2" />
                                <p className="text-sm text-muted-foreground">No team members yet</p>
                                <Link href="/team" className="mt-2">
                                    <Button size="sm" variant="outline">Add Team Member</Button>
                                </Link>
                            </div>
                        ) : (
                            <BarChart
                                data={teamChartData}
                                index="name"
                                categories={["Active Leads", "Converted"]}
                                colors={["blue", "emerald"]}
                                className="h-64"
                                stack
                            />
                        )}
                    </CardContent>
                </Card>

                {/* Team List */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-semibold">Team Members</CardTitle>
                        <Link href="/team">
                            <Button variant="ghost" size="sm">
                                Manage Team
                                <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead>Member</TableHead>
                                <TableHead className="text-right">Active</TableHead>
                                <TableHead className="text-right">Converted</TableHead>
                                <TableHead className="text-right">Rate</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableLoading columns={4} rows={4} />
                            ) : team.length === 0 ? (
                                <TableEmpty
                                    icon={<Users className="h-8 w-8" />}
                                    title="No team members"
                                    action={
                                        <Link href="/team">
                                            <Button size="sm">
                                                <Plus className="mr-2 h-4 w-4" />
                                                Add Member
                                            </Button>
                                        </Link>
                                    }
                                />
                            ) : (
                                team.slice(0, 5).map((member) => (
                                    <TableRow key={member.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <UserAvatar user={member} size="sm" />
                                                <div>
                                                    <p className="font-medium text-sm">
                                                        {member.first_name} {member.last_name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {member.total_leads} total leads
                                                    </p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {member.active_leads}
                                        </TableCell>
                                        <TableCell className="text-right text-emerald-600 font-medium">
                                            {member.converted_leads}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant={
                                                member.conversion_rate >= 20 ? "converted" :
                                                member.conversion_rate >= 10 ? "interested" : "outline"
                                            }>
                                                {member.conversion_rate}%
                                            </Badge>
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
