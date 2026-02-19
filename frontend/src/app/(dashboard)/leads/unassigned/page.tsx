"use client"

import * as React from "react"
import Link from "next/link"
import {
    InboxIcon,
    Search,
    Filter,
    Building2,
    Phone,
    Mail,
    Calendar,
    Loader2,
    CheckSquare,
    Square,
    ArrowLeft
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, getSourceVariant } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
import { LeadService, Lead, LeadListResponse, getLeadFullName, getLeadPhone, getLeadEmail } from "@/services/lead-service"
import { AssignToDealershipModal } from "@/components/leads/assignment-modal"
import { useRole } from "@/hooks/use-role"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { useWebSocketEvent } from "@/hooks/use-websocket"

const LEAD_SOURCES = [
    { value: "all", label: "All Sources" },
    { value: "google_sheets", label: "Google Sheets" },
    { value: "meta_ads", label: "Meta Ads" },
    { value: "manual", label: "Manual" },
    { value: "website", label: "Website" },
    { value: "referral", label: "Referral" },
    { value: "walk_in", label: "Walk-in" },
]

export default function UnassignedLeadsPage() {
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner, isSalesperson, canAssignToSalesperson } = useRole()
    const { timezone } = useBrowserTimezone()
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [total, setTotal] = React.useState(0)
    const [page, setPage] = React.useState(1)
    const [search, setSearch] = React.useState("")
    const [source, setSource] = React.useState("all")
    const [isLoading, setIsLoading] = React.useState(true)
    const [selectedLeads, setSelectedLeads] = React.useState<Lead[]>([])
    const [isAssignModalOpen, setIsAssignModalOpen] = React.useState(false)

    // Determine if user is a dealership-level user (not super admin)
    const isDealershipLevel = isDealershipAdmin || isDealershipOwner || isSalesperson

    const fetchLeads = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const params: any = { page, page_size: 20 }
            if (search) params.search = search
            if (source && source !== "all") params.source = source

            // Use different API based on user role:
            // - Super Admin: leads with no dealership (for dealership assignment)
            // - Dealership Admin/Owner: leads in their dealership with no salesperson assigned
            const data = isSuperAdmin 
                ? await LeadService.listUnassignedLeads(params)
                : await LeadService.listUnassignedToSalesperson(params)
            
            setLeads(data.items)
            setTotal(data.total)
        } catch (error) {
            console.error("Failed to fetch unassigned leads:", error)
        } finally {
            setIsLoading(false)
        }
    }, [page, search, source, isSuperAdmin])

    React.useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads()
        }, 300)
        return () => clearTimeout(timer)
    }, [fetchLeads])

    // WebSocket: Listen for lead updates to refresh the list in real-time
    // This covers all update types: assigned, dealership_assigned, status_changed, etc.
    useWebSocketEvent("lead:updated", () => {
        fetchLeads()
    }, [fetchLeads])

    // WebSocket: Listen for new leads to refresh the list in real-time
    useWebSocketEvent("lead:created", () => {
        fetchLeads()
    }, [fetchLeads])

    // WebSocket: Listen for badge refresh (triggers when assignments change)
    useWebSocketEvent("badges:refresh", () => {
        fetchLeads()
    }, [fetchLeads])

    const handleSelectAll = () => {
        if (selectedLeads.length === leads.length) {
            setSelectedLeads([])
        } else {
            setSelectedLeads([...leads])
        }
    }

    const handleSelectLead = (lead: Lead) => {
        if (selectedLeads.some(l => l.id === lead.id)) {
            setSelectedLeads(selectedLeads.filter(l => l.id !== lead.id))
        } else {
            setSelectedLeads([...selectedLeads, lead])
        }
    }

    const handleAssignmentSuccess = () => {
        setSelectedLeads([])
        fetchLeads()
    }

    const isAllSelected = leads.length > 0 && selectedLeads.length === leads.length

    // Redirect if not super admin
    if (!isSuperAdmin) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Card className="max-w-md">
                    <CardContent className="p-6 text-center">
                        <InboxIcon className="mx-auto h-12 w-12 text-muted-foreground/20" />
                        <h2 className="mt-4 text-lg font-semibold">Access Restricted</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Only Super Admins can access the unassigned leads pool.
                        </p>
                        <Link href="/leads">
                            <Button className="mt-4">Go to My Leads</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <InboxIcon className="h-6 w-6 text-amber-500" />
                            Unassigned Leads Pool
                        </h1>
                        <p className="text-muted-foreground">
                            Leads waiting to be assigned to dealerships.
                        </p>
                    </div>
                </div>
                {selectedLeads.length > 0 && (
                    <Button 
                        onClick={() => setIsAssignModalOpen(true)}
                        leftIcon={<Building2 className="h-4 w-4" />}
                    >
                        Assign {selectedLeads.length} Lead{selectedLeads.length > 1 ? 's' : ''} to Dealership
                    </Button>
                )}
            </div>

            {/* Toolbar */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4 flex-1">
                            <Input
                                placeholder="Search leads..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                leftIcon={<Search className="h-4 w-4" />}
                                className="max-w-sm"
                            />
                            <Select value={source} onValueChange={setSource}>
                                <SelectTrigger className="w-40">
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
                                <span className="font-medium text-foreground">{total}</span> unassigned leads
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Selection info */}
            {selectedLeads.length > 0 && (
                <div className="flex items-center gap-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <CheckSquare className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">
                        {selectedLeads.length} lead{selectedLeads.length > 1 ? 's' : ''} selected
                    </span>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedLeads([])}
                    >
                        Clear selection
                    </Button>
                </div>
            )}

            {/* Leads Table */}
            <Card>
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-12">
                                <Checkbox
                                    checked={isAllSelected}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            <TableHead>Lead</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="w-32">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableLoading columns={6} rows={10} />
                        ) : leads.length === 0 ? (
                            <TableEmpty
                                icon={<InboxIcon className="h-10 w-10" />}
                                title="No unassigned leads"
                                description={search || source !== "all" 
                                    ? "Try adjusting your filters" 
                                    : "All leads have been assigned to dealerships"
                                }
                            />
                        ) : (
                            leads.map((lead) => {
                                const isSelected = selectedLeads.some(l => l.id === lead.id)
                                return (
                                    <TableRow 
                                        key={lead.id} 
                                        className={`transition-colors ${isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                                    >
                                        <TableCell>
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => handleSelectLead(lead)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 font-semibold">
                                                    {(lead.customer?.first_name || "?").charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="font-semibold">
                                                        {getLeadFullName(lead)}
                                                    </p>
                                                    {lead.interested_in && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Interested in: {lead.interested_in}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getSourceVariant(lead.source)} size="sm">
                                                {(lead.source_display ?? lead.source)?.replace(/_/g, ' ') ?? ''}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {getLeadEmail(lead) && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Mail className="h-3 w-3" />
                                                        {getLeadEmail(lead)}
                                                    </span>
                                                )}
                                                {getLeadPhone(lead) && (
                                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Phone className="h-3 w-3" />
                                                        {getLeadPhone(lead)}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Calendar className="h-3 w-3" />
                                                {formatDateInTimezone(lead.created_at, timezone, {
                                                    year: "numeric",
                                                    month: "short",
                                                    day: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit"
                                                })}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedLeads([lead])
                                                    setIsAssignModalOpen(true)
                                                }}
                                            >
                                                <Building2 className="mr-1 h-3 w-3" />
                                                Assign
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
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

            {/* Assignment Modal */}
            <AssignToDealershipModal
                open={isAssignModalOpen}
                onOpenChange={setIsAssignModalOpen}
                selectedLeads={selectedLeads}
                onSuccess={handleAssignmentSuccess}
            />
        </div>
    )
}
