"use client"

import * as React from "react"
import Link from "next/link"
import { format, subDays, startOfWeek, endOfWeek } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/avatar"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    Activity,
    CalendarDays,
    ChevronDown,
    ChevronRight,
    Clock,
    Download,
    FileText,
    Loader2,
    MessageSquare,
    Phone,
    PhoneCall,
    RefreshCw,
    Users,
    Mail,
    Calendar as CalendarIcon,
    CheckCircle,
    ExternalLink,
    PlusCircle,
    UserPlus,
    Send,
    AlertCircle,
    XCircle,
} from "lucide-react"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import {
    ReportsService,
    type DailyActivityResponse,
    type SalespersonDailySummary,
    type DailyActivityItem,
    type DailyActivityFilters,
} from "@/services/reports-service"
import { TeamService, type UserBrief } from "@/services/team-service"
import { DealershipService, type Dealership } from "@/services/dealership-service"
import { ACTIVITY_TYPE_INFO, type ActivityType } from "@/services/activity-service"
import { LocalTime } from "@/components/ui/local-time"
import { cn } from "@/lib/utils"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

type DatePreset = "today" | "yesterday" | "this_week" | "last_7_days" | "custom"

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "this_week", label: "This Week" },
    { value: "last_7_days", label: "Last 7 Days" },
    { value: "custom", label: "Custom" },
]

const ACTIVITY_TYPE_OPTIONS = [
    { value: "note_added", label: "Notes" },
    { value: "call_logged", label: "Calls" },
    { value: "follow_up_scheduled", label: "Follow-ups Scheduled" },
    { value: "follow_up_completed", label: "Follow-ups Completed" },
    { value: "appointment_scheduled", label: "Appointments Scheduled" },
    { value: "appointment_completed", label: "Appointments Completed" },
    { value: "email_sent", label: "Emails Sent" },
]

function getActivityIcon(type: string) {
    switch (type) {
        case "lead_created": return <PlusCircle className="h-4 w-4 text-emerald-500" />
        case "lead_assigned": return <UserPlus className="h-4 w-4 text-blue-500" />
        case "lead_reassigned": return <RefreshCw className="h-4 w-4 text-amber-500" />
        case "note_added": return <MessageSquare className="h-4 w-4 text-gray-500" />
        case "call_logged": return <PhoneCall className="h-4 w-4 text-emerald-500" />
        case "email_sent": return <Send className="h-4 w-4 text-blue-500" />
        case "email_received": return <Mail className="h-4 w-4 text-indigo-500" />
        case "follow_up_scheduled": return <CalendarIcon className="h-4 w-4 text-amber-500" />
        case "follow_up_completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />
        case "follow_up_missed": return <AlertCircle className="h-4 w-4 text-rose-500" />
        case "appointment_scheduled": return <CalendarDays className="h-4 w-4 text-purple-500" />
        case "appointment_completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />
        case "appointment_cancelled": return <XCircle className="h-4 w-4 text-rose-500" />
        default: return <Clock className="h-4 w-4 text-gray-400" />
    }
}

function getActivityLabel(type: string): string {
    const info = ACTIVITY_TYPE_INFO[type as ActivityType]
    return info?.label || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function SummaryCard({
    title,
    value,
    icon: Icon,
    description,
}: {
    title: string
    value: number | string
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
                <div className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </CardContent>
        </Card>
    )
}

function ActivityItem({ activity }: { activity: DailyActivityItem }) {
    return (
        <div className="flex items-start gap-3 py-3 border-b last:border-b-0">
            <div className="mt-0.5">
                {getActivityIcon(activity.type)}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{getActivityLabel(activity.type)}</span>
                    {activity.lead_id && activity.lead_name && (
                        <Link
                            href={`/leads/${activity.lead_id}`}
                            className="text-sm text-primary hover:underline flex items-center gap-1"
                        >
                            {activity.lead_name}
                            <ExternalLink className="h-3 w-3" />
                        </Link>
                    )}
                </div>
                {activity.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {activity.description}
                    </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                    <LocalTime dateString={activity.created_at} format="h:mm a" />
                </p>
            </div>
        </div>
    )
}

function SalespersonActivityCard({
    summary,
    defaultOpen = false,
}: {
    summary: SalespersonDailySummary
    defaultOpen?: boolean
}) {
    const [isOpen, setIsOpen] = React.useState(defaultOpen)
    const totalActivities = summary.activities.length
    
    const stats = [
        { label: "Notes", value: summary.notes_count, show: summary.notes_count > 0 },
        { label: "Calls", value: summary.calls_count, show: summary.calls_count > 0 },
        { label: "FU Done", value: summary.follow_ups_completed, show: summary.follow_ups_completed > 0 },
        { label: "FU Sched", value: summary.follow_ups_scheduled, show: summary.follow_ups_scheduled > 0 },
        { label: "Appts Done", value: summary.appointments_completed, show: summary.appointments_completed > 0 },
        { label: "Appts Sched", value: summary.appointments_scheduled, show: summary.appointments_scheduled > 0 },
        { label: "Emails", value: summary.emails_sent, show: summary.emails_sent > 0 },
    ].filter(s => s.show)
    
    return (
        <Card className={cn(totalActivities === 0 && "opacity-60")}>
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <UserAvatar
                                    firstName={summary.user_name.split(" ")[0]}
                                    lastName={summary.user_name.split(" ")[1] || ""}
                                    size="md"
                                />
                                <div>
                                    <CardTitle className="text-base">{summary.user_name}</CardTitle>
                                    <p className="text-xs text-muted-foreground">{summary.user_email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                    {stats.map((stat, i) => (
                                        <Badge key={i} variant="secondary" className="text-xs">
                                            {stat.label}: {stat.value}
                                        </Badge>
                                    ))}
                                    {summary.leads_worked > 0 && (
                                        <Badge variant="outline" className="text-xs">
                                            {summary.leads_worked} lead{summary.leads_worked !== 1 ? "s" : ""}
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant={totalActivities > 0 ? "default" : "secondary"}>
                                        {totalActivities} activit{totalActivities !== 1 ? "ies" : "y"}
                                    </Badge>
                                    {isOpen ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="pt-0">
                        {summary.call_duration_total > 0 && (
                            <p className="text-sm text-muted-foreground mb-3">
                                Total call time: {formatDuration(summary.call_duration_total)}
                            </p>
                        )}
                        {totalActivities === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">
                                No activities recorded for this period.
                            </p>
                        ) : (
                            <div className="max-h-[400px] overflow-y-auto">
                                {summary.activities.map((activity) => (
                                    <ActivityItem key={activity.id} activity={activity} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    )
}

export default function TeamActivityPage() {
    const { isSuperAdmin, isDealershipLevel } = useRole()
    const user = useAuthStore((state) => state.user)
    
    const [isLoading, setIsLoading] = React.useState(true)
    const [data, setData] = React.useState<DailyActivityResponse | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    
    // Filters
    const [datePreset, setDatePreset] = React.useState<DatePreset>("today")
    const [customDateFrom, setCustomDateFrom] = React.useState<Date | undefined>(undefined)
    const [customDateTo, setCustomDateTo] = React.useState<Date | undefined>(undefined)
    const [selectedUserId, setSelectedUserId] = React.useState<string>("all")
    const [selectedActivityTypes, setSelectedActivityTypes] = React.useState<string[]>([])
    const [selectedDealershipId, setSelectedDealershipId] = React.useState<string>("")
    
    // Dropdown data
    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [salespersons, setSalespersons] = React.useState<UserBrief[]>([])
    const [loadingDropdowns, setLoadingDropdowns] = React.useState(true)
    
    // Calculate date range from preset
    const getDateRange = React.useCallback((): { from: string; to: string } => {
        const today = new Date()
        let from: Date
        let to: Date
        
        switch (datePreset) {
            case "today":
                from = today
                to = today
                break
            case "yesterday":
                from = subDays(today, 1)
                to = subDays(today, 1)
                break
            case "this_week":
                from = startOfWeek(today, { weekStartsOn: 1 })
                to = endOfWeek(today, { weekStartsOn: 1 })
                break
            case "last_7_days":
                from = subDays(today, 6)
                to = today
                break
            case "custom":
                from = customDateFrom || today
                to = customDateTo || today
                break
            default:
                from = today
                to = today
        }
        
        return {
            from: format(from, "yyyy-MM-dd"),
            to: format(to, "yyyy-MM-dd"),
        }
    }, [datePreset, customDateFrom, customDateTo])
    
    // Load dropdowns
    React.useEffect(() => {
        async function loadDropdowns() {
            setLoadingDropdowns(true)
            try {
                if (isSuperAdmin) {
                    const ds = await DealershipService.listDealerships({ is_active: true })
                    setDealerships(ds)
                    if (ds.length > 0 && !selectedDealershipId) {
                        setSelectedDealershipId(ds[0].id)
                    }
                }
                
                const dealershipId = isSuperAdmin ? selectedDealershipId : user?.dealership_id
                if (dealershipId) {
                    const sp = await TeamService.getSalespersons(dealershipId)
                    setSalespersons(sp)
                }
            } catch (err) {
                console.error("Failed to load dropdowns:", err)
            } finally {
                setLoadingDropdowns(false)
            }
        }
        loadDropdowns()
    }, [isSuperAdmin, user?.dealership_id, selectedDealershipId])
    
    // Fetch data
    const fetchData = React.useCallback(async () => {
        const dealershipId = isSuperAdmin ? selectedDealershipId : user?.dealership_id
        if (!dealershipId) return
        
        setIsLoading(true)
        setError(null)
        
        try {
            const { from, to } = getDateRange()
            const filters: DailyActivityFilters = {
                date_from: `${from}T00:00:00.000Z`,
                date_to: `${to}T23:59:59.999Z`,
            }
            if (isSuperAdmin && selectedDealershipId) {
                filters.dealership_id = selectedDealershipId
            }
            if (selectedUserId && selectedUserId !== "all") {
                filters.user_id = selectedUserId
            }
            if (selectedActivityTypes.length > 0) {
                filters.activity_types = selectedActivityTypes.join(",")
            }
            
            const response = await ReportsService.getDailyActivities(filters)
            setData(response)
        } catch (err: any) {
            console.error("Failed to fetch daily activities:", err)
            setError(err.response?.data?.detail || "Failed to load activities")
        } finally {
            setIsLoading(false)
        }
    }, [isSuperAdmin, selectedDealershipId, user?.dealership_id, getDateRange, selectedUserId, selectedActivityTypes])
    
    React.useEffect(() => {
        fetchData()
    }, [fetchData])
    
    // Export functions
    const downloadCsv = () => {
        if (!data) return
        
        const rows: string[][] = [
            ["Salesperson", "Email", "Notes", "Calls", "Call Duration (s)", "Follow-ups Completed", "Follow-ups Scheduled", "Appointments Completed", "Appointments Scheduled", "Emails Sent", "Leads Worked"],
            ...data.salespersons.map((sp) => [
                sp.user_name,
                sp.user_email,
                String(sp.notes_count),
                String(sp.calls_count),
                String(sp.call_duration_total),
                String(sp.follow_ups_completed),
                String(sp.follow_ups_scheduled),
                String(sp.appointments_completed),
                String(sp.appointments_scheduled),
                String(sp.emails_sent),
                String(sp.leads_worked),
            ]),
        ]
        
        const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        const { from, to } = getDateRange()
        a.download = `team-activity-${from}-to-${to}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }
    
    const downloadPdf = () => {
        if (!data) return
        
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
        const pageW = doc.internal.pageSize.getWidth()
        const margin = 14
        let y = margin
        
        const { from, to } = getDateRange()
        doc.setFontSize(18)
        doc.setFont("helvetica", "bold")
        doc.text("Team Activity Report", margin, y)
        y += 8
        
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.text(`Period: ${from} to ${to}`, margin, y)
        y += 10
        
        // Summary
        doc.setFontSize(12)
        doc.setFont("helvetica", "bold")
        doc.text("Summary", margin, y)
        y += 6
        doc.setFontSize(10)
        doc.setFont("helvetica", "normal")
        doc.text(`Total Activities: ${data.total_activities}`, margin, y)
        doc.text(`Notes: ${data.total_notes}`, margin + 50, y)
        doc.text(`Calls: ${data.total_calls}`, margin + 80, y)
        doc.text(`Follow-ups: ${data.total_follow_ups_completed}`, margin + 110, y)
        y += 10
        
        // Table
        autoTable(doc, {
            startY: y,
            head: [["Salesperson", "Notes", "Calls", "Call Time", "FU Done", "FU Sched", "Appts Done", "Appts Sched", "Emails", "Leads"]],
            body: data.salespersons.map((sp) => [
                sp.user_name,
                sp.notes_count,
                sp.calls_count,
                formatDuration(sp.call_duration_total),
                sp.follow_ups_completed,
                sp.follow_ups_scheduled,
                sp.appointments_completed,
                sp.appointments_scheduled,
                sp.emails_sent,
                sp.leads_worked,
            ]),
            theme: "striped",
            headStyles: { fillColor: [59, 130, 246] },
            margin: { left: margin, right: margin },
        })
        
        doc.save(`team-activity-${from}-to-${to}.pdf`)
    }
    
    const dateRangeLabel = React.useMemo(() => {
        const { from, to } = getDateRange()
        if (from === to) {
            return format(new Date(from), "EEEE, MMMM d, yyyy")
        }
        return `${format(new Date(from), "MMM d")} - ${format(new Date(to), "MMM d, yyyy")}`
    }, [getDateRange])
    
    // Access control
    if (!isSuperAdmin && !isDealershipLevel) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <p className="text-muted-foreground">You don't have access to this page.</p>
            </div>
        )
    }
    
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Team Activity</h1>
                    <p className="text-muted-foreground">
                        Monitor daily activities of your sales team
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                        Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data}>
                        <Download className="h-4 w-4 mr-2" />
                        CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadPdf} disabled={!data}>
                        <Download className="h-4 w-4 mr-2" />
                        PDF
                    </Button>
                </div>
            </div>
            
            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-wrap items-end gap-4">
                        {/* Date Preset Buttons */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date Range</label>
                            <div className="flex flex-wrap gap-2">
                                {DATE_PRESETS.map((preset) => (
                                    <Button
                                        key={preset.value}
                                        variant={datePreset === preset.value ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setDatePreset(preset.value)}
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        
                        {/* Custom Date Pickers */}
                        {datePreset === "custom" && (
                            <div className="flex items-end gap-2">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">From</label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="w-[140px] justify-start">
                                                <CalendarIcon className="h-4 w-4 mr-2" />
                                                {customDateFrom ? format(customDateFrom, "MMM d, yyyy") : "Select"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={customDateFrom}
                                                onSelect={setCustomDateFrom}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">To</label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="w-[140px] justify-start">
                                                <CalendarIcon className="h-4 w-4 mr-2" />
                                                {customDateTo ? format(customDateTo, "MMM d, yyyy") : "Select"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={customDateTo}
                                                onSelect={setCustomDateTo}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>
                        )}
                        
                        {/* Dealership Filter (Super Admin) */}
                        {isSuperAdmin && dealerships.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Dealership</label>
                                <Select value={selectedDealershipId} onValueChange={setSelectedDealershipId}>
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="Select dealership" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {dealerships.map((d) => (
                                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        
                        {/* Salesperson Filter */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Salesperson</label>
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="All salespersons" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Salespersons</SelectItem>
                                    {salespersons.map((sp) => (
                                        <SelectItem key={sp.id} value={sp.id}>
                                            {sp.first_name} {sp.last_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        {/* Activity Type Filter */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Activity Types</label>
                            <Select
                                value={selectedActivityTypes.length > 0 ? selectedActivityTypes.join(",") : "all"}
                                onValueChange={(val) => {
                                    if (val === "all") {
                                        setSelectedActivityTypes([])
                                    } else {
                                        setSelectedActivityTypes(val.split(","))
                                    }
                                }}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="All types" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Types</SelectItem>
                                    {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    {/* Date Label */}
                    <div className="mt-4 pt-4 border-t">
                        <p className="text-sm text-muted-foreground">
                            Showing activities for: <span className="font-medium text-foreground">{dateRangeLabel}</span>
                        </p>
                    </div>
                </CardContent>
            </Card>
            
            {/* Summary Cards */}
            {data && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <SummaryCard
                        title="Total Activities"
                        value={data.total_activities}
                        icon={Activity}
                    />
                    <SummaryCard
                        title="Notes Added"
                        value={data.total_notes}
                        icon={MessageSquare}
                    />
                    <SummaryCard
                        title="Calls Made"
                        value={data.total_calls}
                        icon={Phone}
                    />
                    <SummaryCard
                        title="Follow-ups Completed"
                        value={data.total_follow_ups_completed}
                        icon={CheckCircle}
                    />
                    <SummaryCard
                        title="Appointments"
                        value={data.total_appointments}
                        icon={CalendarDays}
                    />
                </div>
            )}
            
            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
            
            {/* Error State */}
            {error && (
                <Card>
                    <CardContent className="py-8">
                        <p className="text-center text-destructive">{error}</p>
                        <div className="flex justify-center mt-4">
                            <Button variant="outline" onClick={fetchData}>Try Again</Button>
                        </div>
                    </CardContent>
                </Card>
            )}
            
            {/* Salesperson Cards */}
            {!isLoading && !error && data && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Team Members ({data.salespersons.length})
                        </h2>
                    </div>
                    
                    {data.salespersons.length === 0 ? (
                        <Card>
                            <CardContent className="py-8">
                                <p className="text-center text-muted-foreground">
                                    No team members found for this dealership.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {data.salespersons.map((sp, index) => (
                                <SalespersonActivityCard
                                    key={sp.user_id}
                                    summary={sp}
                                    defaultOpen={index === 0 && sp.activities.length > 0}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
