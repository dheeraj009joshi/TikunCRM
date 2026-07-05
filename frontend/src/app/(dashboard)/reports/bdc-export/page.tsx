"use client"

import * as React from "react"
import Link from "next/link"
import { startOfDay, endOfDay, parseISO } from "date-fns"
import {
    Download,
    Loader2,
    RefreshCw,
    QrCode,
    Filter,
    AlertCircle,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
    TableEmpty,
} from "@/components/ui/table"
import { PageHeader } from "@/components/ui/page-header"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { useBdcDealership } from "@/contexts/bdc-dealership-context"
import { DealershipService } from "@/services/dealership-service"
import { TeamService } from "@/services/team-service"
import { LeadStageService, type LeadStage } from "@/services/lead-stage-service"
import {
    ReportsService,
    type BdcExportFilters,
    type BdcExportPreviewResponse,
} from "@/services/reports-service"
import { getAppointmentStatusLabel, type AppointmentStatus } from "@/services/appointment-service"
import { SavedViewsBar } from "@/components/leads/saved-views-bar"
import type { SavedView } from "@/services/saved-view-service"
import { filterStorage, type BdcExportFilterState } from "@/lib/filter-storage"
import { SavedViewService } from "@/services/saved-view-service"

const ALL_DEALERSHIPS = "__all__"
const BDC_EXPORT_ENTITY = "bdc_export"

const LEAD_SOURCES = [
    { value: "manual", label: "Manual" },
    { value: "website", label: "Website" },
    { value: "google_sheets", label: "Google Sheets" },
    { value: "meta_ads", label: "Meta Ads" },
    { value: "referral", label: "Referral" },
    { value: "walk_in", label: "Walk-in" },
    { value: "whatsapp_inbound", label: "WhatsApp" },
]

const APPOINTMENT_FUNNELS = [
    { value: "", label: "Any appointment" },
    { value: "scheduled", label: "Scheduled / Confirmed" },
    { value: "show_up", label: "Show up (arrived+)" },
    { value: "completed", label: "Completed" },
    { value: "sold", label: "Sold (appointment)" },
    { value: "no_show", label: "No show" },
    { value: "cancelled", label: "Cancelled / Rescheduled" },
]

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
    "scheduled", "confirmed", "arrived", "in_showroom", "in_progress",
    "completed", "sold", "no_show", "cancelled", "rescheduled",
]

function toIsoStart(dateStr: string): string {
    return startOfDay(parseISO(dateStr)).toISOString()
}

function toIsoEnd(dateStr: string): string {
    return endOfDay(parseISO(dateStr)).toISOString()
}

function buildFilters(state: {
    allDealerships: boolean
    dealershipId: string | null
    bdcAgentId: string | null
    assignedTo: string | null
    stageId: string | null
    source: string | null
    search: string
    activeOnly: boolean | null
    leadDateFrom: string
    leadDateTo: string
    soldDateFrom: string
    soldDateTo: string
    apptDateFrom: string
    apptDateTo: string
    apptFunnel: string
    hasAppointment: string
    selectedApptStatuses: string[]
    soldOnly: boolean
}): BdcExportFilters {
    const f: BdcExportFilters = {}
    if (state.allDealerships) {
        f.all_dealerships = true
    } else if (state.dealershipId) {
        f.dealership_id = state.dealershipId
    }
    if (state.bdcAgentId) f.bdc_agent_id = state.bdcAgentId
    if (state.assignedTo) f.assigned_to = state.assignedTo
    if (state.stageId) f.stage_id = state.stageId
    if (state.source) f.source = state.source
    if (state.search.trim()) f.search = state.search.trim()
    if (state.activeOnly === true) f.is_active = true
    if (state.activeOnly === false) f.is_active = false
    if (state.leadDateFrom) f.lead_date_from = toIsoStart(state.leadDateFrom)
    if (state.leadDateTo) f.lead_date_to = toIsoEnd(state.leadDateTo)
    if (state.soldDateFrom) f.sold_date_from = toIsoStart(state.soldDateFrom)
    if (state.soldDateTo) f.sold_date_to = toIsoEnd(state.soldDateTo)
    if (state.apptDateFrom) f.appointment_date_from = toIsoStart(state.apptDateFrom)
    if (state.apptDateTo) f.appointment_date_to = toIsoEnd(state.apptDateTo)
    if (state.apptFunnel) f.appointment_funnel = state.apptFunnel
    if (state.selectedApptStatuses.length) f.appointment_statuses = state.selectedApptStatuses.join(",")
    if (state.hasAppointment === "yes") f.has_appointment = true
    if (state.hasAppointment === "no") f.has_appointment = false
    if (state.soldOnly) f.sold_only = true
    return f
}

function filtersToStorage(state: {
    allDealerships: boolean
    dealershipId: string | null
    bdcAgentId: string | null
    assignedTo: string | null
    stageId: string | null
    source: string | null
    search: string
    activeOnly: boolean | null
    leadDateFrom: string
    leadDateTo: string
    soldDateFrom: string
    soldDateTo: string
    apptDateFrom: string
    apptDateTo: string
    apptFunnel: string
    hasAppointment: string
    selectedApptStatuses: string[]
    soldOnly: boolean
}): BdcExportFilterState {
    return {
        allDealerships: state.allDealerships ? "true" : undefined,
        dealershipId: state.dealershipId ?? undefined,
        bdcAgentId: state.bdcAgentId ?? undefined,
        assignedTo: state.assignedTo ?? undefined,
        stageId: state.stageId ?? undefined,
        source: state.source ?? undefined,
        search: state.search || undefined,
        activeOnly: state.activeOnly === null ? undefined : state.activeOnly ? "yes" : "no",
        leadDateFrom: state.leadDateFrom || undefined,
        leadDateTo: state.leadDateTo || undefined,
        soldDateFrom: state.soldDateFrom || undefined,
        soldDateTo: state.soldDateTo || undefined,
        apptDateFrom: state.apptDateFrom || undefined,
        apptDateTo: state.apptDateTo || undefined,
        apptFunnel: state.apptFunnel || undefined,
        hasAppointment: state.hasAppointment !== "any" ? state.hasAppointment : undefined,
        selectedApptStatuses: state.selectedApptStatuses.length ? state.selectedApptStatuses.join(",") : undefined,
        soldOnly: state.soldOnly ? "true" : undefined,
    }
}

function applyStoredFilters(
    stored: BdcExportFilterState,
    setters: {
        setAllDealerships: (v: boolean) => void
        setDealershipId: (v: string | null) => void
        setBdcAgentId: (v: string | null) => void
        setAssignedTo: (v: string | null) => void
        setStageId: (v: string | null) => void
        setSource: (v: string | null) => void
        setSearch: (v: string) => void
        setActiveOnly: (v: boolean | null) => void
        setLeadDateFrom: (v: string) => void
        setLeadDateTo: (v: string) => void
        setSoldDateFrom: (v: string) => void
        setSoldDateTo: (v: string) => void
        setApptDateFrom: (v: string) => void
        setApptDateTo: (v: string) => void
        setApptFunnel: (v: string) => void
        setHasAppointment: (v: string) => void
        setSelectedApptStatuses: (v: string[]) => void
        setSoldOnly: (v: boolean) => void
    }
) {
    if (stored.allDealerships === "true") setters.setAllDealerships(true)
    if (stored.dealershipId) {
        setters.setDealershipId(stored.dealershipId)
        setters.setAllDealerships(false)
    }
    setters.setBdcAgentId(stored.bdcAgentId ?? null)
    setters.setAssignedTo(stored.assignedTo ?? null)
    setters.setStageId(stored.stageId ?? null)
    setters.setSource(stored.source ?? null)
    setters.setSearch(stored.search ?? "")
    if (stored.activeOnly === "yes") setters.setActiveOnly(true)
    else if (stored.activeOnly === "no") setters.setActiveOnly(false)
    setters.setLeadDateFrom(stored.leadDateFrom ?? "")
    setters.setLeadDateTo(stored.leadDateTo ?? "")
    setters.setSoldDateFrom(stored.soldDateFrom ?? "")
    setters.setSoldDateTo(stored.soldDateTo ?? "")
    setters.setApptDateFrom(stored.apptDateFrom ?? "")
    setters.setApptDateTo(stored.apptDateTo ?? "")
    setters.setApptFunnel(stored.apptFunnel ?? "")
    setters.setHasAppointment(stored.hasAppointment ?? "any")
    setters.setSelectedApptStatuses(
        stored.selectedApptStatuses ? stored.selectedApptStatuses.split(",").filter(Boolean) : []
    )
    setters.setSoldOnly(stored.soldOnly === "true")
}

function hasDealershipScope(allDealerships: boolean, dealershipId: string | null) {
    return allDealerships || Boolean(dealershipId)
}

export default function BdcExportReportPage() {
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin, isBdc } = useRole()
    const { user } = useAuthStore()
    const bdcCtx = useBdcDealership()
    const canView = isDealershipAdmin || isDealershipOwner || isSuperAdmin || isBdc

    const [preview, setPreview] = React.useState<BdcExportPreviewResponse | null>(null)
    const [loading, setLoading] = React.useState(false)
    const [exporting, setExporting] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [activeViewId, setActiveViewId] = React.useState<string | null>(null)
    const [filtersRestored, setFiltersRestored] = React.useState(false)

    const [allDealerships, setAllDealerships] = React.useState(false)
    const [dealershipId, setDealershipId] = React.useState<string | null>(null)
    const [bdcAgentId, setBdcAgentId] = React.useState<string | null>(null)
    const [assignedTo, setAssignedTo] = React.useState<string | null>(null)
    const [stageId, setStageId] = React.useState<string | null>(null)
    const [source, setSource] = React.useState<string | null>(null)
    const [search, setSearch] = React.useState("")
    const [activeOnly, setActiveOnly] = React.useState<boolean | null>(null)
    const [leadDateFrom, setLeadDateFrom] = React.useState("")
    const [leadDateTo, setLeadDateTo] = React.useState("")
    const [soldDateFrom, setSoldDateFrom] = React.useState("")
    const [soldDateTo, setSoldDateTo] = React.useState("")
    const [apptDateFrom, setApptDateFrom] = React.useState("")
    const [apptDateTo, setApptDateTo] = React.useState("")
    const [apptFunnel, setApptFunnel] = React.useState("")
    const [hasAppointment, setHasAppointment] = React.useState("any")
    const [selectedApptStatuses, setSelectedApptStatuses] = React.useState<string[]>([])
    const [soldOnly, setSoldOnly] = React.useState(false)

    const [dealerships, setDealerships] = React.useState<Array<{ id: string; name: string }>>([])
    const [salespersons, setSalespersons] = React.useState<Array<{ id: string; first_name: string; last_name: string }>>([])
    const [bdcAgents, setBdcAgents] = React.useState<Array<{ id: string; first_name: string; last_name: string }>>([])
    const [stages, setStages] = React.useState<LeadStage[]>([])

    React.useEffect(() => {
        if (!canView || filtersRestored) return
        const stored = filterStorage.getBdcExport()
        if (stored) {
            applyStoredFilters(stored, {
                setAllDealerships, setDealershipId, setBdcAgentId, setAssignedTo, setStageId,
                setSource, setSearch, setActiveOnly, setLeadDateFrom, setLeadDateTo,
                setSoldDateFrom, setSoldDateTo, setApptDateFrom, setApptDateTo,
                setApptFunnel, setHasAppointment, setSelectedApptStatuses, setSoldOnly,
            })
            setFiltersRestored(true)
            return
        }
        SavedViewService.list(BDC_EXPORT_ENTITY)
            .then((views) => {
                const defaultView = views.find((v) => v.is_default) ?? views[0]
                if (defaultView) {
                    applyStoredFilters(defaultView.filters as BdcExportFilterState, {
                        setAllDealerships, setDealershipId, setBdcAgentId, setAssignedTo, setStageId,
                        setSource, setSearch, setActiveOnly, setLeadDateFrom, setLeadDateTo,
                        setSoldDateFrom, setSoldDateTo, setApptDateFrom, setApptDateTo,
                        setApptFunnel, setHasAppointment, setSelectedApptStatuses, setSoldOnly,
                    })
                    setActiveViewId(defaultView.id)
                }
            })
            .finally(() => setFiltersRestored(true))
    }, [canView, filtersRestored])

    React.useEffect(() => {
        if (!canView) return
        if (isSuperAdmin) {
            DealershipService.getDealershipsForSelect().then(setDealerships).catch(() => setDealerships([]))
        } else if (isBdc && user?.id) {
            TeamService.getUserDealershipAccess(user.id)
                .then((res) => setDealerships(res.dealerships))
                .catch(() => setDealerships([]))
        } else if (user?.dealership_id) {
            DealershipService.getDealership(user.dealership_id)
                .then((d) => setDealerships([{ id: d.id, name: d.name }]))
                .catch(() => setDealerships([]))
        }
    }, [canView, isSuperAdmin, isBdc, user?.id, user?.dealership_id])

    React.useEffect(() => {
        if (!filtersRestored) return
        if (allDealerships) return
        if (dealershipId) return
        if (isBdc && bdcCtx?.selectedDealershipId) {
            setDealershipId(bdcCtx.selectedDealershipId)
        } else if (dealerships.length === 1) {
            setDealershipId(dealerships[0].id)
        }
    }, [filtersRestored, isBdc, bdcCtx?.selectedDealershipId, dealerships, allDealerships, dealershipId])

    React.useEffect(() => {
        const scopeId = allDealerships ? undefined : dealershipId ?? undefined
        if (!allDealerships && !dealershipId) {
            setSalespersons([])
            setBdcAgents([])
            setStages([])
            return
        }
        TeamService.getSalespersons(scopeId).then(setSalespersons).catch(() => setSalespersons([]))
        TeamService.listBdcAgents(scopeId).then(setBdcAgents).catch(() => setBdcAgents([]))
        if (dealershipId && !allDealerships) {
            LeadStageService.list(dealershipId).then(setStages).catch(() => setStages([]))
        } else {
            setStages([])
        }
    }, [dealershipId, allDealerships])

    const filterState = React.useMemo(
        () => ({
            allDealerships, dealershipId, bdcAgentId, assignedTo, stageId, source, search, activeOnly,
            leadDateFrom, leadDateTo, soldDateFrom, soldDateTo, apptDateFrom, apptDateTo,
            apptFunnel, hasAppointment, selectedApptStatuses, soldOnly,
        }),
        [
            allDealerships, dealershipId, bdcAgentId, assignedTo, stageId, source, search, activeOnly,
            leadDateFrom, leadDateTo, soldDateFrom, soldDateTo, apptDateFrom, apptDateTo,
            apptFunnel, hasAppointment, selectedApptStatuses, soldOnly,
        ]
    )

    React.useEffect(() => {
        if (!filtersRestored) return
        filterStorage.setBdcExport(filtersToStorage(filterState))
    }, [filterState, filtersRestored])

    const getCurrentFilters = React.useCallback(
        () => {
            const stored = filtersToStorage(filterState)
            const out: Record<string, string> = {}
            for (const [k, v] of Object.entries(stored)) {
                if (v != null && v !== "") out[k] = String(v)
            }
            return out
        },
        [filterState]
    )

    const applySavedView = React.useCallback((view: SavedView) => {
        applyStoredFilters(view.filters as BdcExportFilterState, {
            setAllDealerships, setDealershipId, setBdcAgentId, setAssignedTo, setStageId,
            setSource, setSearch, setActiveOnly, setLeadDateFrom, setLeadDateTo,
            setSoldDateFrom, setSoldDateTo, setApptDateFrom, setApptDateTo,
            setApptFunnel, setHasAppointment, setSelectedApptStatuses, setSoldOnly,
        })
        setActiveViewId(view.id)
        setPreview(null)
    }, [])

    const loadPreview = React.useCallback(async () => {
        if (!hasDealershipScope(allDealerships, dealershipId)) {
            setError("Select a dealership or choose All dealerships to preview the report.")
            return
        }
        setLoading(true)
        setError(null)
        try {
            const data = await ReportsService.previewBdcExport(buildFilters(filterState))
            setPreview(data)
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            setError(typeof detail === "string" ? detail : "Failed to load preview")
            setPreview(null)
        } finally {
            setLoading(false)
        }
    }, [allDealerships, dealershipId, filterState])

    const handleExport = async (format: "zip" | "xlsx" | "pdf") => {
        if (!hasDealershipScope(allDealerships, dealershipId)) {
            setError("Select a dealership or choose All dealerships before exporting.")
            return
        }
        setExporting(true)
        setError(null)
        try {
            const { blob, filename } = await ReportsService.downloadBdcExport(buildFilters(filterState), format)
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename
            a.click()
            URL.revokeObjectURL(url)
            await loadPreview()
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            setError(typeof detail === "string" ? detail : "Export failed")
        } finally {
            setExporting(false)
        }
    }

    const toggleApptStatus = (status: string) => {
        setSelectedApptStatuses((prev) =>
            prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
        )
    }

    if (!canView) {
        return (
            <div className="p-6">
                <p className="text-muted-foreground">You do not have access to BDC export reports.</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto">
            <PageHeader
                title="BDC Export Report"
                description="Filter leads by dealership, appointments, and outcomes — export PDF/Excel with guest QR codes."
            />

            <SavedViewsBar
                entityType={BDC_EXPORT_ENTITY}
                getCurrentFilters={getCurrentFilters}
                onApply={applySavedView}
                activeViewId={activeViewId}
            />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Filter className="h-4 w-4" /> Filters
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                            <Label>Dealership</Label>
                            <Select
                                value={allDealerships ? ALL_DEALERSHIPS : (dealershipId ?? "")}
                                onValueChange={(v) => {
                                    if (v === ALL_DEALERSHIPS) {
                                        setAllDealerships(true)
                                        setDealershipId(null)
                                        setStageId(null)
                                    } else {
                                        setAllDealerships(false)
                                        setDealershipId(v || null)
                                    }
                                }}
                            >
                                <SelectTrigger><SelectValue placeholder="Select dealership" /></SelectTrigger>
                                <SelectContent>
                                    {(dealerships.length > 1 || isSuperAdmin || isBdc) && (
                                        <SelectItem value={ALL_DEALERSHIPS}>All dealerships</SelectItem>
                                    )}
                                    {dealerships.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>BDC agent</Label>
                            <Select value={bdcAgentId ?? "all"} onValueChange={(v) => setBdcAgentId(v === "all" ? null : v)}>
                                <SelectTrigger><SelectValue placeholder="All BDC agents" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All BDC agents</SelectItem>
                                    {bdcAgents.map((a) => (
                                        <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Salesperson</Label>
                            <Select value={assignedTo ?? "all"} onValueChange={(v) => setAssignedTo(v === "all" ? null : v)}>
                                <SelectTrigger><SelectValue placeholder="All salespeople" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All salespeople</SelectItem>
                                    {salespersons.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Stage</Label>
                            <Select value={stageId ?? "all"} onValueChange={(v) => setStageId(v === "all" ? null : v)}>
                                <SelectTrigger><SelectValue placeholder="All stages" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All stages</SelectItem>
                                    {stages.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Source</Label>
                            <Select value={source ?? "all"} onValueChange={(v) => setSource(v === "all" ? null : v)}>
                                <SelectTrigger><SelectValue placeholder="All sources" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All sources</SelectItem>
                                    {LEAD_SOURCES.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Search</Label>
                            <Input placeholder="Name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Active leads</Label>
                            <Select
                                value={activeOnly === null ? "all" : activeOnly ? "yes" : "no"}
                                onValueChange={(v) => setActiveOnly(v === "all" ? null : v === "yes")}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="yes">Active only</SelectItem>
                                    <SelectItem value="no">Inactive only</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-end gap-2">
                            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
                                <Checkbox checked={soldOnly} onCheckedChange={(c) => setSoldOnly(c === true)} />
                                Sold / converted only
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t">
                        <div className="space-y-1.5">
                            <Label>Lead created from</Label>
                            <Input type="date" value={leadDateFrom} onChange={(e) => setLeadDateFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Lead created to</Label>
                            <Input type="date" value={leadDateTo} onChange={(e) => setLeadDateTo(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Sold date from</Label>
                            <Input type="date" value={soldDateFrom} onChange={(e) => setSoldDateFrom(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Sold date to</Label>
                            <Input type="date" value={soldDateTo} onChange={(e) => setSoldDateTo(e.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Appointment filters</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="space-y-1.5">
                                <Label>Appointment funnel</Label>
                                <Select value={apptFunnel || "any"} onValueChange={(v) => setApptFunnel(v === "any" ? "" : v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {APPOINTMENT_FUNNELS.map((f) => (
                                            <SelectItem key={f.value || "any"} value={f.value || "any"}>{f.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Has appointment</Label>
                                <Select value={hasAppointment} onValueChange={setHasAppointment}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any">Any</SelectItem>
                                        <SelectItem value="yes">Has appointment</SelectItem>
                                        <SelectItem value="no">No appointment</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Appt date from</Label>
                                <Input type="date" value={apptDateFrom} onChange={(e) => setApptDateFrom(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Appt date to</Label>
                                <Input type="date" value={apptDateTo} onChange={(e) => setApptDateTo(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {APPOINTMENT_STATUSES.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => toggleApptStatus(s)}
                                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                        selectedApptStatuses.includes(s)
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-muted-foreground/30 text-muted-foreground hover:border-primary/50"
                                    }`}
                                >
                                    {getAppointmentStatusLabel(s)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        <Button onClick={loadPreview} disabled={loading || !hasDealershipScope(allDealerships, dealershipId)}>
                            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                            Preview
                        </Button>
                        <Button variant="default" onClick={() => handleExport("pdf")} disabled={exporting || !hasDealershipScope(allDealerships, dealershipId)}>
                            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                            Export PDF
                        </Button>
                        <Button variant="secondary" onClick={() => handleExport("zip")} disabled={exporting || !hasDealershipScope(allDealerships, dealershipId)}>
                            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                            Export ZIP (PDF + Excel + QR PNGs)
                        </Button>
                        <Button variant="outline" onClick={() => handleExport("xlsx")} disabled={exporting || !hasDealershipScope(allDealerships, dealershipId)}>
                            <Download className="h-4 w-4 mr-2" /> Excel only
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div>
                        <CardTitle className="text-base">Preview</CardTitle>
                        {preview && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Showing {preview.items.length} of {preview.total.toLocaleString()} leads
                                {preview.missing_guest_count > 0 && (
                                    <> · {preview.missing_guest_count} missing guest profile (will be auto-created on export)</>
                                )}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-block h-3 w-6 rounded bg-amber-100 border border-amber-200" />
                        Auto-generated guest (on export)
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                {allDealerships && <TableHead>Dealership</TableHead>}
                                <TableHead>Phone</TableHead>
                                <TableHead>Stage</TableHead>
                                <TableHead>BDC</TableHead>
                                <TableHead>Salesperson</TableHead>
                                <TableHead>Latest appt</TableHead>
                                <TableHead>Check-in</TableHead>
                                <TableHead>Guest Trust</TableHead>
                                <TableHead>Guest QR</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={allDealerships ? 10 : 9} className="h-32 text-center">
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                                    </TableCell>
                                </TableRow>
                            ) : !preview?.items.length ? (
                                <TableEmpty title="Run Preview to see matching leads." />
                            ) : (
                                preview.items.map((row) => (
                                    <TableRow
                                        key={row.lead_id}
                                        className={!row.guest_qr_url ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}
                                    >
                                        <TableCell>
                                            <Link href={`/leads/${row.lead_id}`} className="font-medium hover:underline">
                                                {row.full_name}
                                            </Link>
                                        </TableCell>
                                        {allDealerships && (
                                            <TableCell className="text-sm">{row.dealership || "—"}</TableCell>
                                        )}
                                        <TableCell className="text-sm">{row.phone || "—"}</TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]">{row.stage || "—"}</Badge></TableCell>
                                        <TableCell className="text-sm">{row.bdc_agent || "—"}</TableCell>
                                        <TableCell className="text-sm">{row.salesperson || "—"}</TableCell>
                                        <TableCell className="text-sm">
                                            {row.latest_appt_status || "—"}
                                            {row.latest_appt_date && (
                                                <span className="block text-[10px] text-muted-foreground">
                                                    {new Date(row.latest_appt_date).toLocaleDateString()}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">{row.showroom_check_in}</TableCell>
                                        <TableCell className="text-sm tabular-nums">
                                            {row.guest_trust_score != null ? Math.round(row.guest_trust_score) : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {row.guest_qr_url ? (
                                                <a href={row.guest_qr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                                    <QrCode className="h-3.5 w-3.5" /> View
                                                </a>
                                            ) : (
                                                <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                                                    Will generate
                                                </Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
