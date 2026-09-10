"use client"

import * as React from "react"
import { format } from "date-fns"
import {
    AlertTriangle,
    Clock,
    DollarSign,
    Loader2,
    Pencil,
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
import { formatElapsed, formatHours, formatMoney, num } from "@/lib/time-tracking"
import {
    AgentRosterItem,
    PayoutPeriod,
    PayoutSummary,
    TimeEntry,
    TimeTrackingService,
} from "@/services/time-tracking-service"
import { cn } from "@/lib/utils"

const PERIODS: { id: PayoutPeriod; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "this_week", label: "This week" },
    { id: "last_week", label: "Last week" },
    { id: "this_month", label: "This month" },
    { id: "last_month", label: "Last month" },
    { id: "this_year", label: "This year" },
]

function toDatetimeLocal(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TimeTrackingPage() {
    const { isBdc, isSuperAdmin } = useRole()
    const { timezone } = useBrowserTimezone()
    const { toast } = useToast()
    const [period, setPeriod] = React.useState<PayoutPeriod>("this_week")
    const [payouts, setPayouts] = React.useState<PayoutSummary | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [roster, setRoster] = React.useState<AgentRosterItem[]>([])
    const [clockedInCount, setClockedInCount] = React.useState(0)
    const [teamWeekPay, setTeamWeekPay] = React.useState(0)
    const [teamMonthPay, setTeamMonthPay] = React.useState(0)
    const [selectedAgentId, setSelectedAgentId] = React.useState<string>("me")
    const [rateAgent, setRateAgent] = React.useState<AgentRosterItem | null>(null)
    const [rateValue, setRateValue] = React.useState("")
    const [savingRate, setSavingRate] = React.useState(false)
    const [editEntry, setEditEntry] = React.useState<TimeEntry | null>(null)
    const [editIn, setEditIn] = React.useState("")
    const [editOut, setEditOut] = React.useState("")
    const [editReason, setEditReason] = React.useState("")
    const [editNotes, setEditNotes] = React.useState("")
    const [savingEdit, setSavingEdit] = React.useState(false)
    const [nowMs, setNowMs] = React.useState(() => Date.now())

    const viewingOther = isSuperAdmin && selectedAgentId !== "me"

    const loadPayouts = React.useCallback(async () => {
        if (isSuperAdmin && !isBdc && selectedAgentId === "me") {
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
    }, [period, timezone, selectedAgentId, viewingOther, isSuperAdmin, isBdc, toast])

    const loadRoster = React.useCallback(async () => {
        if (!isSuperAdmin) return
        try {
            const data = await TimeTrackingService.getRoster(timezone)
            setRoster(data.items)
            setClockedInCount(data.clocked_in_count)
            setTeamWeekPay(num(data.team_week.estimated_pay))
            setTeamMonthPay(num(data.team_month.estimated_pay))
        } catch (err) {
            toast({
                title: "Could not load BDC roster",
                description: getApiErrorMessage(err),
                variant: "destructive",
            })
        }
    }, [isSuperAdmin, timezone, toast])

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

    if (!isBdc && !isSuperAdmin) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        Time tracking is available for BDC agents and Super Admins.
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
        setSavingRate(true)
        try {
            await TimeTrackingService.setHourlyRate(rateAgent.id, parsed, timezone)
            toast({
                title: "Hourly rate updated",
                description: `${rateAgent.first_name}'s rate is now ${formatMoney(parsed)}/hr. Future punches will use this rate.`,
            })
            setRateAgent(null)
            await loadRoster()
            await loadPayouts()
        } catch (err) {
            toast({ title: "Could not save rate", description: getApiErrorMessage(err), variant: "destructive" })
        } finally {
            setSavingRate(false)
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
                title={isSuperAdmin && !isBdc ? "BDC time & pay" : "My time & pay"}
                description={
                    isSuperAdmin && !isBdc
                        ? "Set hourly rates, see who is on the clock, and review weekly and monthly payouts."
                        : "Clock in when you start work. Review hours, overtime, and estimated payouts."
                }
            />

            {isBdc && <ClockWidget />}

            {isSuperAdmin && (
                <div className="grid gap-3 sm:grid-cols-3">
                    <SummaryCard
                        icon={<Users className="h-4 w-4 text-emerald-600" />}
                        label="On the clock"
                        value={`${clockedInCount} agent${clockedInCount === 1 ? "" : "s"}`}
                    />
                    <SummaryCard
                        icon={<Timer className="h-4 w-4 text-blue-600" />}
                        label="Team week pay"
                        value={formatMoney(teamWeekPay)}
                    />
                    <SummaryCard
                        icon={<DollarSign className="h-4 w-4 text-amber-600" />}
                        label="Team month pay"
                        value={formatMoney(teamMonthPay)}
                    />
                </div>
            )}

            {isSuperAdmin && roster.length > 0 && (
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
                                    <TableHead className="text-right">Today</TableHead>
                                    <TableHead className="text-right">This week</TableHead>
                                    <TableHead className="text-right">Week pay</TableHead>
                                    <TableHead className="text-right">Month pay</TableHead>
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
                                                {agent.is_clocked_in ? (
                                                    <Badge variant="interested" className="font-mono tabular-nums">
                                                        In {formatElapsed(elapsed)}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline">Off</Badge>
                                                )}
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
                                                {formatHours(agent.this_week.total_hours)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatMoney(agent.this_week.estimated_pay)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {formatMoney(agent.this_month.estimated_pay)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setRateAgent(agent)
                                                        setRateValue(agent.hourly_rate != null ? String(num(agent.hourly_rate)) : "")
                                                    }}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                    Rate
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
                        Overtime is 1.5× after 40 hours in a Monday–Sunday week. Pay uses the rate snapshotted on each punch.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {isSuperAdmin && isBdc && (
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
                    {isSuperAdmin && !isBdc && selectedAgentId === "me" && roster[0] && (
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
            ) : isSuperAdmin && !isBdc && selectedAgentId === "me" ? (
                <Card>
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                        Click an agent name to review their daily hours and estimated payout.
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <SummaryCard label="Total hours" value={formatHours(totals?.total_hours)} />
                        <SummaryCard label="Regular" value={formatHours(totals?.regular_hours)} />
                        <SummaryCard label="Overtime" value={formatHours(totals?.overtime_hours)} />
                        <SummaryCard
                            label="Hourly rate"
                            value={payouts?.hourly_rate == null ? "Not set" : `${formatMoney(payouts.hourly_rate)}/hr`}
                        />
                        <SummaryCard
                            label="Estimated payout"
                            value={formatMoney(totals?.estimated_pay)}
                            highlight
                        />
                    </div>

                    {payouts?.hourly_rate == null && (
                        <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-4 w-4" />
                            Payouts show $0 until Super Admin sets an hourly rate. Hours are still tracked.
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
                                            <TableHead className="text-right">Regular</TableHead>
                                            <TableHead className="text-right">OT</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead className="text-right">Est. pay</TableHead>
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
                                                <TableCell className="text-right tabular-nums">{formatHours(day.regular_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatHours(day.overtime_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums font-medium">{formatHours(day.total_hours)}</TableCell>
                                                <TableCell className="text-right tabular-nums">{formatMoney(day.estimated_pay)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
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
                                            <TableHead>Notes</TableHead>
                                            {isSuperAdmin && <TableHead />}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {payouts.entries.map((entry) => (
                                            <TableRow key={entry.id}>
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
                                                    {entry.hourly_rate == null ? "—" : `${formatMoney(entry.hourly_rate)}/hr`}
                                                </TableCell>
                                                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                                                    {entry.notes || entry.clock_in_note || entry.edit_reason || "—"}
                                                </TableCell>
                                                {isSuperAdmin && (
                                                    <TableCell className="text-right">
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
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            <Dialog open={!!rateAgent} onOpenChange={(open) => !open && setRateAgent(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Hourly rate
                            {rateAgent ? ` — ${rateAgent.first_name} ${rateAgent.last_name}` : ""}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        This rate applies to punches from now on. Past sessions keep the rate they were clocked in with.
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
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRateAgent(null)}>Cancel</Button>
                        <Button onClick={saveRate} disabled={savingRate}>
                            {savingRate && <Loader2 className="h-4 w-4 animate-spin" />}
                            Save rate
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
}: {
    label: string
    value: string
    icon?: React.ReactNode
    highlight?: boolean
}) {
    return (
        <Card className={cn(highlight && "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20")}>
            <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {icon}
                    {label}
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
        </Card>
    )
}
