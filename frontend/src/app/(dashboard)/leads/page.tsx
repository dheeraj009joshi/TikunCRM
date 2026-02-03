"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
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
    Trash2
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LeadService, Lead, LeadListResponse } from "@/services/lead-service"
import { AssignToSalespersonModal, AssignToDealershipModal } from "@/components/leads/assignment-modal"
import { CreateLeadModal } from "@/components/leads/create-lead-modal"
import { useRole } from "@/hooks/use-role"
import { cn } from "@/lib/utils"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatDateInTimezone } from "@/utils/timezone"

const LEAD_STATUSES = [
    { value: "all", label: "All Statuses" },
    { value: "new", label: "New" },
    { value: "contacted", label: "Contacted" },
    { value: "follow_up", label: "Follow Up" },
    { value: "interested", label: "Interested" },
    { value: "not_interested", label: "Not Interested" },
    { value: "converted", label: "Converted" },
    { value: "lost", label: "Lost" },
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

export default function LeadsPage() {
    const searchParams = useSearchParams()
    const filterParam = searchParams.get('filter')
    const { timezone } = useDealershipTimezone()
    
    const { role, isDealershipAdmin, isDealershipOwner, isDealershipLevel, isSuperAdmin, canAssignToSalesperson, hasPermission } = useRole()
    const canCreateLead = hasPermission("create_lead")
    
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [total, setTotal] = React.useState(0)
    const [page, setPage] = React.useState(1)
    const [search, setSearch] = React.useState("")
    const [status, setStatus] = React.useState("all")
    const [source, setSource] = React.useState("all")
    const [viewMode, setViewMode] = React.useState<"all" | "unassigned">(
        filterParam === "unassigned" ? "unassigned" : "all"
    )
    const [isLoading, setIsLoading] = React.useState(true)
    
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

    const fetchLeads = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const params: Record<string, unknown> = { page, page_size: 20 }
            if (search) params.search = search
            if (status && status !== "all") params.status = status
            if (source && source !== "all") params.source = source
            // Unassigned pool (no dealership) - visible to all users
            if (viewMode === "unassigned") params.pool = "unassigned"

            const data = await LeadService.listLeads(params)
            setLeads(data.items)
            setTotal(data.total)
        } catch (error) {
            console.error("Failed to fetch leads:", error)
        } finally {
            setIsLoading(false)
        }
    }, [page, search, status, source, viewMode])

    React.useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads()
        }, 300)
        return () => clearTimeout(timer)
    }, [fetchLeads])

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
    }

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

    return (
        <div className="space-y-6">
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

            {/* Leads / Unassigned Pool toggles - visible to all users */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "all" | "unassigned")}>
                <TabsList>
                    <TabsTrigger value="all">Leads</TabsTrigger>
                    <TabsTrigger value="unassigned">Unassigned Pool</TabsTrigger>
                </TabsList>
            </Tabs>

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
                            <Select value={status} onValueChange={setStatus}>
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
                            <Select value={source} onValueChange={setSource}>
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
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="h-4 w-px bg-border" />
                            <p className="text-sm text-muted-foreground px-2">
                                Showing <span className="font-medium text-foreground">{leads.length}</span> of{" "}
                                <span className="font-medium text-foreground">{total}</span> leads
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Leads Table */}
            <Card className="overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Customer</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Assigned To</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="w-20">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableLoading columns={6} rows={10} />
                        ) : leads.length === 0 ? (
                            <TableEmpty
                                icon={<Inbox className="h-10 w-10" />}
                                title={viewMode === "unassigned" ? "No unassigned leads" : "No leads found"}
                                description={
                                    search || status !== "all" || source !== "all"
                                        ? "Try adjusting your filters"
                                        : viewMode === "unassigned"
                                            ? "No leads in the unassigned pool"
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
                                                {lead.first_name.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="font-semibold group-hover:text-primary transition-colors">
                                                    {lead.first_name} {lead.last_name}
                                                </p>
                                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                                    {lead.email && (
                                                        <span className="flex items-center gap-1">
                                                            <Mail className="h-3 w-3" />
                                                            {lead.email}
                                                        </span>
                                                    )}
                                                    {lead.phone && (
                                                        <span className="flex items-center gap-1">
                                                            <Phone className="h-3 w-3" />
                                                            {lead.phone}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={getStatusVariant(lead.status)}>
                                            {lead.status.replace('_', ' ')}
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
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <Calendar className="h-3 w-3" />
                                            {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium" })}
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
                                                {lead.phone && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        window.location.href = `tel:${lead.phone}`
                                                    }}>
                                                        <Phone className="mr-2 h-4 w-4" />
                                                        Call
                                                    </DropdownMenuItem>
                                                )}
                                                {lead.email && (
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.stopPropagation()
                                                        window.location.href = `mailto:${lead.email}`
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
                            Are you sure you want to delete <strong>{leadToDelete?.first_name} {leadToDelete?.last_name}</strong>? 
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
        </div>
    )
}
