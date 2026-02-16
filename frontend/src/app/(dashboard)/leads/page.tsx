"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import {
    Inbox,
    Search,
    Filter,
    Plus,
    MoreVertical,
    Phone,
    Mail,
    Calendar,
    Loader2,
    UserPlus,
    Eye,
    Building2,
    Trash2,
    Download,
    FileSpreadsheet,
    CheckCircle2,
    List,
    LayoutGrid
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, getStatusVariant, getSourceVariant } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { LeadService, Lead, LeadListResponse, type LeadListParams, getLeadFullName, getLeadPhone, getLeadEmail, isFreshLead } from "@/services/lead-service"
import { LeadStageService, LeadStage, getStageLabel, getStageColor } from "@/services/lead-stage-service"
import { AssignToSalespersonModal, AssignToDealershipModal } from "@/components/leads/assignment-modal"
import { CreateLeadModal } from "@/components/leads/create-lead-modal"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { TeamService } from "@/services/team-service"
import { cn } from "@/lib/utils"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { useWebSocketEvent } from "@/hooks/use-websocket"
import { LeadsPipelineView } from "@/components/leads/leads-pipeline-view"
import type { DragEndEvent } from "@dnd-kit/core"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"
import { filterStorage } from "@/lib/filter-storage"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"

// Lead stages are now loaded dynamically from the API
// LEAD_STATUSES kept as fallback for initial render
const LEAD_STATUSES_FALLBACK = [
    { value: "all", label: "All Stages" },
]

const LEAD_SOURCES = [
    { value: "all", label: "All Sources" },
    { value: "google_sheets", label: "Google Sheets" },
    { value: "meta_ads", label: "Meta Ads" },
    { value: "manual", label: "Manual" },
    { value: "website", label: "Website" },
    { value: "referral", label: "Referral" },
    { value: "walk_in", label: "Walk-in" },
]

type ViewMode = "mine" | "unassigned" | "all" | "converted" | "fresh" | "manager_review"
type DisplayView = "list" | "pipeline"

export default function LeadsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const filterParam = searchParams.get("filter")
    const statusParam = searchParams.get("status")
    const sourceParam = searchParams.get("source")
    const viewParam = searchParams.get("view")
    const assignedToParam = searchParams.get("assigned_to")
    const { timezone } = useBrowserTimezone()

    const { role, isDealershipAdmin, isDealershipOwner, isDealershipLevel, isSuperAdmin, isSalesperson, canAssignToSalesperson, hasPermission } = useRole()
    const canCreateLead = hasPermission("create_lead")

    const [leads, setLeads] = React.useState<Lead[]>([])
    const [total, setTotal] = React.useState(0)
    const [page, setPage] = React.useState(1)
    const [search, setSearch] = React.useState("")
    const [status, setStatus] = React.useState(statusParam || "all")
    const [selectedStageIds, setSelectedStageIds] = React.useState<string[]>([])
    const [source, setSource] = React.useState(sourceParam || "all")
    const [viewMode, setViewMode] = React.useState<ViewMode>(
        filterParam === "unassigned" ? "unassigned" : filterParam === "converted" ? "converted" : filterParam === "fresh" ? "fresh" : filterParam === "all" ? "all" : filterParam === "manager_review" ? "manager_review" : "mine"
    )
    const [displayView, setDisplayView] = React.useState<DisplayView>(viewParam === "pipeline" ? "pipeline" : "list")
    const [assignedTo, setAssignedTo] = React.useState(assignedToParam || "all")
    const [teamMembers, setTeamMembers] = React.useState<{ id: string; first_name: string; last_name: string }[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [stages, setStages] = React.useState<LeadStage[]>([])
    const [leadsByStage, setLeadsByStage] = React.useState<Record<string, Lead[]>>({})
    const [isLoadingPipeline, setIsLoadingPipeline] = React.useState(false)
    /** Per-stage pagination for pipeline infinite scroll: { [stageId]: { page, hasMore, total } } */
    const [stagePagination, setStagePagination] = React.useState<Record<string, { page: number; hasMore: boolean; total: number }>>({})
    const [loadingMoreStageId, setLoadingMoreStageId] = React.useState<string | null>(null)

    const PIPELINE_PAGE_SIZE = 20

    // Load pipeline stages dynamically
    React.useEffect(() => {
        LeadStageService.list().then(setStages).catch(console.error)
    }, [])

    // Build stage filter options from loaded stages
    const LEAD_STATUSES = React.useMemo(() => {
        const items = [{ value: "all", label: "All Stages" }]
        for (const s of stages) {
            items.push({ value: s.id, label: s.display_name })
        }
        return items
    }, [stages])

    // Restore filters from localStorage when URL has no params (e.g. sidebar link to /leads)
    React.useEffect(() => {
        const filter = searchParams.get("filter")
        if (filter != null) return // URL has filter, nothing to restore
        const saved = filterStorage.getLeads()
        if (!saved?.filter) return
        const params = new URLSearchParams()
        params.set("filter", saved.filter)
        if (saved.status && saved.status !== "all") params.set("status", saved.status)
        if (saved.source && saved.source !== "all") params.set("source", saved.source)
        if (saved.view === "pipeline") params.set("view", "pipeline")
        if (saved.assigned_to && saved.assigned_to !== "all") params.set("assigned_to", saved.assigned_to)
        router.replace(`/leads?${params.toString()}`)
    }, [router, searchParams])

    // When in manager_review view, sync status to manager_review stage id once stages are loaded
    React.useEffect(() => {
        if (viewMode !== "manager_review" || stages.length === 0) return
        const mr = stages.find((s) => s.name === "manager_review")
        if (mr) setStatus(mr.id)
    }, [viewMode, stages])

    // Sync view mode, status, source, display view, assigned_to with URL when user navigates via links
    React.useEffect(() => {
        const filter = searchParams.get("filter")
        const urlStatus = searchParams.get("status")
        const urlSource = searchParams.get("source")
        const urlView = searchParams.get("view")
        const urlAssignedTo = searchParams.get("assigned_to")

        if (filter === "unassigned") setViewMode("unassigned")
        else if (filter === "all") setViewMode("all")
        else if (filter === "converted") {
            setViewMode("converted")
            setStatus("converted")
        } else if (filter === "mine") setViewMode("mine")
        else if (filter === "fresh") setViewMode("fresh")
        else if (filter === "manager_review") setViewMode("manager_review")
        else if (urlStatus === "converted") {
            setViewMode("converted")
            setStatus("converted")
        }

        if (urlStatus) setStatus(urlStatus)
        if (urlSource) setSource(urlSource)
        if (urlView === "pipeline") setDisplayView("pipeline")
        else if (urlView === "list") setDisplayView("list")
        if (urlAssignedTo) setAssignedTo(urlAssignedTo)
        else setAssignedTo("all")
    }, [searchParams])

    // Load team members for admin/owner salesperson filter
    const { user } = useAuthStore()
    React.useEffect(() => {
        if (!isDealershipLevel && !isSuperAdmin) return
        TeamService.getSalespersons(user?.dealership_id ?? undefined)
            .then((list) => setTeamMembers(list))
            .catch(() => setTeamMembers([]))
    }, [isDealershipLevel, isSuperAdmin, user?.dealership_id])
    
    // Assignment modal state
    const [assignModalOpen, setAssignModalOpen] = React.useState(false)
    const [assignDealershipModalOpen, setAssignDealershipModalOpen] = React.useState(false)
    const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null)
    const [selectedLeads, setSelectedLeads] = React.useState<Lead[]>([])
    
    // Create lead modal state
    const [createModalOpen, setCreateModalOpen] = React.useState(false)
    
    // Delete confirmation state
    const [deleteModalOpen, setDeleteModalOpen] = React.useState(false)
    const [leadToDelete, setLeadToDelete] = React.useState<Lead | null>(null)
    const [isDeleting, setIsDeleting] = React.useState(false)
    
    // Export state
    const [exportModalOpen, setExportModalOpen] = React.useState(false)
    const [exportOptions, setExportOptions] = React.useState({
        include_activities: false,
        include_appointments: false,
        include_notes: false
    })
    const [isExporting, setIsExporting] = React.useState(false)

    const fetchLeads = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const params: Record<string, unknown> = { page, page_size: 20 }
            if (search) params.search = search
            if (source && source !== "all") params.source = source
            
            // Filter by view mode
            if (viewMode === "unassigned") {
                params.pool = "unassigned"
            } else if (viewMode === "mine") {
                params.pool = "mine"
            } else if (viewMode === "fresh") {
                params.fresh_only = true
                // Fresh = unassigned only; do not set pool so backend returns unassigned fresh leads in scope
            } else if (viewMode === "converted") {
                // Find converted stage id
                const convertedStage = stages.find(s => s.name === "converted")
                if (convertedStage) params.stage_id = convertedStage.id
                params.is_active = false
            } else if (viewMode === "manager_review") {
                const managerReviewStage = stages.find(s => s.name === "manager_review")
                if (managerReviewStage) params.stage_id = managerReviewStage.id
            }
            // Stage filter (stage_id must be a UUID; ignore URL values like "active" or stage names)
            const isValidStageId = status && status !== "all" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(status)
            if (viewMode !== "converted" && viewMode !== "fresh" && viewMode !== "manager_review" && isValidStageId) params.stage_id = status
            if (assignedTo && assignedTo !== "all") params.assigned_to = assignedTo

            const data = await LeadService.listLeads(params as LeadListParams)
            setLeads(data.items)
            setTotal(data.total)
        } catch (error) {
            console.error("Failed to fetch leads:", error)
        } finally {
            setIsLoading(false)
        }
    }, [page, search, status, source, viewMode, stages, assignedTo])

    const fetchLeadsForPipeline = React.useCallback(async () => {
        if (stages.length === 0) return
        setIsLoadingPipeline(true)
        setStagePagination({})
        try {
            const convertedStage = stages.find((s) => s.name === "converted")
            const baseParams: Record<string, unknown> = { page: 1, page_size: PIPELINE_PAGE_SIZE }
            if (search) baseParams.search = search
            if (source && source !== "all") baseParams.source = source
            if (assignedTo && assignedTo !== "all") baseParams.assigned_to = assignedTo

            if (viewMode === "unassigned") {
                baseParams.pool = "unassigned"
            } else if (viewMode === "mine") {
                baseParams.pool = "mine"
            } else if (viewMode === "fresh") {
                baseParams.fresh_only = true
            } else if (viewMode === "converted" && convertedStage) {
                baseParams.stage_id = convertedStage.id
                baseParams.is_active = false
            } else if (viewMode === "manager_review") {
                const managerReviewStage = stages.find((s) => s.name === "manager_review")
                if (managerReviewStage) baseParams.stage_id = managerReviewStage.id
            }

            const managerReviewStage = stages.find((s) => s.name === "manager_review")
            const stagesToFetch =
                viewMode === "converted" && convertedStage
                    ? [convertedStage.id]
                    : viewMode === "manager_review" && managerReviewStage
                        ? [managerReviewStage.id]
                        : selectedStageIds.length > 0
                        ? selectedStageIds
                        : stages.map((s) => s.id)

            const byStage: Record<string, Lead[]> = {}
            const pagination: Record<string, { page: number; hasMore: boolean; total: number }> = {}
            for (const sid of stagesToFetch) {
                byStage[sid] = []
            }

            const results = await Promise.all(
                stagesToFetch.map((stageId) =>
                    LeadService.listLeads({ ...baseParams, stage_id: stageId } as LeadListParams)
                )
            )
            for (let i = 0; i < stagesToFetch.length; i++) {
                const stageId = stagesToFetch[i]
                const data = results[i]
                byStage[stageId] = data.items
                const pages = typeof data.pages === "number" ? data.pages : Math.ceil((data.total || 0) / PIPELINE_PAGE_SIZE) || 1
                pagination[stageId] = {
                    page: 1,
                    hasMore: data.page < pages && data.items.length === PIPELINE_PAGE_SIZE,
                    total: data.total ?? 0,
                }
            }
            setLeadsByStage(byStage)
            setStagePagination(pagination)
        } catch (error) {
            console.error("Failed to fetch pipeline leads:", error)
        } finally {
            setIsLoadingPipeline(false)
        }
    }, [viewMode, search, source, selectedStageIds, stages, assignedTo])

    const loadMoreForStage = React.useCallback(
        async (stageId: string) => {
            const meta = stagePagination[stageId]
            if (!meta?.hasMore || loadingMoreStageId !== null) return
            setLoadingMoreStageId(stageId)
            try {
                const convertedStage = stages.find((s) => s.name === "converted")
                const nextPage = meta.page + 1
                const params: Record<string, unknown> = {
                    page: nextPage,
                    page_size: PIPELINE_PAGE_SIZE,
                    stage_id: stageId,
                }
                if (search) params.search = search
                if (source && source !== "all") params.source = source
                if (assignedTo && assignedTo !== "all") params.assigned_to = assignedTo
                if (viewMode === "unassigned") params.pool = "unassigned"
                else if (viewMode === "mine") params.pool = "mine"
                else if (viewMode === "converted" && convertedStage) params.is_active = false

                const data = await LeadService.listLeads(params as LeadListParams)
                setLeadsByStage((prev) => ({
                    ...prev,
                    [stageId]: [...(prev[stageId] || []), ...data.items],
                }))
                const pages = typeof data.pages === "number" ? data.pages : Math.ceil((data.total || 0) / PIPELINE_PAGE_SIZE) || 1
                setStagePagination((prev) => ({
                    ...prev,
                    [stageId]: {
                        page: nextPage,
                        hasMore: data.page < pages && data.items.length === PIPELINE_PAGE_SIZE,
                        total: data.total ?? prev[stageId]?.total ?? 0,
                    },
                }))
            } catch (error) {
                console.error("Failed to load more pipeline leads:", error)
            } finally {
                setLoadingMoreStageId(null)
            }
        },
        [stagePagination, loadingMoreStageId, stages, search, source, viewMode, assignedTo]
    )

    React.useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads()
        }, 300)
        return () => clearTimeout(timer)
    }, [fetchLeads])

    React.useEffect(() => {
        if (displayView === "pipeline" && stages.length > 0) {
            const t = setTimeout(() => fetchLeadsForPipeline(), 300)
            return () => clearTimeout(t)
        }
    }, [displayView, fetchLeadsForPipeline, stages.length])

    // WebSocket: Listen for lead updates to refresh the list in real-time
    useWebSocketEvent("lead:updated", () => {
        fetchLeads()
        if (displayView === "pipeline") fetchLeadsForPipeline()
    }, [fetchLeads, fetchLeadsForPipeline, displayView])

    // WebSocket: Listen for new leads to refresh the list in real-time
    useWebSocketEvent("lead:created", () => {
        fetchLeads()
        if (displayView === "pipeline") fetchLeadsForPipeline()
    }, [fetchLeads, fetchLeadsForPipeline, displayView])

    // WebSocket: Listen for badge refresh (triggers when assignments change)
    useWebSocketEvent("badges:refresh", () => {
        fetchLeads()
        if (displayView === "pipeline") fetchLeadsForPipeline()
    }, [fetchLeads, fetchLeadsForPipeline, displayView])

    const handleAssignClick = (lead: Lead) => {
        setSelectedLead(lead)
        setAssignModalOpen(true)
    }

    const handleAssignToDealershipClick = (lead: Lead) => {
        setSelectedLeads([lead])
        setAssignDealershipModalOpen(true)
    }

    const handleAssignmentSuccess = () => {
        fetchLeads()
        if (displayView === "pipeline") fetchLeadsForPipeline()
    }

    const applyPipelineMove = React.useCallback(
        (sourceStageId: string, targetStageId: string, lead: Lead) => {
            const leadId = lead.id
            setLeadsByStage((prev) => {
                const updated = { ...prev }
                updated[sourceStageId] = (prev[sourceStageId] || []).filter((l) => l.id !== leadId)
                updated[targetStageId] = [...(prev[targetStageId] || []), { ...lead, stage_id: targetStageId }]
                return updated
            })
        },
        []
    )

    const handlePipelineDragEnd = React.useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event
            if (!over) return

            const leadId = active.id as string
            const overId = over.id as string
            const stageIds = new Set(stages.map((s) => s.id))
            const targetStageId = stageIds.has(overId)
                ? overId
                : (() => {
                      for (const leads of Object.values(leadsByStage)) {
                          const lead = leads.find((l) => l.id === overId)
                          if (lead?.stage_id) return lead.stage_id
                      }
                      return overId
                  })()

            let sourceStageId: string | null = null
            for (const [stageId, stageLeads] of Object.entries(leadsByStage)) {
                if (stageLeads.some((l) => l.id === leadId)) {
                    sourceStageId = stageId
                    break
                }
            }
            if (!sourceStageId || sourceStageId === targetStageId) return

            const lead = leadsByStage[sourceStageId]?.find((l) => l.id === leadId)
            if (!lead) return

            try {
                const result = await LeadService.updateLeadStage(leadId, targetStageId)
                if (isSkateWarningResponse(result)) {
                    useSkateConfirmStore.getState().show(
                        result as SkateWarningInfo,
                        () => {
                            LeadService.updateLeadStage(leadId, targetStageId, undefined, true)
                                .then(() => {
                                    applyPipelineMove(sourceStageId, targetStageId, lead)
                                    fetchLeadsForPipeline()
                                })
                                .catch((err) => {
                                    const skate = getSkateAttemptDetail(err)
                                    if (skate) useSkateAlertStore.getState().show(skate)
                                    else fetchLeadsForPipeline()
                                })
                        }
                    )
                } else {
                    applyPipelineMove(sourceStageId, targetStageId, lead)
                }
            } catch (error) {
                const skate = getSkateAttemptDetail(error)
                if (skate) useSkateAlertStore.getState().show(skate)
                else {
                    console.error("Failed to update stage:", error)
                    fetchLeadsForPipeline()
                }
            }
        },
        [stages, leadsByStage, fetchLeadsForPipeline, applyPipelineMove]
    )

    const handleDeleteClick = (lead: Lead) => {
        setLeadToDelete(lead)
        setDeleteModalOpen(true)
    }

    const handleDeleteConfirm = async () => {
        if (!leadToDelete) return
        
        setIsDeleting(true)
        try {
            await LeadService.deleteLead(leadToDelete.id)
            setDeleteModalOpen(false)
            setLeadToDelete(null)
            fetchLeads()
        } catch (error) {
            console.error("Failed to delete lead:", error)
        } finally {
            setIsDeleting(false)
        }
    }

    const handleExport = async () => {
        setIsExporting(true)
        try {
            await LeadService.exportToCSV({
                ...exportOptions,
                status: status !== "all" ? status : undefined,
                source: source !== "all" ? source : undefined,
            })
            setExportModalOpen(false)
        } catch (error) {
            console.error("Failed to export leads:", error)
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <div className="space-y-6 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Leads Management</h1>
                    <p className="text-muted-foreground">Manage and track your customer pipeline.</p>
                </div>
                {canCreateLead && (
                    <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateModalOpen(true)}>
                        Add Manual Lead
                    </Button>
                )}
            </div>

            {/* Lead filter tabs + List/Pipeline toggle */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Tabs
                    value={viewMode}
                    onValueChange={(v) => {
                        const mode = v as ViewMode
                        setViewMode(mode)
                        if (mode === "converted") {
                            setStatus("converted")
                            router.push("/leads?filter=converted")
                        } else if (mode === "unassigned") {
                            router.push("/leads?filter=unassigned")
                        } else if (mode === "fresh") {
                            router.push("/leads?filter=fresh")
                        } else if (mode === "all") {
                            router.push("/leads?filter=all")
                        } else if (mode === "manager_review") {
                            router.push("/leads?filter=manager_review")
                        } else {
                            router.push("/leads?filter=mine")
                        }
                        const nextStatus = mode === "converted" ? "converted" : status
                        filterStorage.setLeads({
                            filter: mode,
                            status: nextStatus,
                            source,
                            view: displayView,
                            assigned_to: assignedTo !== "all" ? assignedTo : undefined,
                        })
                    }}
                >
                    <TabsList>
                        <TabsTrigger value="mine">Your Leads</TabsTrigger>
                        <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
                        <TabsTrigger value="all">All Leads</TabsTrigger>
                        <TabsTrigger value="fresh">Fresh (untouched)</TabsTrigger>
                        <TabsTrigger value="converted">
                            <CheckCircle2 className="h-4 w-4 mr-1.5" />
                            Converted & Sold
                        </TabsTrigger>
                        {(isDealershipAdmin || isDealershipOwner || isSuperAdmin) && (
                            <TabsTrigger value="manager_review">Manager review</TabsTrigger>
                        )}
                    </TabsList>
                </Tabs>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">View:</span>
                    <Tabs
                        value={displayView}
                        onValueChange={(v) => {
                            const next = v as DisplayView
                            setDisplayView(next)
                            const params = new URLSearchParams(searchParams.toString())
                            if (next === "pipeline") params.set("view", "pipeline")
                            else params.delete("view")
                            router.push(`/leads?${params.toString()}`)
                            filterStorage.setLeads({
                                filter: viewMode,
                                status,
                                source,
                                view: next,
                                assigned_to: assignedTo !== "all" ? assignedTo : undefined,
                            })
                        }}
                    >
                        <TabsList>
                            <TabsTrigger value="list">
                                <List className="h-4 w-4 mr-1.5" />
                                List
                            </TabsTrigger>
                            <TabsTrigger value="pipeline">
                                <LayoutGrid className="h-4 w-4 mr-1.5" />
                                Pipeline
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            {/* Toolbar */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 flex-1">
                            <Input
                                placeholder="Search leads..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                leftIcon={<Search className="h-4 w-4" />}
                                className="max-w-xs"
                            />
                            {displayView === "list" ? (
                                <Select
                                    value={status}
                                    onValueChange={(v) => {
                                        setStatus(v)
                                        const params = new URLSearchParams(searchParams.toString())
                                        if (v && v !== "all") params.set("status", v)
                                        else params.delete("status")
                                        router.replace(`/leads?${params.toString()}`)
                                        filterStorage.setLeads({
                                            filter: viewMode,
                                            status: v,
                                            source,
                                            view: displayView,
                                            assigned_to: assignedTo !== "all" ? assignedTo : undefined,
                                        })
                                    }}
                                >
                                    <SelectTrigger className="w-36">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LEAD_STATUSES.map((s) => (
                                            <SelectItem key={s.value} value={s.value}>
                                                {s.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-40 justify-between">
                                            {selectedStageIds.length === 0
                                                ? "All Stages"
                                                : selectedStageIds.length === 1
                                                    ? stages.find((s) => s.id === selectedStageIds[0])?.display_name ?? "1 stage"
                                                    : `${selectedStageIds.length} stages`}
                                            <Filter className="h-4 w-4 ml-1 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-2" align="start">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium">Stages</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setSelectedStageIds([])}
                                            >
                                                Deselect all
                                            </Button>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto space-y-1.5">
                                            {stages.map((s) => (
                                                <label
                                                    key={s.id}
                                                    className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted/50"
                                                >
                                                    <Checkbox
                                                        checked={selectedStageIds.includes(s.id)}
                                                        onCheckedChange={(checked) => {
                                                            setSelectedStageIds((prev) =>
                                                                checked
                                                                    ? [...prev, s.id]
                                                                    : prev.filter((id) => id !== s.id)
                                                            )
                                                        }}
                                                    />
                                                    <span className="text-sm truncate">{s.display_name}</span>
                                                </label>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            {selectedStageIds.length === 0
                                                ? "Showing all stages"
                                                : `Showing ${selectedStageIds.length} stage(s)`}
                                        </p>
                                    </PopoverContent>
                                </Popover>
                            )}
                            <Select
                                    value={source}
                                    onValueChange={(v) => {
                                        setSource(v)
                                        const params = new URLSearchParams(searchParams.toString())
                                        if (v && v !== "all") params.set("source", v)
                                        else params.delete("source")
                                        router.replace(`/leads?${params.toString()}`)
                                        filterStorage.setLeads({
                                            filter: viewMode,
                                            status,
                                            source: v,
                                            view: displayView,
                                            assigned_to: assignedTo !== "all" ? assignedTo : undefined,
                                        })
                                    }}
                                >
                                <SelectTrigger className="w-36">
                                    <SelectValue placeholder="Source" />
                                </SelectTrigger>
                                <SelectContent>
                                    {LEAD_SOURCES.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>
                                            {s.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {(isDealershipLevel || isSuperAdmin) && teamMembers.length > 0 && (
                                <Select
                                    value={assignedTo}
                                    onValueChange={(v) => {
                                        setAssignedTo(v)
                                        const params = new URLSearchParams(searchParams.toString())
                                        if (v && v !== "all") params.set("assigned_to", v)
                                        else params.delete("assigned_to")
                                        router.replace(`/leads?${params.toString()}`)
                                        filterStorage.setLeads({
                                            filter: viewMode,
                                            status,
                                            source,
                                            view: displayView,
                                            assigned_to: v !== "all" ? v : undefined,
                                        })
                                    }}
                                >
                                    <SelectTrigger className="w-44">
                                        <SelectValue placeholder="Team member" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All team members</SelectItem>
                                        {teamMembers.map((u) => (
                                            <SelectItem key={u.id} value={u.id}>
                                                {u.first_name} {u.last_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="h-4 w-px bg-border" />
                            {displayView === "list" ? (
                                <p className="text-sm text-muted-foreground px-2">
                                    Showing <span className="font-medium text-foreground">{leads.length}</span> of{" "}
                                    <span className="font-medium text-foreground">{total}</span> leads
                                </p>
                            ) : (
                                <p className="text-sm text-muted-foreground px-2">
                                    Drag leads between stages to update their pipeline position.
                                </p>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setExportModalOpen(true)}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Pipeline view - horizontal scroll only in this section */}
            {displayView === "pipeline" && (
                <div className="w-full min-w-0 overflow-x-auto">
                    <LeadsPipelineView
                        stages={viewMode === "converted" ? stages.filter((s) => s.name === "converted") : viewMode === "manager_review" ? stages.filter((s) => s.name === "manager_review") : selectedStageIds.length === 0 ? stages : stages.filter((s) => selectedStageIds.includes(s.id))}
                        leadsByStage={leadsByStage}
                        stagePagination={stagePagination}
                        loadingMoreStageId={loadingMoreStageId}
                        isLoading={isLoadingPipeline}
                        onDragEnd={handlePipelineDragEnd}
                        onLoadMore={loadMoreForStage}
                    />
                </div>
            )}

            {/* Leads Table (list view) */}
            {displayView === "list" && (
            <Card className="overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Customer</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Assigned To</TableHead>
                            <TableHead className="max-w-[140px]">Notes</TableHead>
                            <TableHead className="max-w-[180px]">Last action</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="w-20">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow className="border-0 hover:bg-transparent">
                                <TableCell colSpan={8} className="py-0">
                                    <div className="flex flex-col items-center justify-center py-16">
                                        <Loader2 className="h-10 w-10 text-primary animate-spin" />
                                        <p className="mt-4 text-sm font-medium text-muted-foreground">Loading leads...</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Fetching your pipeline</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : leads.length === 0 ? (
                            <TableEmpty
                                icon={<Inbox className="h-10 w-10" />}
                                title={
                                    viewMode === "mine" 
                                        ? "No leads assigned to you" 
                                        : viewMode === "unassigned" 
                                            ? "No unassigned leads" 
                                            : viewMode === "fresh"
                                                ? "No fresh leads"
                                                : viewMode === "converted"
                                                    ? "No converted or sold leads"
                                                    : viewMode === "manager_review"
                                                        ? "No leads awaiting manager review"
                                                        : "No leads found"
                                }
                                description={
                                    search || (viewMode !== "converted" && viewMode !== "fresh" && viewMode !== "manager_review" && status !== "all") || source !== "all"
                                        ? "Try adjusting your filters"
                                        : viewMode === "mine"
                                            ? "Leads assigned to you will appear here"
                                            : viewMode === "unassigned"
                                                ? "No leads in the unassigned pool"
                                                : viewMode === "fresh"
                                                    ? "Leads with no activity yet will appear here"
                                                    : viewMode === "converted"
                                                        ? "Leads marked as converted will appear here"
                                                        : viewMode === "manager_review"
                                                            ? "Leads sent for manager review will appear here"
                                                            : "Create your first lead to get started"
                                }
                                action={
                                    viewMode !== "unassigned" && canCreateLead && (
                                        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
                                            <Plus className="mr-2 h-4 w-4" />
                                            Add Lead
                                        </Button>
                                    )
                                }
                            />
                        ) : (
                            leads.map((lead) => (
                                <TableRow
                                    key={lead.id}
                                    className="hover:bg-muted/30 transition-colors group cursor-pointer"
                                    onClick={() => window.location.href = `/leads/${lead.id}`}
                                >
                                    <TableCell>
                                        <div className="flex items-center">
                                            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary mr-3 font-semibold">
                                                {(lead.customer?.first_name || "?").charAt(0)}
                                            </div>
                                            <div>
                                                <p className="font-semibold group-hover:text-primary transition-colors flex items-center gap-2">
                                                    {getLeadFullName(lead)}
                                                    {isFreshLead(lead) && (
                                                        <Badge variant="secondary" className="text-[10px] font-normal bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                                                            Fresh
                                                        </Badge>
                                                    )}
                                                </p>
                                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                                    {getLeadEmail(lead) && (
                                                        <span className="flex items-center gap-1">
                                                            <Mail className="h-3 w-3" />
                                                            {getLeadEmail(lead)}
                                                        </span>
                                                    )}
                                                    {getLeadPhone(lead) && (
                                                        <span className="flex items-center gap-1">
                                                            <Phone className="h-3 w-3" />
                                                            {getLeadPhone(lead)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" style={{ borderColor: getStageColor(lead.stage), color: getStageColor(lead.stage) }}>
                                            {getStageLabel(lead.stage)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={getSourceVariant(lead.source)} size="sm">
                                            {lead.source.replace('_', ' ')}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            {lead.dealership ? (
                                                <div className="flex items-center gap-1.5">
                                                    <Building2 className="h-3 w-3 text-muted-foreground" />
                                                    <span className="text-xs font-medium">{lead.dealership.name}</span>
                                                </div>
                                            ) : (
                                                <Badge variant="outline" className="text-amber-600 border-amber-300">
                                                    No Dealership
                                                </Badge>
                                            )}
                                            {lead.assigned_to_user ? (
                                                <div className="flex items-center gap-1.5">
                                                    <UserPlus className="h-3 w-3 text-muted-foreground" />
                                                    <span className="text-xs text-muted-foreground">
                                                        {lead.assigned_to_user.first_name} {lead.assigned_to_user.last_name}
                                                    </span>
                                                </div>
                                            ) : lead.dealership ? (
                                                <span className="text-xs text-amber-600">Not assigned to salesperson</span>
                                            ) : null}
                                        </div>
                                    </TableCell>
                                    <TableCell className="max-w-[140px]">
                                        {(() => {
                                            const noteText = lead.notes?.trim() || lead.last_note_content?.trim() || null;
                                            const displayText = noteText ? (noteText.length > 45 ? `${noteText.slice(0, 45)}…` : noteText) : "—";
                                            return (
                                                <span className="text-xs text-muted-foreground truncate block" title={noteText ?? undefined}>
                                                    {displayText}
                                                </span>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="max-w-[180px]">
                                        {lead.last_activity_description ? (
                                            <div className="space-y-0.5">
                                                <span className="text-xs block truncate" title={lead.last_activity_description}>
                                                    {lead.last_activity_description.length > 38 ? `${lead.last_activity_description.slice(0, 38)}…` : lead.last_activity_description}
                                                </span>
                                                {lead.last_activity_at && (
                                                    <span className="text-xs text-muted-foreground block">
                                                        {formatDateInTimezone(lead.last_activity_at, timezone, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <Calendar className="h-3 w-3" />
                                            {formatDateInTimezone(lead.created_at, timezone, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                <Button variant="ghost" size="icon">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={(e) => {
                                                    e.stopPropagation()
                                                    window.location.href = `/leads/${lead.id}`
                                                }}>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    View Details
                                                </DropdownMenuItem>
                                                {isSuperAdmin && !lead.dealership_id && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleAssignToDealershipClick(lead)
                                                    }}>
                                                        <Building2 className="mr-2 h-4 w-4" />
                                                        Assign to Dealership
                                                    </DropdownMenuItem>
                                                )}
                                                {(canAssignToSalesperson || isSuperAdmin || isDealershipLevel) && lead.dealership_id && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleAssignClick(lead)
                                                    }}>
                                                        <UserPlus className="mr-2 h-4 w-4" />
                                                        {lead.assigned_to ? 'Reassign to Team Member' : 'Assign to Team Member'}
                                                    </DropdownMenuItem>
                                                )}
                                                {getLeadPhone(lead) && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        window.location.href = `tel:${getLeadPhone(lead)}`
                                                    }}>
                                                        <Phone className="mr-2 h-4 w-4" />
                                                        Call
                                                    </DropdownMenuItem>
                                                )}
                                                {getLeadEmail(lead) && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        window.location.href = `mailto:${getLeadEmail(lead)}`
                                                    }}>
                                                        <Mail className="mr-2 h-4 w-4" />
                                                        Email
                                                    </DropdownMenuItem>
                                                )}
                                                {isSuperAdmin && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem 
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleDeleteClick(lead)
                                                            }}
                                                            className="text-destructive focus:text-destructive"
                                                        >
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Delete Lead
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>

                {/* Pagination */}
                {total > 20 && (
                    <div className="p-4 border-t flex items-center justify-between bg-muted/20">
                        <p className="text-xs text-muted-foreground font-medium">
                            Page {page} of {Math.ceil(total / 20)}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === 1 || isLoading}
                                onClick={() => setPage(page - 1)}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= Math.ceil(total / 20) || isLoading}
                                onClick={() => setPage(page + 1)}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
            )}

            {/* Assignment to Salesperson Modal */}
            <AssignToSalespersonModal
                open={assignModalOpen}
                onOpenChange={setAssignModalOpen}
                lead={selectedLead}
                onSuccess={handleAssignmentSuccess}
            />
            
            {/* Assignment to Dealership Modal (Super Admin) */}
            <AssignToDealershipModal
                open={assignDealershipModalOpen}
                onOpenChange={setAssignDealershipModalOpen}
                selectedLeads={selectedLeads}
                onSuccess={handleAssignmentSuccess}
            />
            
            {/* Create Lead Modal */}
            <CreateLeadModal
                isOpen={createModalOpen}
                onClose={() => setCreateModalOpen(false)}
                onSuccess={fetchLeads}
            />
            
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Lead</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>{leadToDelete ? getLeadFullName(leadToDelete) : ""}</strong>? 
                            This action cannot be undone. All associated activities and data will be permanently removed.
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
                                "Delete Lead"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            {/* Export Modal */}
            <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileSpreadsheet className="h-5 w-5" />
                            Export Leads to CSV
                        </DialogTitle>
                        <DialogDescription>
                            Export your leads data. Current filters will be applied.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="include_activities"
                                checked={exportOptions.include_activities}
                                onCheckedChange={(checked) => 
                                    setExportOptions(prev => ({ ...prev, include_activities: checked === true }))
                                }
                            />
                            <Label htmlFor="include_activities" className="text-sm font-normal">
                                Include activity history (count & last activity date)
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="include_appointments"
                                checked={exportOptions.include_appointments}
                                onCheckedChange={(checked) => 
                                    setExportOptions(prev => ({ ...prev, include_appointments: checked === true }))
                                }
                            />
                            <Label htmlFor="include_appointments" className="text-sm font-normal">
                                Include appointments (count & next appointment)
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="include_notes"
                                checked={exportOptions.include_notes}
                                onCheckedChange={(checked) => 
                                    setExportOptions(prev => ({ ...prev, include_notes: checked === true }))
                                }
                            />
                            <Label htmlFor="include_notes" className="text-sm font-normal">
                                Include lead notes
                            </Label>
                        </div>
                        
                        {(status !== "all" || source !== "all") && (
                            <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                                <strong>Filters applied:</strong>
                                {status !== "all" && <span className="ml-2">Status: {status}</span>}
                                {source !== "all" && <span className="ml-2">Source: {source}</span>}
                            </div>
                        )}
                    </div>
                    
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExportModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleExport} disabled={isExporting}>
                            {isExporting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export CSV
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
