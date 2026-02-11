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
} from "lucide-react"
import Link from "next/link"

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
    FollowUpService,
    FollowUp,
    FollowUpStatus,
    FOLLOW_UP_STATUS_INFO,
} from "@/services/follow-up-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone, formatRelativeTimeInTimezone } from "@/utils/timezone"
import { UserAvatar } from "@/components/ui/avatar"
import { getRoleDisplayName } from "@/hooks/use-role"
import { ScheduleFollowUpModal } from "@/components/follow-ups/schedule-follow-up-modal"
import { filterStorage } from "@/lib/filter-storage"

const FOLLOWUP_VALID_FILTERS = ["all", "pending", "overdue", "completed"] as const
type FollowUpFilterType = (typeof FOLLOWUP_VALID_FILTERS)[number]

export default function FollowUpsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { timezone } = useBrowserTimezone()

    const [followUps, setFollowUps] = React.useState<FollowUp[]>([])
    const [isLoading, setIsLoading] = React.useState(true)

    // Filters - sync from URL / localStorage
    const [filter, setFilterState] = React.useState<FollowUpFilterType>("all")
    const [statusFilter, setStatusFilterState] = React.useState<FollowUpStatus | "all">("all")

    React.useEffect(() => {
        const urlFilter = searchParams.get("filter") as FollowUpFilterType | null
        const urlStatus = searchParams.get("status") as FollowUpStatus | "all" | null
        if (urlFilter && FOLLOWUP_VALID_FILTERS.includes(urlFilter)) setFilterState(urlFilter)
        if (urlStatus) setStatusFilterState(urlStatus === "all" ? "all" : urlStatus)
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

    const setFilter = React.useCallback(
        (v: FollowUpFilterType) => {
            setFilterState(v)
            const params = new URLSearchParams(searchParams.toString())
            params.set("filter", v)
            if (statusFilter !== "all") params.set("status", statusFilter)
            else params.delete("status")
            router.replace(`/follow-ups?${params.toString()}`)
            filterStorage.setFollowUps({ filter: v, status: statusFilter === "all" ? undefined : statusFilter })
        },
        [router, searchParams, statusFilter]
    )
    const setStatusFilter = React.useCallback(
        (v: FollowUpStatus | "all") => {
            setStatusFilterState(v)
            const params = new URLSearchParams(searchParams.toString())
            if (v !== "all") params.set("status", v)
            else params.delete("status")
            if (searchParams.get("filter")) params.set("filter", searchParams.get("filter")!)
            router.replace(`/follow-ups?${params.toString()}`)
            filterStorage.setFollowUps({
                filter: (searchParams.get("filter") as FollowUpFilterType) || "all",
                status: v === "all" ? undefined : v,
            })
        },
        [router, searchParams]
    )
    
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
            const params: any = {}
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
            
            const data = await FollowUpService.listFollowUps(params)
            setFollowUps(data)
        } catch (error) {
            console.error("Failed to fetch follow-ups:", error)
        } finally {
            setIsLoading(false)
        }
    }, [filter, statusFilter])
    
    React.useEffect(() => {
        fetchFollowUps()
    }, [fetchFollowUps])
    
    // Calculate stats
    const stats = React.useMemo(() => {
        const total = followUps.length
        const pending = followUps.filter(f => f.status === "pending").length
        const overdue = followUps.filter(f => {
            if (f.status !== "pending") return false
            return new Date(f.scheduled_at) < new Date()
        }).length
        const completed = followUps.filter(f => f.status === "completed").length
        
        return { total, pending, overdue, completed }
    }, [followUps])
    
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
    
    // Filter follow-ups based on current filter
    const filteredFollowUps = React.useMemo(() => {
        let filtered = followUps
        
        if (filter === "overdue") {
            filtered = filtered.filter(f => {
                if (f.status !== "pending") return false
                return new Date(f.scheduled_at) < new Date()
            })
        } else if (filter === "pending") {
            filtered = filtered.filter(f => f.status === "pending")
        } else if (filter === "completed") {
            filtered = filtered.filter(f => f.status === "completed")
        }
        
        if (statusFilter !== "all") {
            filtered = filtered.filter(f => f.status === statusFilter)
        }
        
        return filtered.sort((a, b) => {
            // Sort by scheduled_at ascending (earliest first)
            return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
        })
    }, [followUps, filter, statusFilter])
    
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
                    <div className="flex items-center gap-4">
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
                            <SelectTrigger className="w-[200px]">
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
                        
                        {(filter !== "all" || statusFilter !== "all") && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setFilter("all")
                                    setStatusFilter("all")
                                }}
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
                    <CardTitle>
                        {filter === "overdue" ? "Overdue Follow-ups" : 
                         filter === "pending" ? "Pending Follow-ups" :
                         filter === "completed" ? "Completed Follow-ups" :
                         "All Follow-ups"}
                        {filteredFollowUps.length > 0 && (
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                                ({filteredFollowUps.length} {filteredFollowUps.length === 1 ? "follow-up" : "follow-ups"})
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredFollowUps.length === 0 ? (
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
                            {filter === "all" && (
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
                            {filteredFollowUps.map((followUp) => {
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
