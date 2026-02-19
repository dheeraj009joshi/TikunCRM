"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
    Users,
    FileText,
    Activity,
    Calendar,
    ClipboardList,
    Inbox,
    Loader2,
    RefreshCw,
    Download,
    ChevronRight,
    ArrowLeft,
    ChevronDown,
} from "lucide-react"
import { useRole } from "@/hooks/use-role"
import { TeamService, type UserBrief } from "@/services/team-service"
import { LeadService, getLeadFullName, type Lead } from "@/services/lead-service"
import { ActivityService, type Activity as ActivityItem, ACTIVITY_TYPE_INFO } from "@/services/activity-service"
import { AppointmentService, type Appointment as AppointmentItem } from "@/services/appointment-service"
import { FollowUpService, type FollowUp, FOLLOW_UP_STATUS_INFO } from "@/services/follow-up-service"
import * as XLSX from "xlsx"

function formatDate(s: string | undefined) {
    if (!s) return "—"
    const d = new Date(s)
    return d.toLocaleDateString(undefined, { dateStyle: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function exportToExcel(
    userName: string,
    leads: Lead[],
    notes: ActivityItem[],
    activities: ActivityItem[],
    appointments: AppointmentItem[],
    followUps: FollowUp[]
) {
    const wb = XLSX.utils.book_new()
    const safeName = (name: string) => name.replace(/[:\\/*?\[\]]/g, "_").slice(0, 31)

    const summaryData = [
        ["Metric", "Count"],
        ["Leads", leads.length],
        ["Notes", notes.length],
        ["Activities", activities.length],
        ["Appointments", appointments.length],
        ["Follow-ups", followUps.length],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), safeName("Summary"))

    const leadNamesById = Object.fromEntries(leads.map((l) => [l.id, getLeadFullName(l)]))

    if (leads.length > 0) {
        const rows = leads.map((l) => ({
            Customer: getLeadFullName(l),
            Status: l.stage?.display_name ?? l.stage?.name ?? "",
            Source: l.source ?? "",
            Created: l.created_at ? formatDate(l.created_at) : "",
            Notes: (l.notes ?? "").slice(0, 200),
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName("Leads"))
    }

    if (notes.length > 0) {
        const rows = notes.map((n) => ({
            Date: formatDate(n.created_at),
            Description: n.description ?? "",
            Note: (n.meta_data && typeof n.meta_data === "object" && "content" in n.meta_data ? String((n.meta_data as { content?: string }).content ?? "") : "").slice(0, 500),
            Lead: (n.lead_id && leadNamesById[n.lead_id]) ? leadNamesById[n.lead_id] : (n.lead_id ?? ""),
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName("Notes"))
    }

    if (activities.length > 0) {
        const rows = activities.map((a) => ({
            Date: formatDate(a.created_at),
            Type: a.type ?? "",
            Description: a.description ?? "",
            Lead: (a.lead_id && leadNamesById[a.lead_id]) ? leadNamesById[a.lead_id] : (a.lead_id ?? ""),
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName("Activities"))
    }

    if (appointments.length > 0) {
        const rows = appointments.map((a) => ({
            Date: formatDate(a.scheduled_at),
            Title: a.title ?? "",
            Status: a.status ?? "",
            Type: a.appointment_type ?? "",
            Lead: (a.lead_id && leadNamesById[a.lead_id]) ? leadNamesById[a.lead_id] : (a.lead_id ?? ""),
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName("Appointments"))
    }

    if (followUps.length > 0) {
        const rows = followUps.map((f) => ({
            Scheduled: formatDate(f.scheduled_at),
            Status: f.status ?? "",
            Notes: (f.notes ?? "").slice(0, 200),
            Lead: f.lead?.customer ? `${f.lead.customer.first_name ?? ""} ${f.lead.customer.last_name ?? ""}`.trim() || f.lead_id : f.lead_id,
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName("Follow-ups"))
    }

    const filename = `salesperson_${safeName(userName)}_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, filename)
}

export default function SalespersonAnalyticsPage() {
    const params = useParams()
    const id = typeof params?.id === "string" ? params.id : null
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const canView = isDealershipAdmin || isDealershipOwner || isSuperAdmin

    const [salesperson, setSalesperson] = React.useState<UserBrief | null>(null)
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [notes, setNotes] = React.useState<ActivityItem[]>([])
    const [activities, setActivities] = React.useState<ActivityItem[]>([])
    const [appointments, setAppointments] = React.useState<AppointmentItem[]>([])
    const [followUps, setFollowUps] = React.useState<FollowUp[]>([])
    const [loading, setLoading] = React.useState(true)
    const [errors, setErrors] = React.useState<Record<string, string>>({})

    const leadNamesById = React.useMemo(
        () => Object.fromEntries(leads.map((l) => [l.id, getLeadFullName(l)])),
        [leads]
    )

    function getErrorMessage(e: unknown): string {
        if (e && typeof e === "object" && "response" in e) {
            const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
            if (typeof detail === "string") return detail
        }
        return "Failed to load"
    }

    const fetchUser = React.useCallback(async () => {
        if (!id) return
        try {
            const u = await TeamService.getUser(id)
            setSalesperson(u)
        } catch {
            setSalesperson(null)
        }
    }, [id])

    const fetchAll = React.useCallback(async () => {
        if (!canView || !id) return
        setLoading(true)
        setErrors({})
        const results = await Promise.allSettled([
            LeadService.listLeads({ assigned_to: id, page_size: 100 }),
            ActivityService.listActivities({ user_id: id, type: "note_added", page_size: 100 }),
            ActivityService.listActivities({ user_id: id, page_size: 100 }),
            AppointmentService.list({ assigned_to: id, page_size: 100 }),
            FollowUpService.listFollowUps({ assigned_to: id }),
        ])
        const keys = ["leads", "notes", "activities", "appointments", "followUps"] as const
        const nextErrors: Record<string, string> = {}
        results.forEach((result, i) => {
            const key = keys[i]
            if (result.status === "fulfilled") {
                const value = result.value
                if (key === "leads") setLeads("items" in value && Array.isArray(value.items) ? (value.items as Lead[]) : [])
                else if (key === "notes") setNotes("items" in value && Array.isArray(value.items) ? (value.items as ActivityItem[]) : [])
                else if (key === "activities") setActivities("items" in value && Array.isArray(value.items) ? (value.items as ActivityItem[]) : [])
                else if (key === "appointments") setAppointments("items" in value && Array.isArray(value.items) ? (value.items as AppointmentItem[]) : [])
                else if (key === "followUps") setFollowUps(Array.isArray(value) ? (value as FollowUp[]) : [])
            } else {
                nextErrors[key] = getErrorMessage(result.reason)
            }
        })
        if (Object.keys(nextErrors).length > 0) setErrors(nextErrors)
        setLoading(false)
    }, [canView, id])

    React.useEffect(() => {
        fetchUser()
    }, [fetchUser])

    React.useEffect(() => {
        fetchAll()
    }, [fetchAll])

    if (!id) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Salesperson report</h1>
                <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">Missing salesperson ID.</CardContent>
                </Card>
            </div>
        )
    }

    if (!canView) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">Salesperson report</h1>
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <p className="text-muted-foreground text-center">You don&apos;t have permission to view this page.</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const displayName = salesperson
        ? `${salesperson.first_name ?? ""} ${salesperson.last_name ?? ""}`.trim() || salesperson.email
        : "Salesperson"

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <nav className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link href="/analytics" className="hover:text-foreground flex items-center gap-1">
                        <ArrowLeft className="h-4 w-4" />
                        Analytics
                    </Link>
                    <ChevronRight className="h-4 w-4" />
                    <span className="text-foreground font-medium">{displayName}</span>
                </nav>
                <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
                <p className="text-muted-foreground">Leads, notes, activities, appointments, and follow-ups for this salesperson.</p>
            </div>

            <div className="flex items-center gap-2">
                <Button onClick={fetchAll} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-2">Refresh</span>
                </Button>
                <Button
                    variant="outline"
                    onClick={() => exportToExcel(displayName, leads, notes, activities, appointments, followUps)}
                    disabled={loading}
                >
                    <Download className="h-4 w-4 mr-2" />
                    Export to Excel
                </Button>
            </div>

            {Object.keys(errors).length > 0 && (
                <Card className="border-destructive">
                    <CardContent className="py-4 text-destructive">
                        Some data could not be loaded: {Object.keys(errors).map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", ")}.
                    </CardContent>
                </Card>
            )}

            {loading && leads.length === 0 && notes.length === 0 && activities.length === 0 && appointments.length === 0 && followUps.length === 0 && (
                <Card className="overflow-hidden">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="relative flex items-center justify-center">
                            <div className="h-14 w-14 rounded-full border-2 border-muted" />
                            <div className="absolute h-14 w-14 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                            <div className="absolute h-8 w-8 rounded-full bg-background" />
                        </div>
                        <p className="mt-5 text-sm font-medium text-foreground">Loading report</p>
                        <p className="mt-1 text-xs text-muted-foreground">Fetching leads, notes, activities, and more...</p>
                        <div className="mt-6 flex gap-1.5">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-pulse" />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Leads */}
            <Collapsible defaultOpen={false}>
                <Card>
                    <CardHeader className="p-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md hover:bg-muted/50 transition-colors [&[data-state=open]_.chevron]:rotate-180">
                            <CardTitle className="flex items-center gap-2">
                                <Inbox className="h-5 w-5" />
                                Leads ({leads.length})
                            </CardTitle>
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform" />
                        </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                        <CardContent className="pt-0">
                            <div className="overflow-auto max-h-[min(24rem,50vh)] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Customer</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Source</TableHead>
                                            <TableHead>Created</TableHead>
                                            <TableHead className="w-[80px]">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {leads.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5}>
                                                    <TableEmpty icon={<Inbox className="h-10 w-10" />} title="No leads" description="No leads assigned to this salesperson." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            leads.map((lead) => (
                                                <TableRow key={lead.id}>
                                                    <TableCell className="font-medium">{getLeadFullName(lead)}</TableCell>
                                                    <TableCell>{lead.stage?.display_name ?? lead.stage?.name ?? "—"}</TableCell>
                                                    <TableCell>{(lead.source_display ?? lead.source)?.replace(/_/g, ' ') ?? "—"}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">{lead.created_at ? formatDate(lead.created_at) : "—"}</TableCell>
                                                    <TableCell>
                                                        <Button variant="ghost" size="sm" asChild>
                                                            <Link href={`/leads/${lead.id}`}>View</Link>
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {errors.leads && <p className="text-sm text-destructive mt-2">{errors.leads}</p>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Notes */}
            <Collapsible defaultOpen={false}>
                <Card>
                    <CardHeader className="p-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md hover:bg-muted/50 transition-colors [&[data-state=open]_.chevron]:rotate-180">
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Notes ({notes.length})
                            </CardTitle>
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform" />
                        </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                        <CardContent className="pt-0">
                            <div className="overflow-auto max-h-[min(24rem,50vh)] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Date</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead className="max-w-[300px]">Content</TableHead>
                                            <TableHead className="w-[80px]">Lead</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {notes.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4}>
                                                    <TableEmpty icon={<FileText className="h-10 w-10" />} title="No notes" description="No notes added by this salesperson." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            notes.map((n) => {
                                                const content = n.meta_data && typeof n.meta_data === "object" && "content" in n.meta_data ? String((n.meta_data as { content?: string }).content ?? "") : ""
                                                return (
                                                    <TableRow key={n.id}>
                                                        <TableCell className="text-sm whitespace-nowrap">{formatDate(n.created_at)}</TableCell>
                                                        <TableCell className="text-sm">{n.description ?? "—"}</TableCell>
                                                        <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate" title={content}>
                                                            {content ? (content.length > 80 ? content.slice(0, 80) + "…" : content) : "—"}
                                                        </TableCell>
                                                        <TableCell className="text-sm">
                                                            {n.lead_id ? (
                                                                leadNamesById[n.lead_id] ? (
                                                                    <Button variant="ghost" size="sm" className="font-normal text-foreground hover:underline" asChild>
                                                                        <Link href={`/leads/${n.lead_id}`}>{leadNamesById[n.lead_id]}</Link>
                                                                    </Button>
                                                                ) : (
                                                                    <Button variant="ghost" size="sm" asChild>
                                                                        <Link href={`/leads/${n.lead_id}`}>View</Link>
                                                                    </Button>
                                                                )
                                                            ) : "—"}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {errors.notes && <p className="text-sm text-destructive mt-2">{errors.notes}</p>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Activities */}
            <Collapsible defaultOpen={false}>
                <Card>
                    <CardHeader className="p-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md hover:bg-muted/50 transition-colors [&[data-state=open]_.chevron]:rotate-180">
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5" />
                                Activities ({activities.length})
                            </CardTitle>
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform" />
                        </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                        <CardContent className="pt-0">
                            <div className="overflow-auto max-h-[min(24rem,50vh)] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Date</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead className="w-[80px]">Lead</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {activities.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4}>
                                                    <TableEmpty icon={<Activity className="h-10 w-10" />} title="No activities" description="No activities by this salesperson." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            activities.map((a) => (
                                                <TableRow key={a.id}>
                                                    <TableCell className="text-sm whitespace-nowrap">{formatDate(a.created_at)}</TableCell>
                                                    <TableCell className="text-sm">{ACTIVITY_TYPE_INFO[a.type as keyof typeof ACTIVITY_TYPE_INFO]?.label ?? a.type ?? "—"}</TableCell>
                                                    <TableCell className="text-sm">{a.description ?? "—"}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {a.lead_id ? (
                                                            leadNamesById[a.lead_id] ? (
                                                                <Button variant="ghost" size="sm" className="font-normal text-foreground hover:underline" asChild>
                                                                    <Link href={`/leads/${a.lead_id}`}>{leadNamesById[a.lead_id]}</Link>
                                                                </Button>
                                                            ) : (
                                                                <Button variant="ghost" size="sm" asChild>
                                                                    <Link href={`/leads/${a.lead_id}`}>View</Link>
                                                                </Button>
                                                            )
                                                        ) : "—"}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {errors.activities && <p className="text-sm text-destructive mt-2">{errors.activities}</p>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Appointments */}
            <Collapsible defaultOpen={false}>
                <Card>
                    <CardHeader className="p-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md hover:bg-muted/50 transition-colors [&[data-state=open]_.chevron]:rotate-180">
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="h-5 w-5" />
                                Appointments ({appointments.length})
                            </CardTitle>
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform" />
                        </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                        <CardContent className="pt-0">
                            <div className="overflow-auto max-h-[min(24rem,50vh)] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Scheduled</TableHead>
                                            <TableHead>Title</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead className="w-[80px]">Lead</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {appointments.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5}>
                                                    <TableEmpty icon={<Calendar className="h-10 w-10" />} title="No appointments" description="No appointments for this salesperson." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            appointments.map((a) => (
                                                <TableRow key={a.id}>
                                                    <TableCell className="text-sm whitespace-nowrap">{formatDate(a.scheduled_at)}</TableCell>
                                                    <TableCell className="font-medium">{a.title ?? "—"}</TableCell>
                                                    <TableCell className="capitalize">{a.status ?? "—"}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">{a.appointment_type ?? "—"}</TableCell>
                                                    <TableCell>
                                                        {a.lead_id ? (
                                                            leadNamesById[a.lead_id] ? (
                                                                <Button variant="ghost" size="sm" className="font-normal text-foreground hover:underline" asChild>
                                                                    <Link href={`/leads/${a.lead_id}`}>{leadNamesById[a.lead_id]}</Link>
                                                                </Button>
                                                            ) : (
                                                                <Button variant="ghost" size="sm" asChild>
                                                                    <Link href={`/leads/${a.lead_id}`}>View</Link>
                                                                </Button>
                                                            )
                                                        ) : "—"}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {errors.appointments && <p className="text-sm text-destructive mt-2">{errors.appointments}</p>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>

            {/* Follow-ups */}
            <Collapsible defaultOpen={false}>
                <Card>
                    <CardHeader className="p-4">
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md hover:bg-muted/50 transition-colors [&[data-state=open]_.chevron]:rotate-180">
                            <CardTitle className="flex items-center gap-2">
                                <ClipboardList className="h-5 w-5" />
                                Follow-ups ({followUps.length})
                            </CardTitle>
                            <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform" />
                        </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                        <CardContent className="pt-0">
                            <div className="overflow-auto max-h-[min(24rem,50vh)] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead>Scheduled</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Lead</TableHead>
                                            <TableHead className="max-w-[200px]">Notes</TableHead>
                                            <TableHead>Completed</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {followUps.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={5}>
                                                    <TableEmpty icon={<ClipboardList className="h-10 w-10" />} title="No follow-ups" description="No follow-ups assigned to this salesperson." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            followUps.map((f) => {
                                                const statusInfo = FOLLOW_UP_STATUS_INFO[f.status]
                                                const leadName = f.lead?.customer
                                                    ? `${f.lead.customer.first_name ?? ""} ${f.lead.customer.last_name ?? ""}`.trim() || "—"
                                                    : "—"
                                                return (
                                                    <TableRow key={f.id}>
                                                        <TableCell className="text-sm whitespace-nowrap">{formatDate(f.scheduled_at)}</TableCell>
                                                        <TableCell>
                                                            <span className={statusInfo?.color ?? ""}>{statusInfo?.label ?? f.status ?? "—"}</span>
                                                        </TableCell>
                                                        <TableCell>
                                                            {f.lead_id ? (
                                                                <Button variant="ghost" size="sm" asChild>
                                                                    <Link href={`/leads/${f.lead_id}`}>{leadName}</Link>
                                                                </Button>
                                                            ) : leadName}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={f.notes ?? undefined}>
                                                            {f.notes ? (f.notes.length > 50 ? f.notes.slice(0, 50) + "…" : f.notes) : "—"}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">{f.completed_at ? formatDate(f.completed_at) : "—"}</TableCell>
                                                    </TableRow>
                                                )
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {errors.followUps && <p className="text-sm text-destructive mt-2">{errors.followUps}</p>}
                        </CardContent>
                    </CollapsibleContent>
                </Card>
            </Collapsible>
        </div>
    )
}
