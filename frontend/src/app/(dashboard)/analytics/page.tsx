"use client"

import * as React from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    BarChart3,
    Users,
    FileText,
    Activity,
    Calendar,
    ClipboardList,
    Inbox,
    CheckCircle,
    Loader2,
    RefreshCw,
    Download,
    LogIn,
} from "lucide-react"
import { useRole } from "@/hooks/use-role"
import {
    ReportsService,
    type DealershipAnalysisResponse,
    type DealershipSummary,
    type SalespersonAnalysisRow,
    type CheckInRow,
    type AnalyticsFilters,
    type LeadsOverTimeResponse,
    type LeadsByStageResponse,
    type LeadsBySourceResponse,
    type ActivitiesOverTimeResponse,
} from "@/services/reports-service"
import { BarChart, DonutChart, AreaChart } from "@tremor/react"
import { DealershipService } from "@/services/dealership-service"
import { TeamService } from "@/services/team-service"
import { LeadStageService, type LeadStage } from "@/services/lead-stage-service"
import { useAuthStore } from "@/stores/auth-store"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

const LEAD_SOURCES = [
    { value: "manual", label: "Manual" },
    { value: "website", label: "Website" },
    { value: "google_sheets", label: "Google Sheets" },
    { value: "meta_ads", label: "Meta Ads" },
    { value: "referral", label: "Referral" },
    { value: "walk_in", label: "Walk-in" },
]

function SummaryCard({
    title,
    value,
    icon: Icon,
    description,
}: {
    title: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    description?: string
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value.toLocaleString()}</div>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </CardContent>
        </Card>
    )
}

function buildFilters(
    dateFrom: string,
    dateTo: string,
    singleDate: string,
    dateMode: "range" | "single",
    dealershipId: string | null,
    assignedTo: string | null,
    source: string | null,
    stageId: string | null
): AnalyticsFilters {
    const params: AnalyticsFilters = {}
    if (dateMode === "single" && singleDate) {
        params.date_from = `${singleDate}T00:00:00.000Z`
        params.date_to = `${singleDate}T23:59:59.999Z`
    } else {
        if (dateFrom) params.date_from = `${dateFrom}T00:00:00.000Z`
        if (dateTo) params.date_to = `${dateTo}T23:59:59.999Z`
    }
    if (dealershipId) params.dealership_id = dealershipId
    if (assignedTo) params.assigned_to = assignedTo
    if (source) params.source = source
    if (stageId) params.stage_id = stageId
    return params
}

function downloadAnalysisCsv(analysis: DealershipAnalysisResponse) {
    const rows: string[][] = [
        [
            "Summary",
            "Total Leads",
            "Active",
            "Converted",
            "Notes",
            "Follow-ups scheduled (period)",
            "Follow-ups completed (period)",
            "Appts scheduled (period)",
            "Appts confirmed (period)",
            "Notes Fri",
            "Outbound calls Fri",
            "Appts Sat",
            "Check-ins (period)",
        ],
        [
            "Dealership",
            String(analysis.summary.total_leads),
            String(analysis.summary.active_leads),
            String(analysis.summary.converted_leads),
            String(analysis.summary.total_notes),
            String(analysis.summary.total_follow_ups_scheduled_in_period),
            String(analysis.summary.total_follow_ups_completed_in_period),
            String(analysis.summary.total_appointments_scheduled_in_period),
            String(analysis.summary.total_appointments_confirmed_in_period),
            String(analysis.summary.notes_friday),
            String(analysis.summary.outbound_calls_friday),
            String(analysis.summary.appointments_contacted_saturday),
            String(analysis.summary.total_check_ins_in_period),
        ],
        [],
        [
            "Salesperson",
            "Leads",
            "Last note",
            "Notes",
            "FU scheduled",
            "FU completed",
            "Appts scheduled",
            "Appts confirmed",
            "Notes Fri",
            "Calls Fri",
            "Appts Sat",
            "Check-ins",
        ],
        ...analysis.salespeople.map((r) => [
            r.user_name,
            String(r.leads_assigned),
            (r.last_note_content ?? "").replace(/"/g, '""'),
            String(r.notes_added),
            String(r.follow_ups_scheduled_in_period),
            String(r.follow_ups_completed_in_period),
            String(r.appointments_scheduled_in_period),
            String(r.appointments_confirmed_in_period),
            String(r.notes_friday),
            String(r.outbound_calls_friday),
            String(r.appointments_contacted_saturday),
            String(r.check_ins_in_period),
        ]),
    ]
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

function downloadAnalysisPdf(
    analysis: DealershipAnalysisResponse,
    options: { dateRangeLabel: string; dealershipName: string; salespersonName: string }
) {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 14
    let y = margin

    doc.setFontSize(18)
    doc.setFont("helvetica", "bold")
    doc.text("Dealership Analytics Report", margin, y)
    y += 10

    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text(`Date range: ${options.dateRangeLabel}`, margin, y)
    y += 6
    doc.text(`Dealership: ${options.dealershipName}`, margin, y)
    y += 6
    doc.text(`Salesperson: ${options.salespersonName}`, margin, y)
    y += 12

    autoTable(doc, {
        startY: y,
        head: [["Metric", "Value"]],
        body: [
            ["Total leads", String(analysis.summary.total_leads)],
            ["Active leads", String(analysis.summary.active_leads)],
            ["Converted leads", String(analysis.summary.converted_leads)],
            ["Notes (in period)", String(analysis.summary.total_notes)],
            ["Follow-ups scheduled (in period)", String(analysis.summary.total_follow_ups_scheduled_in_period)],
            ["Follow-ups completed (in period)", String(analysis.summary.total_follow_ups_completed_in_period)],
            ["Appointments scheduled (in period)", String(analysis.summary.total_appointments_scheduled_in_period)],
            ["Appointments confirmed (in period)", String(analysis.summary.total_appointments_confirmed_in_period)],
            ["Notes (Friday)", String(analysis.summary.notes_friday)],
            ["Outbound calls (Friday)", String(analysis.summary.outbound_calls_friday)],
            ["Appointments (Saturday)", String(analysis.summary.appointments_contacted_saturday)],
            ["Check-ins (in period)", String(analysis.summary.total_check_ins_in_period)],
        ],
        margin: { left: margin },
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246] },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12

    autoTable(doc, {
        startY: y,
        head: [["Name", "Leads", "Notes", "FU sched.", "FU done", "Appts sched.", "Appts conf.", "Notes Fri", "Calls Fri", "Appts Sat", "Check-ins"]],
        body: analysis.salespeople.map((r) => [
            r.user_name,
            String(r.leads_assigned),
            String(r.notes_added),
            String(r.follow_ups_scheduled_in_period),
            String(r.follow_ups_completed_in_period),
            String(r.appointments_scheduled_in_period),
            String(r.appointments_confirmed_in_period),
            String(r.notes_friday),
            String(r.outbound_calls_friday),
            String(r.appointments_contacted_saturday),
            String(r.check_ins_in_period),
        ]),
        margin: { left: margin },
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 8 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

    if (analysis.check_ins && analysis.check_ins.length > 0) {
        doc.setFontSize(11)
        doc.setFont("helvetica", "bold")
        doc.text("Check-ins (in period)", margin, y)
        y += 8
        autoTable(doc, {
            startY: y,
            head: [["Lead", "Assigned to", "Checked in at", "Checked in by", "Outcome"]],
            body: analysis.check_ins.map((r) => [
                r.lead_name,
                r.assigned_to_name ?? "—",
                r.checked_in_at ? new Date(r.checked_in_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—",
                r.checked_in_by_name ?? "—",
                r.outcome ?? "—",
            ]),
            margin: { left: margin },
            theme: "grid",
            headStyles: { fillColor: [59, 130, 246] },
            styles: { fontSize: 8 },
        })
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    }

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    doc.setFontSize(8)
    doc.setTextColor(128, 128, 128)
    doc.text(`Generated at ${new Date().toISOString()}`, margin, finalY + 10)
    doc.text("Leeds CRM — Analytics", pageW - margin, finalY + 10, { align: "right" })

    doc.save(`analytics-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export default function AnalyticsPage() {
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const { user } = useAuthStore()
    const canView = isDealershipAdmin || isDealershipOwner || isSuperAdmin

    const [analysis, setAnalysis] = React.useState<DealershipAnalysisResponse | null>(null)
    const [leadsOverTime, setLeadsOverTime] = React.useState<LeadsOverTimeResponse | null>(null)
    const [leadsByStage, setLeadsByStage] = React.useState<LeadsByStageResponse | null>(null)
    const [leadsBySource, setLeadsBySource] = React.useState<LeadsBySourceResponse | null>(null)
    const [activitiesOverTime, setActivitiesOverTime] = React.useState<ActivitiesOverTimeResponse | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const [dateMode, setDateMode] = React.useState<"range" | "single">("range")
    const [singleDate, setSingleDate] = React.useState<string>(() => new Date().toISOString().slice(0, 10))
    const [dateFrom, setDateFrom] = React.useState<string>(() => {
        const d = new Date()
        d.setDate(d.getDate() - 30)
        return d.toISOString().slice(0, 10)
    })
    const [dateTo, setDateTo] = React.useState<string>(() => new Date().toISOString().slice(0, 10))
    const [dealershipId, setDealershipId] = React.useState<string | null>(null)
    const [assignedTo, setAssignedTo] = React.useState<string | null>(null)
    const [source, setSource] = React.useState<string | null>(null)
    const [stageId, setStageId] = React.useState<string | null>(null)

    const [dealerships, setDealerships] = React.useState<Array<{ id: string; name: string }>>([])
    const [salespersons, setSalespersons] = React.useState<Array<{ id: string; first_name: string; last_name: string }>>([])
    const [stages, setStages] = React.useState<LeadStage[]>([])

    React.useEffect(() => {
        if (!canView) return
        DealershipService.getDealershipsForSelect().then(setDealerships).catch(() => setDealerships([]))
    }, [canView])
    React.useEffect(() => {
        if (!canView) return
        const did = dealershipId || (user?.dealership_id ?? undefined)
        TeamService.getSalespersons(did).then(setSalespersons).catch(() => setSalespersons([]))
    }, [canView, dealershipId, user?.dealership_id])
    React.useEffect(() => {
        LeadStageService.list().then(setStages).catch(() => setStages([]))
    }, [])

    const fetchAll = React.useCallback(async () => {
        if (!canView) return
        setLoading(true)
        setError(null)
        const filters = buildFilters(dateFrom, dateTo, singleDate, dateMode, dealershipId, assignedTo, source, stageId)
        try {
            const [analysisRes, overTimeRes, byStageRes, bySourceRes, activitiesRes] = await Promise.all([
                ReportsService.getDealershipAnalysis(filters),
                ReportsService.getLeadsOverTime(filters, "day"),
                ReportsService.getLeadsByStage(filters),
                ReportsService.getLeadsBySource(filters),
                ReportsService.getActivitiesOverTime(filters),
            ])
            setAnalysis(analysisRes)
            setLeadsOverTime(overTimeRes)
            setLeadsByStage(byStageRes)
            setLeadsBySource(bySourceRes)
            setActivitiesOverTime(activitiesRes)
        } catch (e: unknown) {
            const message =
                e && typeof e === "object" && "response" in e
                    ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
                    : "Failed to load analytics"
            setError(typeof message === "string" ? message : "Failed to load analytics")
        } finally {
            setLoading(false)
        }
    }, [canView, dateFrom, dateTo, singleDate, dateMode, dealershipId, assignedTo, source, stageId])

    React.useEffect(() => {
        fetchAll()
    }, [fetchAll])

    if (!canView) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <BarChart3 className="h-16 w-16 text-muted-foreground/30 mb-4" />
                        <p className="text-muted-foreground text-center max-w-md">
                            You don&apos;t have permission to view dealership analytics. This page is for administrators and owners.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
                <p className="text-muted-foreground">
                    Dealership-wide summary, charts, and per-salesperson analysis. Date range applies to all metrics (notes, activities, follow-ups, appointments, and Friday/Saturday counts).
                </p>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Filters</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Date</label>
                        <Select value={dateMode} onValueChange={(v) => setDateMode(v as "range" | "single")}>
                            <SelectTrigger className="w-[130px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="range">Date range</SelectItem>
                                <SelectItem value="single">Single date</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {dateMode === "single" ? (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Date</label>
                            <input
                                type="date"
                                value={singleDate}
                                onChange={(e) => setSingleDate(e.target.value)}
                                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">From</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">To</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                                />
                            </div>
                        </>
                    )}
                    {isSuperAdmin && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Dealership</label>
                            <Select value={dealershipId ?? "all"} onValueChange={(v) => setDealershipId(v === "all" ? null : v)}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="All" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    {dealerships.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {d.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Salesperson</label>
                        <Select value={assignedTo ?? "all"} onValueChange={(v) => setAssignedTo(v === "all" ? null : v)}>
                            <SelectTrigger className="w-[160px]">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {salespersons.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.first_name} {s.last_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Source</label>
                        <Select value={source ?? "all"} onValueChange={(v) => setSource(v === "all" ? null : v)}>
                            <SelectTrigger className="w-[130px]">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {LEAD_SOURCES.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>
                                        {s.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground">Stage</label>
                        <Select value={stageId ?? "all"} onValueChange={(v) => setStageId(v === "all" ? null : v)}>
                            <SelectTrigger className="w-[160px]">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                {stages.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                        {s.display_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={fetchAll} disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        <span className="ml-2">{loading ? "Loading..." : "Apply"}</span>
                    </Button>
                    {analysis && (
                        <>
                            <Button variant="outline" onClick={() => downloadAnalysisCsv(analysis)}>
                                <Download className="h-4 w-4 mr-2" />
                                Export CSV
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const sp = assignedTo ? salespersons.find((s) => s.id === assignedTo) : null
                                    const dealershipName =
                                        isSuperAdmin && dealershipId
                                            ? dealerships.find((d) => d.id === dealershipId)?.name ?? "All"
                                            : user?.dealership_id
                                                ? dealerships.find((d) => d.id === user.dealership_id)?.name ?? "Current"
                                                : "All"
                                    downloadAnalysisPdf(analysis, {
                                        dateRangeLabel:
                                            dateMode === "single" ? singleDate : `${dateFrom} to ${dateTo}`,
                                        dealershipName,
                                        salespersonName: sp ? `${sp.first_name} ${sp.last_name}` : "All salespeople",
                                    })
                                }}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export PDF
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            {error && (
                <Card className="border-destructive">
                    <CardContent className="py-4 text-destructive">{error}</CardContent>
                </Card>
            )}

            {loading && !analysis && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground">Loading analytics...</p>
                    </CardContent>
                </Card>
            )}

            {!loading && analysis && (
                <>
                    <div>
                        <h2 className="text-lg font-semibold mb-3">Summary</h2>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                            <SummaryCard title="Total leads" value={analysis.summary.total_leads} icon={Inbox} />
                            <SummaryCard title="Active" value={analysis.summary.active_leads} icon={Activity} />
                            <SummaryCard title="Converted" value={analysis.summary.converted_leads} icon={CheckCircle} />
                            <SummaryCard title="Notes" value={analysis.summary.total_notes} icon={FileText} description="In period" />
                            <SummaryCard title="Appointments" value={analysis.summary.total_appointments} icon={Calendar} description="In period" />
                            <SummaryCard title="Follow-ups" value={analysis.summary.total_follow_ups} icon={ClipboardList} description="In period" />
                            <SummaryCard title="FU scheduled" value={analysis.summary.total_follow_ups_scheduled_in_period} icon={ClipboardList} description="In period" />
                            <SummaryCard title="FU completed" value={analysis.summary.total_follow_ups_completed_in_period} icon={CheckCircle} description="In period" />
                            <SummaryCard title="Appts scheduled" value={analysis.summary.total_appointments_scheduled_in_period} icon={Calendar} description="In period" />
                            <SummaryCard title="Appts confirmed" value={analysis.summary.total_appointments_confirmed_in_period} icon={CheckCircle} description="In period" />
                            <SummaryCard title="Notes (Fri)" value={analysis.summary.notes_friday} icon={FileText} description="In period" />
                            <SummaryCard title="Outbound calls (Fri)" value={analysis.summary.outbound_calls_friday} icon={Activity} description="In period" />
                            <SummaryCard title="Appointments (Sat)" value={analysis.summary.appointments_contacted_saturday} icon={Calendar} description="In period" />
                            <SummaryCard title="Check-ins" value={analysis.summary.total_check_ins_in_period} icon={LogIn} description="In period" />
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Leads over time</CardTitle>
                                <p className="text-xs text-muted-foreground">Created vs converted by day</p>
                            </CardHeader>
                            <CardContent>
                                {leadsOverTime && leadsOverTime.series.length > 0 ? (
                                    <AreaChart
                                        data={leadsOverTime.series}
                                        index="date"
                                        categories={["leads_created", "leads_converted"]}
                                        colors={["blue", "emerald"]}
                                        className="h-64"
                                        valueFormatter={(v) => v.toLocaleString()}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground py-8 text-center">No data for selected filters</p>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Leads by stage</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {leadsByStage && leadsByStage.items.length > 0 ? (
                                    <DonutChart
                                        data={leadsByStage.items}
                                        category="count"
                                        index="stage_name"
                                        colors={["blue", "emerald", "amber", "violet", "rose", "cyan"]}
                                        className="h-64"
                                        valueFormatter={(v) => v.toLocaleString()}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground py-8 text-center">No data for selected filters</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Leads by source</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {leadsBySource && leadsBySource.items.length > 0 ? (
                                    <DonutChart
                                        data={leadsBySource.items}
                                        category="count"
                                        index="source"
                                        colors={["emerald", "blue", "amber", "violet", "rose", "teal"]}
                                        className="h-64"
                                        valueFormatter={(v) => v.toLocaleString()}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground py-8 text-center">No data for selected filters</p>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Notes over time</CardTitle>
                                <p className="text-xs text-muted-foreground">Notes added by day</p>
                            </CardHeader>
                            <CardContent>
                                {activitiesOverTime && activitiesOverTime.series.length > 0 ? (
                                    <BarChart
                                        data={activitiesOverTime.series}
                                        index="date"
                                        categories={["notes"]}
                                        colors={["emerald"]}
                                        className="h-64"
                                        valueFormatter={(v) => v.toLocaleString()}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground py-8 text-center">No data for selected filters</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-base">Salesperson comparison</CardTitle>
                            <Button variant="outline" size="sm" onClick={() => downloadAnalysisCsv(analysis)}>
                                <Download className="h-4 w-4 mr-2" />
                                Export CSV
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {analysis.salespeople.length > 0 ? (
                                <BarChart
                                    data={analysis.salespeople.map((r) => ({
                                        name: r.user_name.length > 12 ? r.user_name.slice(0, 12) + "…" : r.user_name,
                                        Leads: r.leads_assigned,
                                        Notes: r.notes_added,
                                        "Check-ins": r.check_ins_in_period,
                                    }))}
                                    index="name"
                                    categories={["Leads", "Notes", "Check-ins"]}
                                    colors={["blue", "emerald", "amber"]}
                                    className="h-72"
                                    valueFormatter={(v) => v.toLocaleString()}
                                />
                            ) : null}
                        </CardContent>
                    </Card>

                    <div>
                        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Salesperson table
                        </h2>
                        <Card className="overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Name</TableHead>
                                        <TableHead className="text-right">Leads</TableHead>
                                        <TableHead className="max-w-[180px]">Last note</TableHead>
                                        <TableHead className="text-right">Notes</TableHead>
                                        <TableHead className="text-right">FU sched.</TableHead>
                                        <TableHead className="text-right">FU done</TableHead>
                                        <TableHead className="text-right">Appts sched.</TableHead>
                                        <TableHead className="text-right">Appts conf.</TableHead>
                                        <TableHead className="text-right">Notes Fri</TableHead>
                                        <TableHead className="text-right">Calls Fri</TableHead>
                                        <TableHead className="text-right">Appts Sat</TableHead>
                                        <TableHead className="text-right">Check-ins</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {analysis.salespeople.length === 0 ? (
                                        <TableEmpty
                                            icon={<Users className="h-10 w-10" />}
                                            title="No salespeople"
                                            description="No active salespersons in this dealership."
                                        />
                                    ) : (
                                        analysis.salespeople.map((row: SalespersonAnalysisRow) => (
                                            <TableRow key={row.user_id}>
                                                <TableCell className="font-medium">
                                                    <Link href={`/analytics/salesperson/${row.user_id}`} className="hover:underline">
                                                        {row.user_name}
                                                    </Link>
                                                </TableCell>
                                                <TableCell className="text-right">{row.leads_assigned}</TableCell>
                                                <TableCell className="max-w-[180px]">
                                                    <span className="text-xs text-muted-foreground block truncate" title={row.last_note_content ?? undefined}>
                                                        {row.last_note_content
                                                            ? row.last_note_content.length > 50
                                                                ? `${row.last_note_content.slice(0, 50)}…`
                                                                : row.last_note_content
                                                            : "—"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">{row.notes_added}</TableCell>
                                                <TableCell className="text-right">{row.follow_ups_scheduled_in_period}</TableCell>
                                                <TableCell className="text-right">{row.follow_ups_completed_in_period}</TableCell>
                                                <TableCell className="text-right">{row.appointments_scheduled_in_period}</TableCell>
                                                <TableCell className="text-right">{row.appointments_confirmed_in_period}</TableCell>
                                                <TableCell className="text-right">{row.notes_friday}</TableCell>
                                                <TableCell className="text-right">{row.outbound_calls_friday}</TableCell>
                                                <TableCell className="text-right">{row.appointments_contacted_saturday}</TableCell>
                                                <TableCell className="text-right">{row.check_ins_in_period}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>

                    {/* Check-ins table (showroom visits in period) */}
                    <div>
                        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                            <LogIn className="h-5 w-5" />
                            Check-ins (in period)
                        </h2>
                        <Card className="overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50">
                                        <TableHead>Lead</TableHead>
                                        <TableHead>Assigned to</TableHead>
                                        <TableHead>Checked in at</TableHead>
                                        <TableHead>Checked in by</TableHead>
                                        <TableHead>Outcome</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!analysis.check_ins || analysis.check_ins.length === 0 ? (
                                        <TableEmpty
                                            icon={<LogIn className="h-10 w-10" />}
                                            title="No check-ins"
                                            description="No showroom check-ins in the selected date range."
                                        />
                                    ) : (
                                        analysis.check_ins.map((row: CheckInRow) => (
                                            <TableRow key={row.visit_id}>
                                                <TableCell className="font-medium">
                                                    <Link href={`/leads/${row.lead_id}`} className="hover:underline">
                                                        {row.lead_name}
                                                    </Link>
                                                </TableCell>
                                                <TableCell>{row.assigned_to_name ?? "—"}</TableCell>
                                                <TableCell>
                                                    {row.checked_in_at
                                                        ? new Date(row.checked_in_at).toLocaleString(undefined, {
                                                              dateStyle: "short",
                                                              timeStyle: "short",
                                                          })
                                                        : "—"}
                                                </TableCell>
                                                <TableCell>{row.checked_in_by_name ?? "—"}</TableCell>
                                                <TableCell>{row.outcome ?? "—"}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}
