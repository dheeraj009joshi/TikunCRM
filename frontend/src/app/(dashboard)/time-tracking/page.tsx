"use client"

import * as React from "react"
import Link from "next/link"
import { format } from "date-fns"
import {
    AlertCircle,
    AlertTriangle,
    CalendarDays,
    CheckCircle,
    Clock,
    DollarSign,
    FileText,
    Loader2,
    Mail,
    MessageSquare,
    Pencil,
    Phone,
    PhoneCall,
    Send,
    Timer,
    Users,
} from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ClockWidget } from "@/components/time-tracking/clock-widget"
import { useRole } from "@/hooks/use-role"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useToast } from "@/hooks/use-toast"
import { getApiErrorMessage } from "@/lib/api-errors"
import { formatDateInLocal } from "@/utils/timezone"
import { formatElapsed, formatHours, formatMoney, formatPayHint, formatPercent, num } from "@/lib/time-tracking"
import {
    AgentRosterItem,
    HourCaps,
    PayoutPeriod,
    PayoutSummary,
    ShiftActivity,
    TimeEntry,
    TimeTrackingService,
} from "@/services/time-tracking-service"
import { ACTIVITY_TYPE_INFO, type ActivityType } from "@/services/activity-service"
import { cn } from "@/lib/utils"

const PERIODS: { id: PayoutPeriod; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "this_week", label: "This week" },
    { id: "last_week", label: "Last week" },
    { id: "this_month", label: "This month" },
    { id: "last_month", label: "Last month" },
    { id: "this_year", label: "This year" },
]

const WEEKDAY_CAPS: { key: keyof HourCaps; label: string }[] = [
    { key: "monday", label: "Mon" },
    { key: "tuesday", label: "Tue" },
    { key: "wednesday", label: "Wed" },
    { key: "thursday", label: "Thu" },
    { key: "friday", label: "Fri" },
    { key: "saturday", label: "Sat" },
    { key: "sunday", label: "Sun" },
]

function capInput(value: number | string | null | undefined): string {
    if (value == null || value === "") return ""
    return String(num(value))
}

function parseCap(raw: string): number | null {
    const t = raw.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) && n >= 0 ? n : null
}

function activityLabel(type: string): string {
    const info = ACTIVITY_TYPE_INFO[type as ActivityType]
    return info?.label || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function ActivityTypeIcon({ type }: { type: string }) {
    switch (type) {
        case "note_added":
            return <MessageSquare className="h-4 w-4 text-muted-foreground" />
        case "call_logged":
            return <PhoneCall className="h-4 w-4 text-emerald-600" />
        case "email_sent":
        case "email_received":
            return <Mail className="h-4 w-4 text-indigo-600" />
        case "sms_sent":
        case "whatsapp_sent":
            return <Send className="h-4 w-4 text-sky-600" />
        case "follow_up_scheduled":
        case "appointment_scheduled":
            return <CalendarDays className="h-4 w-4 text-amber-600" />
        case "follow_up_completed":
        case "appointment_completed":
            return <CheckCircle className="h-4 w-4 text-emerald-600" />
        case "follow_up_missed":
        case "appointment_cancelled":
            return <AlertCircle className="h-4 w-4 text-rose-600" />
        default:
            return <FileText className="h-4 w-4 text-muted-foreground" />
    }
}

function activityCounts(items: ShiftActivity[]): { type: string; label: string; count: number }[] {
    const map = new Map<string, number>()
    for (const item of items) {
        map.set(item.type, (map.get(item.type) || 0) + 1)
    }
    return [...map.entries()]
        .map(([type, count]) => ({ type, label: activityLabel(type), count }))
        .sort((a, b) => b.count - a.count)
}

function ShiftActivityRow({ item }: { item: ShiftActivity }) {
    const meta = item.meta_data || {}
    const duration = typeof meta.duration_seconds === "number" ? meta.duration_seconds : null
    return (
        <div className="flex gap-3 border-b py-3 last:border-0">
            <div className="mt-0.5 shrink-0">
                <ActivityTypeIcon type={item.type} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-normal">
                        {activityLabel(item.type)}
                    </Badge>
                    {item.lead_id ? (
                        <Link href={`/leads/${item.lead_id}`} className="text-sm font-medium text-primary hover:underline">
                            {item.lead_name || "Lead"}
                        </Link>
                    ) : item.lead_name ? (
                        <span className="text-sm font-medium">{item.lead_name}</span>
                    ) : null}
                    {duration != null && duration > 0 && (
                        <span className="text-xs text-muted-foreground">{formatElapsed(duration)}</span>
                    )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {item.description}
                </p>
            </div>
            <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {format(new Date(item.created_at), "MMM d, h:mm a")}
            </div>
        </div>
    )
}

function toDatetimeLocal(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TimeTrackingPage() {
    const { isBdc, isManagerOrAbove, user } = useRole()
    const isTimeAdmin = isManagerOrAbove
    const { timezone } = useBrowserTimezone()
    const { toast } = useToast()
    const [period, setPeriod] = React.useState<PayoutPeriod>("this_week")
    const [payouts, setPayouts] = React.useState<PayoutSummary | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [roster, setRoster] = React.useState<AgentRosterItem[]>([])
    const [clockedInCount, setClockedInCount] = React.useState(0)
    const [teamWeekPay, setTeamWeekPay] = React.useState(0)
    const [onCallCount, setOnCallCount] = React.useState(0)
    const [teamWeekCalls, setTeamWeekCalls] = React.useState(0)
    const [selectedAgentId, setSelectedAgentId] = React.useState<string>("me")
    const [rateAgent, setRateAgent] = React.useState<AgentRosterItem | null>(null)
    const [rateValue, setRateValue] = React.useState("")
    const [capWeek, setCapWeek] = React.useState("")
    const [capDays, setCapDays] = React.useState<Record<string, string>>({})
    const [savingRate, setSavingRate] = React.useState(false)
    const [approvingDay, setApprovingDay] = React.useState<string | null>(null)
    const [editEntry, setEditEntry] = React.useState<TimeEntry | null>(null)
    const [editIn, setEditIn] = React.useState("")
    const [editOut, setEditOut] = React.useState("")
    const [editReason, setEditReason] = React.useState("")
    const [editNotes, setEditNotes] = React.useState("")
    const [savingEdit, setSavingEdit] = React.useState(false)
    const [nowMs, setNowMs] = React.useState(() => Date.now())
    const [expandedEntryId, setExpandedEntryId] = React.useState<string | null>(null)

    const viewingOther = isTimeAdmin && selectedAgentId !== "me"

    const loadPayouts = React.useCallback(async () => {
        if (isTimeAdmin && !isBdc && selectedAgentId === "me") {
            setPayouts(null)
            return
        }
        try {
            const data = viewingOther
                ? await TimeTrackingService.adminPayouts(selectedAgentId, period, timezone)
                : await TimeTrackingService.getPayouts(period, timezone)
            setPayouts(data)
        } catch (err) {
            toast({
                title: "Could not load payouts",
                description: getApiErrorMessage(err),
                variant: "destructive",
            })
        }
    }, [period, timezone, selectedAgentId, viewingOther, isTimeAdmin, isBdc, toast])

    const loadRoster = React.useCallback(async () => {
        if (!isTimeAdmin) return
        try {
            const data = await TimeTrackingService.getRoster(timezone)
            setRoster(data.items)
            setClockedInCount(data.clocked_in_count)
            setOnCallCount(data.on_call_count ?? 0)
            setTeamWeekPay(num(data.team_week.estimated_pay))
            setTeamWeekCalls(num(data.team_week_calls?.talk_hours))
        } catch (err) {
            toast({
                title: "Could not load BDC roster",
                description: getApiErrorMessage(err),
                variant: "destructive",
            })
        }
    }, [isTimeAdmin, timezone, toast])

    React.useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            await Promise.all([loadPayouts(), loadRoster()])
            if (!cancelled) setLoading(false)
        })()
        return () => {
            cancelled = true
        }
    }, [loadPayouts, loadRoster])

    React.useEffect(() => {
        if (!roster.some((a) => a.is_clocked_in)) return
        const id = window.setInterval(() => setNowMs(Date.now()), 1000)
        return () => window.clearInterval(id)
    }, [roster])

    if (!isBdc && !isTimeAdmin) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        Time tracking is available for BDC agents, managers, and Super Admins.
                    </CardContent>
                </Card>
            </div>
        )
    }

    const totals = payouts?.totals
    const selectedAgent = roster.find((a) => a.id === selectedAgentId)

    const saveRate = async () => {
        if (!rateAgent) return
        const parsed = Number(rateValue)
        if (!Number.isFinite(parsed) || parsed < 0) {
            toast({ title: "Enter a valid hourly rate", variant: "destructive" })
            return
        }
        const caps: HourCaps = {
            max_hours_week: parseCap(capWeek),
            monday: parseCap(capDays.monday || ""),
            tuesday: parseCap(capDays.tuesday || ""),
            wednesday: parseCap(capDays.wednesday || ""),
            thursday: parseCap(capDays.thursday || ""),
            friday: parseCap(capDays.friday || ""),
            saturday: parseCap(capDays.saturday || ""),
            sunday: parseCap(capDays.sunday || ""),
        }
        setSavingRate(true)
        try {
            await TimeTrackingService.setHourlyRate(rateAgent.id, parsed, timezone)
            await TimeTrackingService.setHourCaps(rateAgent.id, caps, timezone)
            toast({
                title: "Pay settings saved",
                description: `${rateAgent.first_name}'s rate is ${formatMoney(parsed)}/hr. Hours over the daily/weekly caps are unpaid until you approve them.`,
            })
            setRateAgent(null)
            await loadRoster()
            await loadPayouts()
        } catch (err) {
            toast({ title: "Could not save pay settings", description: getApiErrorMessage(err), variant: "destructive" })
        } finally {
            setSavingRate(false)
        }
    }

    const approveDay = async (day: string, approved: boolean) => {
        const agentId = selectedAgentId === "me" ? user?.id : selectedAgentId
        if (!agentId || agentId === "me") return
        setApprovingDay(day)
        try {
            await TimeTrackingService.approveOverCapDay(agentId, day, approved, timezone)
            toast({
                title: approved ? "Extra hours approved" : "Approval removed",
                description: approved
                    ? "Hours over the cap for that day will be paid."
                    : "Hours over the cap for that day are unpaid again.",
            })
            await Promise.all([loadPayouts(), loadRoster()])
        } catch (err) {
            toast({ title: "Could not update approval", description: getApiErrorMessage(err), variant: "destructive" })
        } finally {
            setApprovingDay(null)
        }
    }

    const saveEdit = async () => {
        if (!editEntry || !editReason.trim()) {
            toast({ title: "Add a reason for this correction", variant: "destructive" })
            return
        }
        setSavingEdit(true)
        try {
            await TimeTrackingService.editEntry(editEntry.id, {
                clock_in_at: editIn ? new Date(editIn).toISOString() : undefined,
                clock_out_at: editOut ? new Date(editOut).toISOString() : undefined,
                notes: editNotes || undefined,
                reason: editReason.trim(),
            })
            toast({ title: "Punch corrected" })
            setEditEntry(null)
            await Promise.all([loadPayouts(), loadRoster()])
        } catch (err) {
            toast({ title: "Could not update punch", description: getApiErrorMessage(err), variant: "destructive" })
        } finally {
            setSavingEdit(false)
        }
    }

    const forceOut = async (entry: TimeEntry) => {
        try {
            await TimeTrackingService.forceClockOut(entry.id, "Forgot to clock out")
            toast({ title: "Force clocked out" })
            await Promise.all([loadPayouts(), loadRoster()])
        } catch (err) {
            toast({ title: "Could not clock out", description: getApiErrorMessage(err), variant: "destructive" })
        }
    }

    return (
        <div className="space-y-6 p-4 pb-10 sm:p-6">
            <PageHeader
                title={isTimeAdmin && !isBdc ? "BDC time & pay" : "My time & pay"}
                description={
                    isTimeAdmin && !isBdc
                        ? "Set each agent's hourly wage and max hours per day/week. Extra clocked time is unpaid until you approve it."
                        : "Clock in for your shift. Hours over your daily or weekly cap are unpaid until a manager approves them."
                }
            />

            {isBdc && <ClockWidget />}

            {isTimeAdmin && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryCard
                        icon={<Users className="h-4 w-4 text-emerald-600" />}
                        label="On the clock"
                        value={`${clockedInCount} agent${clockedInCount === 1 ? "" : "s"}`}
                    />
                    <SummaryCard
                        icon={<Phone className="h-4 w-4 text-sky-600" />}
                        label="On a call now"
                        value={`${onCallCount} agent${onCallCount === 1 ? "" : "s"}`}
                    />
                    <SummaryCard
                        icon={<Timer className="h-4 w-4 text-blue-600" />}
                        label="Team week on calls"
                        value={formatHours(teamWeekCalls)}
                    />
                    <SummaryCard
                        icon={<DollarSign className="h-4 w-4 text-amber-600" />}
                        label="Team week pay"
                        value={formatMoney(teamWeekPay)}
                    />
                </div>
            )}

            {isTimeAdmin && roster.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">BDC agents</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Agent</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Rate</TableHead>
                                    <TableHead className="text-right">Clocked today</TableHead>
                                    <TableHead className="text-right">On calls today</TableHead>
                                    <TableHead className="text-right">Clocked week</TableHead>
                                    <TableHead className="text-right">On calls week</TableHead>
                                    <TableHead className="text-right">Util.</TableHead>
                                    <TableHead className="text-right">Unpaid week</TableHead>
                                    <TableHead className="text-right">Week pay</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {roster.map((agent) => {
                                    const elapsed = agent.is_clocked_in && agent.clock_in_at
                                        ? Math.max(0, Math.floor((nowMs - new Date(agent.clock_in_at).getTime()) / 1000))
                                        : agent.elapsed_seconds
                                    return (
                                        <TableRow
                                            key={agent.id}
                                            className={cn(selectedAgentId === agent.id && "bg-muted/40")}
                                        >
                                            <TableCell>
                                                <button
                                                    type="button"
                                                    className="text-left font-medium hover:underline"
                                                    onClick={() => setSelectedAgentId(agent.id)}
                                                >
                                                    {agent.first_name} {agent.last_name}
                                                </button>
                                                <div className="text-xs text-muted-foreground">{agent.email}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    {agent.is_clocked_in ? (
                                                        <Badge variant="interested" className="w-fit font-mono tabular-nums">
                                                            In {formatElapsed(elapsed)}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="w-fit">Off</Badge>
                                                    )}
                                                    {agent.on_call && (
                                                        <Badge variant="outline" className="w-fit border-sky-300 text-sky-700 dark:text-sky-300">
                                                            <Phone className="mr-1 h-3 w-3" />
                                                            On call
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {agent.hourly_rate == null ? (
                                                    <span className="text-amber-600">Not set</span>
                                                ) : (
                                                    `${formatMoney(agent.hourly_rate)}/hr`
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatHours(agent.today.total_hours)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatHours(agent.today_calls?.talk_hours)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatHours(agent.this_week.total_hours)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatHours(agent.this_week_calls?.talk_hours)}
                                                {agent.this_week_calls?.call_count ? (
                                                    <div className="text-xs text-muted-foreground">{agent.this_week_calls.call_count} calls</div>
                                                ) : null}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatPercent(agent.this_week_calls?.utilization_pct)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {num(agent.this_week.unpaid_hours) > 0 ? (
                                                    <span className="text-amber-700 dark:text-amber-400">{formatHours(agent.this_week.unpaid_hours)}</span>
                                                ) : (
                                                    "—"
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatMoney(agent.this_week.estimated_pay)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setRateAgent(agent)
                                                        setRateValue(agent.hourly_rate != null ? String(num(agent.hourly_rate)) : "")
                                                        setCapWeek(capInput(agent.hour_caps?.max_hours_week))
                                                        setCapDays(
                                                            Object.fromEntries(
                                                                WEEKDAY_CAPS.map((d) => [d.key, capInput(agent.hour_caps?.[d.key])])
                                                            )
                                                        )
                                                    }}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    Pay & hours
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold">
                        {viewingOther && selectedAgent
                            ? `${selectedAgent.first_name} ${selectedAgent.last_name}'s timesheet`
                            : "Timesheet"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Clocked hours are attendance. On-call hours are connected talk time from Twilio. Utilization is talk time ÷ clocked time.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {isTimeAdmin && isBdc && (
                        <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Whose timesheet" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="me">My timesheet</SelectItem>
                                {roster.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                        {a.first_name} {a.last_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    {isTimeAdmin && !isBdc && selectedAgentId === "me" && roster[0] && (
                        <span className="text-xs text-muted-foreground">Select an agent above to open their timesheet.</span>
                    )}
                    <Tabs value={period} onValueChange={(v) => setPeriod(v as PayoutPeriod)}>
                        <TabsList className="h-auto flex-wrap">
                            {PERIODS.map((p) => (
                                <TabsTrigger key={p.id} value={p.id} className="text-xs sm:text-sm">
                                    {p.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            {loading && !payouts ? (
                <div className="flex h-40 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : isTimeAdmin && !isBdc && selectedAgentId === "me" ? (
                <Card>
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                        Click an agent name to review their daily hours and estimated payout.
                    </CardContent>
                </Card>
            ) : (() => {
                                    const callWork = payouts?.call_work
                    const clockedHours = num(totals?.total_hours)
                    const talkHours = num(callWork?.talk_hours)
                    const shiftActivities = payouts?.activities ?? []
                    const activitiesByEntry = new Map<string, ShiftActivity[]>()
                    for (const item of shiftActivities) {
                        if (!item.time_entry_id) continue
                        const list = activitiesByEntry.get(item.time_entry_id) || []
                        list.push(item)
                        activitiesByEntry.set(item.time_entry_id, list)
                    }
                    return (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                        <SummaryCard label="Clocked hours" value={formatHours(clockedHours)} />
                        <SummaryCard
                            label="Payable"
                            value={formatHours(totals?.payable_hours ?? clockedHours)}
                            hint="Within daily/weekly caps"
                        />
                        <SummaryCard
                            label="Unpaid over cap"
                            value={formatHours(totals?.unpaid_hours)}
                            hint="Needs manager approval to pay"
                        />
                        <SummaryCard
                            label="On calls"
                            value={formatHours(talkHours)}
                            hint={callWork?.call_count ? `${callWork.call_count} connected calls` : undefined}
                        />
                        <SummaryCard
                            label="Utilization"
                            value={formatPercent(callWork?.utilization_pct)}
                            hint="Talk time vs clocked time"
                        />
                        <SummaryCard
                            label="Estimated payout"
                            value={formatMoney(totals?.estimated_pay)}
                            highlight
                            hint={formatPayHint(
                                totals?.payable_hours ?? clockedHours,
                                payouts?.hourly_rate,
                                totals?.overtime_hours,
                                payouts?.overtime_multiplier
                            )}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Estimated pay is payable hours × the hourly rate on each punch (or the current rate if a punch has no rate saved). Overtime after 40h/week is 1.5×. Hours over the daily or weekly cap stay unpaid until a manager approves them.
                    </p>

                    {payouts?.hourly_rate == null && (
                        <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-4 w-4" />
                            Payouts show $0 until a manager sets an hourly rate. Hours are still tracked.
                        </p>
                    )}

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Daily breakdown</CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {!payouts?.days.length ? (
                                <p className="py-8 text-center text-sm text-muted-foreground">No hours in this period.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Day</TableHead>
                                            <TableHead className="text-right">Cap</TableHead>
                                            <TableHead className="text-right">Clocked</TableHead>
                                            <TableHead className="text-right">Payable</TableHead>
                                            <TableHead className="text-right">Unpaid</TableHead>
                                            <TableHead className="text-right">On calls</TableHead>
                                            <TableHead className="text-right">OT</TableHead>
                                            <TableHead className="text-right">Est. pay</TableHead>
                                            {isTimeAdmin && <TableHead />}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payouts.days.map((day) => (
                                            <TableRow key={day.date}>
                                                <TableCell>
                                                    <div className="font-medium">{day.weekday}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {format(new Date(day.date + "T12:00:00"), "MMM d, yyyy")}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                                    {day.daily_cap == null ? "—" : formatHours(day.daily_cap)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums font-medium">{formatHours(day.total_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatHours(day.payable_hours ?? day.total_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {num(day.unpaid_hours) > 0 ? (
                                                        <span className="font-medium text-amber-700 dark:text-amber-400">{formatHours(day.unpaid_hours)}</span>
                                                    ) : (
                                                        formatHours(day.unpaid_hours)
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">{formatHours(day.call_work?.talk_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatHours(day.overtime_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatMoney(day.estimated_pay)}</TableCell>
                                                {isTimeAdmin && (
                                                    <TableCell className="text-right">
                                                        {num(day.unpaid_hours) > 0 ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={approvingDay === day.date}
                                                                onClick={() => approveDay(day.date, true)}
                                                            >
                                                                {approvingDay === day.date && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                                                Approve extra
                                                            </Button>
                                                        ) : day.over_cap_approved ? (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                disabled={approvingDay === day.date}
                                                                onClick={() => approveDay(day.date, false)}
                                                            >
                                                                {approvingDay === day.date && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                                                Revoke extra
                                                            </Button>
                                                        ) : null}
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Work during clocked time</CardTitle>
                            <p className="text-sm font-normal text-muted-foreground">
                                Notes, calls, follow-ups, and other CRM activity logged while this person was clocked in.
                            </p>
                        </CardHeader>
                        <CardContent>
                            {shiftActivities.length === 0 ? (
                                <p className="py-8 text-center text-sm text-muted-foreground">
                                    No notes, calls, or other CRM activity during these clocked hours.
                                </p>
                            ) : (
                                <>
                                    <div className="mb-4 flex flex-wrap gap-2">
                                        {activityCounts(shiftActivities).map((row) => (
                                            <Badge key={row.type} variant="secondary" className="font-normal">
                                                {row.label}: {row.count}
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="max-h-[480px] overflow-y-auto pr-1">
                                        {shiftActivities.map((item) => (
                                            <ShiftActivityRow key={item.id} item={item} />
                                        ))}
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Punch log</CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {!payouts?.entries.length ? (
                                <p className="py-8 text-center text-sm text-muted-foreground">No punches in this period.</p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Clock in</TableHead>
                                            <TableHead>Clock out</TableHead>
                                            <TableHead className="text-right">Duration</TableHead>
                                            <TableHead className="text-right">Rate</TableHead>
                                            <TableHead className="text-right">Activity</TableHead>
                                            <TableHead>Notes</TableHead>
                                            {isTimeAdmin && <TableHead />}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payouts.entries.map((entry) => {
                                            const shiftItems = activitiesByEntry.get(entry.id) || []
                                            const expanded = expandedEntryId === entry.id
                                            return (
                                                <React.Fragment key={entry.id}>
                                            <TableRow
                                                className="cursor-pointer"
                                                onClick={() => setExpandedEntryId(expanded ? null : entry.id)}
                                            >
                                                <TableCell className="whitespace-nowrap">{formatDateInLocal(entry.clock_in_at)}</TableCell>
                                                <TableCell className="whitespace-nowrap">
                                                    {entry.is_open ? (
                                                        <Badge variant="interested">In progress</Badge>
                                                    ) : (
                                                        formatDateInLocal(entry.clock_out_at)
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums">
                                                    {formatElapsed(entry.duration_seconds)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {entry.hourly_rate == null
                                                        ? (payouts.hourly_rate == null
                                                            ? "—"
                                                            : `${formatMoney(payouts.hourly_rate)}/hr`)
                                                        : `${formatMoney(entry.hourly_rate)}/hr`}
                                                    {entry.hourly_rate == null && payouts.hourly_rate != null && (
                                                        <div className="text-[10px] font-normal text-muted-foreground">current rate</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {shiftItems.length}
                                                </TableCell>
                                                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                                                    {entry.over_cap_approved && (
                                                        <Badge variant="outline" className="mr-1 border-emerald-300 text-emerald-700">
                                                            Extra paid
                                                        </Badge>
                                                    )}
                                                    {entry.notes || entry.clock_in_note || entry.edit_reason || "—"}
                                                </TableCell>
                                                {isTimeAdmin && (
                                                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex justify-end gap-1">
                                                            {entry.is_open && (
                                                                <Button size="sm" variant="outline" onClick={() => forceOut(entry)}>
                                                                    Force out
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    setEditEntry(entry)
                                                                    setEditIn(toDatetimeLocal(entry.clock_in_at))
                                                                    setEditOut(toDatetimeLocal(entry.clock_out_at))
                                                                    setEditNotes(entry.notes || "")
                                                                    setEditReason("")
                                                                }}
                                                            >
                                                                Edit
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                            {expanded && (
                                                <TableRow>
                                                    <TableCell colSpan={isTimeAdmin ? 7 : 6} className="bg-muted/30">
                                                        {shiftItems.length === 0 ? (
                                                            <p className="py-2 text-sm text-muted-foreground">
                                                                No CRM activity during this punch.
                                                            </p>
                                                        ) : (
                                                            shiftItems.map((item) => (
                                                                <ShiftActivityRow key={item.id} item={item} />
                                                            ))
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                                </React.Fragment>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </>
                    )
                })()}

            <Dialog open={!!rateAgent} onOpenChange={(open) => !open && setRateAgent(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            Pay &amp; hours
                            {rateAgent ? ` — ${rateAgent.first_name} ${rateAgent.last_name}` : ""}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Hourly rate is saved on each new punch. Older punches with no rate saved use this current rate for estimated pay. Daily and weekly caps are payable limits — they can still clock extra hours, but that time is unpaid until you approve it.
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="hourly-rate">USD per hour</Label>
                        <Input
                            id="hourly-rate"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="20.00"
                            value={rateValue}
                            onChange={(e) => setRateValue(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="cap-week">Max payable hours / week</Label>
                        <Input
                            id="cap-week"
                            type="number"
                            min={0}
                            step="0.25"
                            placeholder="No weekly cap"
                            value={capWeek}
                            onChange={(e) => setCapWeek(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Max payable hours / day</Label>
                        <p className="text-xs text-muted-foreground">
                            Leave blank for no cap that day. Example: 6 on weekdays, 10 on Friday and Saturday, 0 on Sunday.
                        </p>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                            {WEEKDAY_CAPS.map((day) => (
                                <div key={day.key} className="space-y-1">
                                    <Label htmlFor={`cap-${day.key}`} className="text-xs">{day.label}</Label>
                                    <Input
                                        id={`cap-${day.key}`}
                                        type="number"
                                        min={0}
                                        max={24}
                                        step="0.25"
                                        placeholder="—"
                                        value={capDays[day.key] || ""}
                                        onChange={(e) => setCapDays((prev) => ({ ...prev, [day.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRateAgent(null)}>Cancel</Button>
                        <Button onClick={saveRate} disabled={savingRate}>
                            {savingRate && <Loader2 className="h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Correct a punch
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label htmlFor="edit-in">Clock in</Label>
                            <Input id="edit-in" type="datetime-local" value={editIn} onChange={(e) => setEditIn(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-out">Clock out</Label>
                            <Input id="edit-out" type="datetime-local" value={editOut} onChange={(e) => setEditOut(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-notes">Notes</Label>
                            <Textarea id="edit-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-reason">Reason for correction *</Label>
                            <Input
                                id="edit-reason"
                                placeholder="e.g. Forgot to clock out at lunch"
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
                        <Button onClick={saveEdit} disabled={savingEdit}>
                            {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                            Save correction
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function SummaryCard({
    label,
    value,
    icon,
    highlight,
    hint,
}: {
    label: string
    value: string
    icon?: React.ReactNode
    highlight?: boolean
    hint?: string
}) {
    return (
        <Card className={cn(highlight && "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20")}>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {icon}
                    {label}
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
            </CardContent>
        </Card>
    )
}
