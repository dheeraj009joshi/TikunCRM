"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
    Clock,
    CheckCircle,
    XCircle,
    AlertCircle,
    Calendar,
    User,
    Phone,
    Mail,
    Loader2,
    Filter,
    X,
    Plus,
    MoreVertical,
    Trash2,
    ChevronLeft,
    ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Tabs,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import {
    FollowUpService,
    FollowUp,
    FollowUpStatus,
    FOLLOW_UP_STATUS_INFO,
    FollowUpStats,
} from "@/services/follow-up-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone, formatRelativeTimeInTimezone } from "@/utils/timezone"
import { UserAvatar } from "@/components/ui/avatar"
import { getRoleDisplayName } from "@/hooks/use-role"
import { ScheduleFollowUpModal } from "@/components/follow-ups/schedule-follow-up-modal"
import { filterStorage } from "@/lib/filter-storage"
import { cn } from "@/lib/utils"

const FOLLOWUP_VALID_FILTERS = ["all", "pending", "overdue", "completed"] as const
type FollowUpFilterType = (typeof FOLLOWUP_VALID_FILTERS)[number]

type DateRangePreset = "today" | "this_week" | "this_month" | "custom" | "all_time"

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "this_week", label: "This Week" },
    { value: "this_month", label: "This Month" },
    { value: "custom", label: "Custom" },
    { value: "all_time", label: "All Time" },
]

export default function FollowUpsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { timezone } = useBrowserTimezone()

    const [followUps, setFollowUps] = React.useState<FollowUp[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [stats, setStats] = React.useState<FollowUpStats>({ total: 0, pending: 0, overdue: 0, completed: 0 })

    // Pagination state
    const [page, setPage] = React.useState(1)
    const [totalPages, setTotalPages] = React.useState(0)
    const [total, setTotal] = React.useState(0)
    const pageSize = 20

    // Filters - sync from URL / localStorage
    const [filter, setFilterState] = React.useState<FollowUpFilterType>("all")
    const [statusFilter, setStatusFilterState] = React.useState<FollowUpStatus | "all">("all")
    
    // Date range filter
    const [dateRangePreset, setDateRangePreset] = React.useState<DateRangePreset>("all_time")
    const [customDateFrom, setCustomDateFrom] = React.useState<Date | undefined>()
    const [customDateTo, setCustomDateTo] = React.useState<Date | undefined>()

    // Calculate date range based on preset
    const getDateRange = React.useCallback(() => {
        const now = new Date()
        switch (dateRangePreset) {
            case "today":
                return {
                    date_from: startOfDay(now).toISOString(),
                    date_to: endOfDay(now).toISOString()
                }
            case "this_week":
                return {
                    date_from: startOfWeek(now, { weekStartsOn: 0 }).toISOString(),
                    date_to: endOfWeek(now, { weekStartsOn: 0 }).toISOString()
                }
            case "this_month":
                return {
                    date_from: startOfMonth(now).toISOString(),
                    date_to: endOfMonth(now).toISOString()
                }
            case "custom":
                return {
                    date_from: customDateFrom ? startOfDay(customDateFrom).toISOString() : undefined,
                    date_to: customDateTo ? endOfDay(customDateTo).toISOString() : undefined
                }
            case "all_time":
            default:
                return { date_from: undefined, date_to: undefined }
        }
    }, [dateRangePreset, customDateFrom, customDateTo])

    React.useEffect(() => {
        const urlFilter = searchParams.get("filter") as FollowUpFilterType | null
        const urlStatus = searchParams.get("status") as FollowUpStatus | "all" | null
        const urlPage = searchParams.get("page")
        const urlDatePreset = searchParams.get("date_preset") as DateRangePreset | null
        
        if (urlFilter && FOLLOWUP_VALID_FILTERS.includes(urlFilter)) setFilterState(urlFilter)
        if (urlStatus) setStatusFilterState(urlStatus === "all" ? "all" : urlStatus)
        if (urlPage) setPage(parseInt(urlPage) || 1)
        if (urlDatePreset) setDateRangePreset(urlDatePreset)
    }, [searchParams])

    React.useEffect(() => {
        if (searchParams.get("filter") != null || searchParams.get("status") != null) return
        const saved = filterStorage.getFollowUps()
        if (!saved) return
        const params = new URLSearchParams()
        if (saved.filter && FOLLOWUP_VALID_FILTERS.includes(saved.filter as FollowUpFilterType)) params.set("filter", saved.filter)
        if (saved.status && saved.status !== "all") params.set("status", saved.status)
        if (params.toString()) router.replace(`/follow-ups?${params.toString()}`)
    }, [router, searchParams])

    const updateUrlParams = React.useCallback((updates: Record<string, string | undefined>) => {
        const params = new URLSearchParams(searchParams.toString())
        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined && value !== "all" && value !== "1" && value !== "all_time") {
                params.set(key, value)
            } else {
                params.delete(key)
            }
        })
        router.replace(`/follow-ups?${params.toString()}`)
    }, [router, searchParams])

    const setFilter = React.useCallback(
        (v: FollowUpFilterType) => {
            setFilterState(v)
            setPage(1)
            updateUrlParams({ filter: v, page: "1" })
            filterStorage.setFollowUps({ filter: v, status: statusFilter === "all" ? undefined : statusFilter })
        },
        [updateUrlParams, statusFilter]
    )

    const setStatusFilter = React.useCallback(
        (v: FollowUpStatus | "all") => {
            setStatusFilterState(v)
            setPage(1)
            updateUrlParams({ status: v === "all" ? undefined : v, page: "1" })
            filterStorage.setFollowUps({
                filter: filter,
                status: v === "all" ? undefined : v,
            })
        },
        [updateUrlParams, filter]
    )

    const handleDatePresetChange = React.useCallback((preset: DateRangePreset) => {
        setDateRangePreset(preset)
        setPage(1)
        if (preset !== "custom") {
            setCustomDateFrom(undefined)
            setCustomDateTo(undefined)
        }
        updateUrlParams({ date_preset: preset, page: "1" })
    }, [updateUrlParams])

    const handlePageChange = React.useCallback((newPage: number) => {
        setPage(newPage)
        updateUrlParams({ page: newPage.toString() })
    }, [updateUrlParams])
    
    // Complete dialog
    const [completeDialogOpen, setCompleteDialogOpen] = React.useState(false)
    const [selectedFollowUp, setSelectedFollowUp] = React.useState<FollowUp | null>(null)
    const [completionNotes, setCompletionNotes] = React.useState("")
    const [isCompleting, setIsCompleting] = React.useState(false)
    
    // Delete dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    
    // Schedule follow-up modal
    const [scheduleModalOpen, setScheduleModalOpen] = React.useState(false)
    
    // Fetch follow-ups
    const fetchFollowUps = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const dateRange = getDateRange()
            const params: any = {
                page,
                page_size: pageSize,
                ...dateRange
            }
            
            if (filter === "overdue") {
                params.overdue = true
            } else if (filter === "pending") {
                params.status = "pending"
            } else if (filter === "completed") {
                params.status = "completed"
            }
            
            if (statusFilter !== "all") {
                params.status = statusFilter
            }
            
            const response = await FollowUpService.listFollowUps(params)
            setFollowUps(response.items)
            setTotal(response.total)
            setTotalPages(response.total_pages)
            if (response.stats) {
                setStats(response.stats)
            }
        } catch (error) {
            console.error("Failed to fetch follow-ups:", error)
        } finally {
            setIsLoading(false)
        }
    }, [filter, statusFilter, page, getDateRange])
    
    React.useEffect(() => {
        fetchFollowUps()
    }, [fetchFollowUps])
    
    // Handle complete
    const handleCompleteClick = (followUp: FollowUp) => {
        setSelectedFollowUp(followUp)
        setCompletionNotes("")
        setCompleteDialogOpen(true)
    }
    
    const handleCompleteConfirm = async () => {
        if (!selectedFollowUp) return
        
        setIsCompleting(true)
        try {
            await FollowUpService.completeFollowUp(selectedFollowUp.id, completionNotes || undefined)
            setCompleteDialogOpen(false)
            setSelectedFollowUp(null)
            setCompletionNotes("")
            fetchFollowUps()
        } catch (error) {
            console.error("Failed to complete follow-up:", error)
        } finally {
            setIsCompleting(false)
        }
    }
    
    // Handle delete
    const handleDeleteClick = (followUp: FollowUp) => {
        setSelectedFollowUp(followUp)
        setDeleteDialogOpen(true)
    }
    
    const handleDeleteConfirm = async () => {
        if (!selectedFollowUp) return
        
        setIsDeleting(true)
        try {
            await FollowUpService.deleteFollowUp(selectedFollowUp.id)
            setDeleteDialogOpen(false)
            setSelectedFollowUp(null)
            fetchFollowUps()
        } catch (error) {
            console.error("Failed to delete follow-up:", error)
        } finally {
            setIsDeleting(false)
        }
    }
    
    // Handle navigation to lead
    const handleLeadClick = (leadId: string) => {
        router.push(`/leads/${leadId}`)
    }

    // Clear all filters
    const clearFilters = React.useCallback(() => {
        setFilterState("all")
        setStatusFilterState("all")
        setDateRangePreset("all_time")
        setCustomDateFrom(undefined)
        setCustomDateTo(undefined)
        setPage(1)
        router.replace("/follow-ups")
        filterStorage.setFollowUps({ filter: "all", status: undefined })
    }, [router])

    const hasActiveFilters = filter !== "all" || statusFilter !== "all" || dateRangePreset !== "all_time"
    
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
                    <p className="text-muted-foreground">
                        Manage and track your scheduled follow-ups
                    </p>
                </div>
                <Button onClick={() => setScheduleModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule Follow-up
                </Button>
            </div>
            
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Total</p>
                                <p className="text-2xl font-bold">{stats.total}</p>
                            </div>
                            <Calendar className="h-8 w-8 text-muted-foreground" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Pending</p>
                                <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                            </div>
                            <Clock className="h-8 w-8 text-yellow-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Overdue</p>
                                <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
                            </div>
                            <AlertCircle className="h-8 w-8 text-red-600" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Completed</p>
                                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
                            </div>
                            <CheckCircle className="h-8 w-8 text-green-600" />
                        </div>
                    </CardContent>
                </Card>
            </div>
            
            {/* Filters */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-4">
                        <Tabs value={filter} onValueChange={(v) => setFilter(v as FollowUpFilterType)}>
                            <TabsList>
                                <TabsTrigger value="all">All</TabsTrigger>
                                <TabsTrigger value="pending">
                                    Pending
                                    {stats.pending > 0 && (
                                        <Badge variant="secondary" className="ml-2">
                                            {stats.pending}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="overdue">
                                    Overdue
                                    {stats.overdue > 0 && (
                                        <Badge variant="destructive" className="ml-2">
                                            {stats.overdue}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="completed">Completed</TabsTrigger>
                            </TabsList>
                        </Tabs>
                        
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FollowUpStatus | "all")}>
                            <SelectTrigger className="w-[160px]">
                                <SelectValue placeholder="Filter by status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Statuses</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="missed">Missed</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Date Range Filter */}
                        <Select value={dateRangePreset} onValueChange={(v) => handleDatePresetChange(v as DateRangePreset)}>
                            <SelectTrigger className="w-[160px]">
                                <Calendar className="mr-2 h-4 w-4" />
                                <SelectValue placeholder="Date Range" />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_RANGE_PRESETS.map((preset) => (
                                    <SelectItem key={preset.value} value={preset.value}>
                                        {preset.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Custom Date Pickers */}
                        {dateRangePreset === "custom" && (
                            <div className="flex items-center gap-2">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className={cn(!customDateFrom && "text-muted-foreground")}>
                                            {customDateFrom ? format(customDateFrom, "MMM d, yyyy") : "From"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <CalendarComponent
                                            mode="single"
                                            selected={customDateFrom}
                                            onSelect={(date) => {
                                                setCustomDateFrom(date)
                                                setPage(1)
                                            }}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <span className="text-muted-foreground">to</span>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className={cn(!customDateTo && "text-muted-foreground")}>
                                            {customDateTo ? format(customDateTo, "MMM d, yyyy") : "To"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <CalendarComponent
                                            mode="single"
                                            selected={customDateTo}
                                            onSelect={(date) => {
                                                setCustomDateTo(date)
                                                setPage(1)
                                            }}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        )}
                        
                        {hasActiveFilters && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearFilters}
                            >
                                <X className="h-4 w-4 mr-1" />
                                Clear Filters
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
            
            {/* Follow-ups List */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>
                            {filter === "overdue" ? "Overdue Follow-ups" : 
                             filter === "pending" ? "Pending Follow-ups" :
                             filter === "completed" ? "Completed Follow-ups" :
                             "All Follow-ups"}
                            {total > 0 && (
                                <span className="ml-2 text-sm font-normal text-muted-foreground">
                                    ({total} {total === 1 ? "follow-up" : "follow-ups"})
                                </span>
                            )}
                        </CardTitle>
                        {totalPages > 1 && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>
                                    Page {page} of {totalPages}
                                </span>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : followUps.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Calendar className="h-12 w-12 text-muted-foreground/20 mb-4" />
                            <p className="text-lg font-medium">No follow-ups</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {filter === "overdue"
                                    ? "Great! No overdue follow-ups."
                                    : filter === "pending"
                                    ? "No pending follow-ups scheduled."
                                    : "You don't have any follow-ups yet."}
                            </p>
                            {filter === "all" && !hasActiveFilters && (
                                <Button
                                    onClick={() => setScheduleModalOpen(true)}
                                    className="mt-4"
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Schedule Your First Follow-up
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y">
                            {followUps.map((followUp) => {
                                const statusInfo = FOLLOW_UP_STATUS_INFO[followUp.status]
                                const isOverdue = followUp.status === "pending" && new Date(followUp.scheduled_at) < new Date()
                                const leadName = followUp.lead
                                    ? (followUp.lead.customer?.full_name || `${followUp.lead.customer?.first_name || ""} ${followUp.lead.customer?.last_name || ""}`.trim() || "Unknown")
                                    : "Unknown Lead"
                                
                                return (
                                    <div
                                        key={followUp.id}
                                        className={`p-4 hover:bg-muted/50 transition-colors ${
                                            isOverdue ? "bg-red-50 dark:bg-red-950/20" : ""
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                                                isOverdue ? "bg-red-100 dark:bg-red-900/30" :
                                                followUp.status === "completed" ? "bg-green-100 dark:bg-green-900/30" :
                                                "bg-yellow-100 dark:bg-yellow-900/30"
                                            }`}>
                                                {isOverdue ? (
                                                    <AlertCircle className="h-5 w-5 text-red-600" />
                                                ) : followUp.status === "completed" ? (
                                                    <CheckCircle className="h-5 w-5 text-green-600" />
                                                ) : (
                                                    <Clock className="h-5 w-5 text-yellow-600" />
                                                )}
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <button
                                                                onClick={() => handleLeadClick(followUp.lead_id)}
                                                                className="font-medium hover:underline text-left"
                                                            >
                                                                {leadName}
                                                            </button>
                                                            <Badge variant={statusInfo.variant}>
                                                                {statusInfo.label}
                                                            </Badge>
                                                            {isOverdue && (
                                                                <Badge variant="destructive" className="text-xs">
                                                                    Overdue
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        
                                                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                                            <div className="flex items-center gap-1">
                                                                <Calendar className="h-4 w-4" />
                                                                <span>
                                                                    {formatDateInTimezone(followUp.scheduled_at, timezone, {
                                                                        dateStyle: "medium",
                                                                        timeStyle: "short"
                                                                    })}
                                                                </span>
                                                            </div>
                                                            {followUp.assigned_to_user && (
                                                                <div className="flex items-center gap-1">
                                                                    <User className="h-4 w-4" />
                                                                    <span>
                                                                        {followUp.assigned_to_user.first_name} {followUp.assigned_to_user.last_name}
                                                                    </span>
                                                                    <Badge variant="outline" className="text-xs">
                                                                        {getRoleDisplayName(followUp.assigned_to_user.role)}
                                                                    </Badge>
                                                                </div>
                                                            )}
                                                            {followUp.lead?.customer?.phone && (
                                                                <div className="flex items-center gap-1">
                                                                    <Phone className="h-4 w-4" />
                                                                    <span>{followUp.lead.customer.phone}</span>
                                                                </div>
                                                            )}
                                                            {followUp.lead?.customer?.email && (
                                                                <div className="flex items-center gap-1">
                                                                    <Mail className="h-4 w-4" />
                                                                    <span className="truncate max-w-[200px]">{followUp.lead.customer.email}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        
                                                        {followUp.notes && (
                                                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                                                {followUp.notes}
                                                            </p>
                                                        )}
                                                        
                                                        {followUp.status === "completed" && followUp.completed_at && (
                                                            <p className="text-xs text-muted-foreground mt-2">
                                                                Completed {formatRelativeTimeInTimezone(followUp.completed_at, timezone)}
                                                            </p>
                                                        )}
                                                        
                                                        {followUp.completion_notes && (
                                                            <p className="text-sm text-muted-foreground mt-2 italic">
                                                                Completion notes: {followUp.completion_notes}
                                                            </p>
                                                        )}
                                                    </div>
                                                    
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm">
                                                                <MoreVertical className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {followUp.status === "pending" && (
                                                                <DropdownMenuItem onClick={() => handleCompleteClick(followUp)}>
                                                                    <CheckCircle className="mr-2 h-4 w-4" />
                                                                    Mark as Completed
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuItem onClick={() => handleLeadClick(followUp.lead_id)}>
                                                                <User className="mr-2 h-4 w-4" />
                                                                View Lead
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleDeleteClick(followUp)}
                                                                className="text-destructive"
                                                            >
                                                                <Trash2 className="mr-2 h-4 w-4" />
                                                                Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t">
                            <div className="text-sm text-muted-foreground">
                                Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, total)} of {total}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page <= 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {/* Complete Dialog */}
            <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Complete Follow-up</DialogTitle>
                        <DialogDescription>
                            Mark this follow-up as completed. You can add completion notes below.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium">Completion Notes (Optional)</label>
                            <Textarea
                                value={completionNotes}
                                onChange={(e) => setCompletionNotes(e.target.value)}
                                placeholder="Add any notes about the follow-up completion..."
                                rows={4}
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setCompleteDialogOpen(false)
                                setCompletionNotes("")
                            }}
                            disabled={isCompleting}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleCompleteConfirm} disabled={isCompleting}>
                            {isCompleting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Completing...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="mr-2 h-4 w-4" />
                                    Mark as Completed
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Follow-up</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this follow-up? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                "Delete"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            {/* Schedule Follow-up Modal */}
            <ScheduleFollowUpModal
                isOpen={scheduleModalOpen}
                onClose={() => setScheduleModalOpen(false)}
                onSuccess={() => {
                    fetchFollowUps()
                }}
            />
        </div>
    )
}
