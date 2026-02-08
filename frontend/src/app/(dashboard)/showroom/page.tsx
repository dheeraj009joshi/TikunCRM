"use client"

import * as React from "react"
import { format, formatDistanceToNow } from "date-fns"
import { 
    Users, 
    UserPlus, 
    LogOut, 
    Clock, 
    RefreshCw,
    Search,
    Phone,
    Mail,
    CheckCircle2,
    XCircle,
    Calendar,
    CalendarClock,
    ArrowUpDown,
    ChevronRight,
    Store,
    AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserAvatar } from "@/components/ui/avatar"
import { 
    ShowroomService, 
    ShowroomVisit, 
    ShowroomStats, 
    ShowroomOutcome,
    getOutcomeLabel,
    getOutcomeColor 
} from "@/services/showroom-service"
import { LeadService, Lead } from "@/services/lead-service"
import { AppointmentService, Appointment } from "@/services/appointment-service"
import { CreateLeadModal } from "@/components/leads/create-lead-modal"
import { formatDateInTimezone } from "@/utils/timezone"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useWebSocket } from "@/hooks/use-websocket"
import { useRole } from "@/hooks/use-role"
import { cn } from "@/lib/utils"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import Link from "next/link"
import { Plus } from "lucide-react"

// Time slots for reschedule (same as book appointment: 6 AM–11 PM, 15-min intervals)
const RESCHEDULE_TIME_SLOTS: { value: string; label: string }[] = []
for (let hour = 6; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
        const h = hour.toString().padStart(2, "0")
        const m = minute.toString().padStart(2, "0")
        RESCHEDULE_TIME_SLOTS.push({
            value: `${h}:${m}`,
            label: `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`,
        })
    }
}

export default function ShowroomPage() {
    const [currentVisits, setCurrentVisits] = React.useState<ShowroomVisit[]>([])
    const [historyVisits, setHistoryVisits] = React.useState<ShowroomVisit[]>([])
    const [stats, setStats] = React.useState<ShowroomStats | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    
    // Check-in modal
    const [showCheckInModal, setShowCheckInModal] = React.useState(false)
    const [checkInLeadSearch, setCheckInLeadSearch] = React.useState("")
    const [searchResults, setSearchResults] = React.useState<Lead[]>([])
    const [selectedLead, setSelectedLead] = React.useState<Lead | null>(null)
    const [checkInNotes, setCheckInNotes] = React.useState("")
    const [checkInLoading, setCheckInLoading] = React.useState(false)
    const [searching, setSearching] = React.useState(false)
    const [showCheckInAppointmentModal, setShowCheckInAppointmentModal] = React.useState(false)
    const [leadAppointmentsForCheckIn, setLeadAppointmentsForCheckIn] = React.useState<Appointment[]>([])
    
    // Check-out modal
    const [showCheckOutModal, setShowCheckOutModal] = React.useState(false)
    const [checkOutVisit, setCheckOutVisit] = React.useState<ShowroomVisit | null>(null)
    const [checkOutOutcome, setCheckOutOutcome] = React.useState<ShowroomOutcome>("follow_up")
    const [checkOutNotes, setCheckOutNotes] = React.useState("")
    const [checkOutRescheduleDate, setCheckOutRescheduleDate] = React.useState<Date | undefined>(undefined)
    const [checkOutRescheduleTime, setCheckOutRescheduleTime] = React.useState("")
    const [checkOutLoading, setCheckOutLoading] = React.useState(false)
    
    // History pagination
    const [historyPage, setHistoryPage] = React.useState(1)
    const [historyTotal, setHistoryTotal] = React.useState(0)

    // Add lead from check-in modal when not found
    const [showCreateLeadFromCheckIn, setShowCreateLeadFromCheckIn] = React.useState(false)

    const { hasPermission } = useRole()
    const canCreateLead = hasPermission("create_lead")
    const { timezone } = useBrowserTimezone()

    // WebSocket for real-time updates
    const { lastMessage } = useWebSocket()
    
    React.useEffect(() => {
        if (lastMessage?.type === "showroom:update") {
            loadData()
        }
    }, [lastMessage])

    const loadData = React.useCallback(async () => {
        try {
            const [currentRes, historyRes, statsRes] = await Promise.all([
                ShowroomService.getCurrent(),
                ShowroomService.getHistory({ page: historyPage, page_size: 20 }),
                ShowroomService.getStats()
            ])
            setCurrentVisits(currentRes.visits)
            setHistoryVisits(historyRes.items)
            setHistoryTotal(historyRes.total)
            setStats(statsRes)
        } catch (error) {
            console.error("Failed to load showroom data:", error)
        } finally {
            setLoading(false)
        }
    }, [historyPage])

    React.useEffect(() => {
        loadData()
    }, [loadData])

    // Search leads for check-in (same listLeads API as leads page – search by name, email, phone, etc.)
    React.useEffect(() => {
        if (!checkInLeadSearch.trim()) {
            setSearchResults([])
            return
        }
        
        const timer = setTimeout(async () => {
            setSearching(true)
            try {
                const res = await LeadService.listLeads({ search: checkInLeadSearch.trim(), page_size: 15 })
                setSearchResults(res.items)
            } catch (error) {
                console.error("Search failed:", error)
            } finally {
                setSearching(false)
            }
        }, 300)
        
        return () => clearTimeout(timer)
    }, [checkInLeadSearch])

    const doCheckIn = async (appointmentId: string | null) => {
        if (!selectedLead) return
        setCheckInLoading(true)
        try {
            await ShowroomService.checkIn({
                lead_id: selectedLead.id,
                notes: checkInNotes || undefined,
                ...(appointmentId ? { appointment_id: appointmentId } : {}),
            })
            setShowCheckInModal(false)
            setShowCheckInAppointmentModal(false)
            setLeadAppointmentsForCheckIn([])
            setSelectedLead(null)
            setCheckInLeadSearch("")
            setCheckInNotes("")
            loadData()
        } catch (error: any) {
            const detail = error.response?.data?.detail
            const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(" ") : "Failed to check in"
            alert(message)
        } finally {
            setCheckInLoading(false)
        }
    }

    const handleCheckIn = async () => {
        if (!selectedLead) return
        setCheckInLoading(true)
        try {
            const now = new Date()
            const startOfToday = new Date(now)
            startOfToday.setHours(0, 0, 0, 0)
            const res = await AppointmentService.list({
                lead_id: selectedLead.id,
                date_from: startOfToday.toISOString(),
                page_size: 50,
            })
            const linkable = res.items.filter(
                (a) =>
                    ["scheduled", "confirmed"].includes(a.status) &&
                    new Date(a.scheduled_at) >= now
            )
            if (linkable.length === 0) {
                await doCheckIn(null)
            } else if (linkable.length === 1) {
                await doCheckIn(linkable[0].id)
            } else {
                setLeadAppointmentsForCheckIn(linkable)
                setShowCheckInAppointmentModal(true)
            }
        } catch (error: any) {
            const detail = error.response?.data?.detail
            const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(" ") : "Failed to load appointments"
            alert(message)
        } finally {
            setCheckInLoading(false)
        }
    }

    const openCheckOut = (visit: ShowroomVisit) => {
        setCheckOutVisit(visit)
        setCheckOutOutcome("follow_up")
        setCheckOutNotes("")
        setCheckOutRescheduleDate(undefined)
        setCheckOutRescheduleTime("")
        setShowCheckOutModal(true)
    }

    const handleCheckOut = async () => {
        if (!checkOutVisit) return
        const needsReschedule = checkOutOutcome === "reschedule" && checkOutVisit.appointment_id
        if (needsReschedule && (!checkOutRescheduleDate || !checkOutRescheduleTime)) {
            alert("Please select a date and time for the rescheduled appointment.")
            return
        }
        let reschedule_scheduled_at: string | undefined
        if (needsReschedule && checkOutRescheduleDate && checkOutRescheduleTime) {
            const [h, m] = checkOutRescheduleTime.split(":").map(Number)
            const d = new Date(checkOutRescheduleDate.getFullYear(), checkOutRescheduleDate.getMonth(), checkOutRescheduleDate.getDate(), h, m, 0, 0)
            reschedule_scheduled_at = d.toISOString()
        }
        setCheckOutLoading(true)
        try {
            await ShowroomService.checkOut(checkOutVisit.id, {
                outcome: checkOutOutcome,
                notes: checkOutNotes || undefined,
                reschedule_scheduled_at,
            })
            setShowCheckOutModal(false)
            setCheckOutVisit(null)
            setCheckOutRescheduleDate(undefined)
            setCheckOutRescheduleTime("")
            loadData()
        } catch (error: any) {
            alert(error.response?.data?.detail || "Failed to check out")
        } finally {
            setCheckOutLoading(false)
        }
    }

    const filteredCurrentVisits = currentVisits.filter(visit => {
        if (!searchQuery) return true
        const lead = visit.lead
        if (!lead) return false
        const fullName = `${lead.first_name} ${lead.last_name || ""}`.toLowerCase()
        return fullName.includes(searchQuery.toLowerCase()) || 
               lead.phone?.includes(searchQuery) ||
               lead.email?.toLowerCase().includes(searchQuery.toLowerCase())
    })

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Dealership</h1>
                    <p className="text-muted-foreground">Track customers in the dealership</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={loadData}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                    <Button onClick={() => setShowCheckInModal(true)}>
                        <UserPlus className="h-4 w-4 mr-2" />
                        Check In Customer
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Currently In Dealership</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-primary">
                            {stats?.currently_in_showroom ?? 0}
                        </div>
                        <p className="text-xs text-muted-foreground">customers right now</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Checked In Today</CardTitle>
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">{stats?.checked_in_today ?? 0}</div>
                        <p className="text-xs text-muted-foreground">total visits today</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Sold Today</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-emerald-600">{stats?.sold_today ?? 0}</div>
                        <p className="text-xs text-muted-foreground">conversions from dealership</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg Visit Duration</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold">
                            {stats?.avg_visit_duration_minutes 
                                ? `${Math.round(stats.avg_visit_duration_minutes)}m` 
                                : "—"}
                        </div>
                        <p className="text-xs text-muted-foreground">last 30 days</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs for Current vs History */}
            <Tabs defaultValue="current" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="current" className="gap-2">
                        <Users className="h-4 w-4" />
                        Currently Here ({currentVisits.length})
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <Clock className="h-4 w-4" />
                        Visit History
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="current" className="space-y-4">
                    {/* Search */}
                    <div className="flex items-center gap-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name, phone, or email..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </div>

                    {/* Current Visitors Table */}
                    <Card>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Contact</TableHead>
                                    <TableHead>Checked In</TableHead>
                                    <TableHead>Duration</TableHead>
                                    <TableHead>Checked In By</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCurrentVisits.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            {currentVisits.length === 0 
                                                ? "No customers in dealership right now" 
                                                : "No results match your search"}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredCurrentVisits.map((visit) => (
                                        <TableRow key={visit.id}>
                                            <TableCell>
                                                <Link 
                                                    href={`/leads/${visit.lead_id}`}
                                                    className="flex items-center gap-3 hover:underline"
                                                >
                                                    <UserAvatar 
                                                        firstName={visit.lead?.first_name ?? ""}
                                                        lastName={visit.lead?.last_name ?? ""}
                                                        size="sm"
                                                    />
                                                    <div>
                                                        <div className="font-medium">
                                                            {visit.lead?.first_name} {visit.lead?.last_name}
                                                        </div>
                                                    </div>
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    {visit.lead?.phone && (
                                                        <div className="flex items-center gap-1 text-sm">
                                                            <Phone className="h-3 w-3" />
                                                            {visit.lead.phone}
                                                        </div>
                                                    )}
                                                    {visit.lead?.email && (
                                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                            <Mail className="h-3 w-3" />
                                                            {visit.lead.email}
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {format(new Date(visit.checked_in_at), "h:mm a")}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">
                                                    <Clock className="h-3 w-3 mr-1" />
                                                    {formatDistanceToNow(new Date(visit.checked_in_at))}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {visit.checked_in_by_user && (
                                                    <div className="text-sm text-muted-foreground">
                                                        {visit.checked_in_by_user.first_name} {visit.checked_in_by_user.last_name}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    onClick={() => openCheckOut(visit)}
                                                >
                                                    <LogOut className="h-4 w-4 mr-2" />
                                                    Check Out
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                <TabsContent value="history" className="space-y-4">
                    <Card>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Duration</TableHead>
                                    <TableHead>Outcome</TableHead>
                                    <TableHead>Checked In By</TableHead>
                                    <TableHead></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {historyVisits.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            No visit history yet
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    historyVisits.map((visit) => {
                                        const duration = visit.checked_out_at
                                            ? Math.round((new Date(visit.checked_out_at).getTime() - new Date(visit.checked_in_at).getTime()) / 60000)
                                            : null
                                        return (
                                            <TableRow key={visit.id}>
                                                <TableCell>
                                                    <Link 
                                                        href={`/leads/${visit.lead_id}`}
                                                        className="flex items-center gap-3 hover:underline"
                                                    >
                                                        <UserAvatar 
                                                            firstName={visit.lead?.first_name ?? ""}
                                                            lastName={visit.lead?.last_name ?? ""}
                                                            size="sm"
                                                        />
                                                        <span className="font-medium">
                                                            {visit.lead?.first_name} {visit.lead?.last_name}
                                                        </span>
                                                    </Link>
                                                </TableCell>
                                                <TableCell>
                                                    {format(new Date(visit.checked_in_at), "MMM d, yyyy h:mm a")}
                                                </TableCell>
                                                <TableCell>
                                                    {duration !== null ? (
                                                        <span>{duration} min</span>
                                                    ) : (
                                                        <Badge variant="outline" className="text-orange-600 border-orange-300">
                                                            Still here
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {visit.outcome ? (
                                                        <Badge className={cn("text-xs", getOutcomeColor(visit.outcome))}>
                                                            {getOutcomeLabel(visit.outcome)}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {visit.checked_in_by_user?.first_name} {visit.checked_in_by_user?.last_name}
                                                </TableCell>
                                                <TableCell>
                                                    <Link href={`/leads/${visit.lead_id}`}>
                                                        <Button variant="ghost" size="icon">
                                                            <ChevronRight className="h-4 w-4" />
                                                        </Button>
                                                    </Link>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </Card>

                    {/* Pagination */}
                    {historyTotal > 20 && (
                        <div className="flex justify-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={historyPage === 1}
                                onClick={() => setHistoryPage(p => p - 1)}
                            >
                                Previous
                            </Button>
                            <span className="flex items-center px-3 text-sm text-muted-foreground">
                                Page {historyPage} of {Math.ceil(historyTotal / 20)}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={historyPage >= Math.ceil(historyTotal / 20)}
                                onClick={() => setHistoryPage(p => p + 1)}
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Check-In Modal */}
            <Dialog open={showCheckInModal} onOpenChange={(open) => {
                setShowCheckInModal(open)
                if (!open) setShowCreateLeadFromCheckIn(false)
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5" />
                            Check In Customer
                        </DialogTitle>
                        <DialogDescription>
                            Search for a lead or walk-in customer to check into the dealership.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {!selectedLead ? (
                            <>
                                <div className="space-y-2">
                                    <Label>Search Customer</Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search by name, phone, or email..."
                                            value={checkInLeadSearch}
                                            onChange={(e) => setCheckInLeadSearch(e.target.value)}
                                            className="pl-10"
                                        />
                                    </div>
                                </div>

                                {/* Search Results */}
                                {searching ? (
                                    <div className="text-center py-4 text-muted-foreground">
                                        Searching...
                                    </div>
                                ) : searchResults.length > 0 ? (
                                    <div className="border rounded-md max-h-64 overflow-y-auto">
                                        {searchResults.map((lead) => (
                                            <button
                                                key={lead.id}
                                                onClick={() => setSelectedLead(lead)}
                                                className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left border-b last:border-b-0"
                                            >
                                                <UserAvatar 
                                                    firstName={lead.first_name}
                                                    lastName={lead.last_name ?? ""}
                                                    size="sm"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate">
                                                        {lead.first_name} {lead.last_name}
                                                    </div>
                                                    <div className="text-sm text-muted-foreground truncate">
                                                        {lead.phone || lead.email}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : checkInLeadSearch.trim().length >= 2 ? (
                                    <div className="text-center py-4 space-y-3">
                                        <p className="text-muted-foreground">No leads found. Try a different search.</p>
                                        {canCreateLead && (
                                            <Button
                                                variant="outline"
                                                className="gap-2"
                                                onClick={() => setShowCreateLeadFromCheckIn(true)}
                                            >
                                                <Plus className="h-4 w-4" />
                                                Add new lead
                                            </Button>
                                        )}
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-4">
                                    <UserAvatar 
                                        firstName={selectedLead.first_name}
                                        lastName={selectedLead.last_name ?? ""}
                                        size="md"
                                    />
                                    <div className="flex-1">
                                        <div className="font-medium">
                                            {selectedLead.first_name} {selectedLead.last_name}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            {selectedLead.phone || selectedLead.email}
                                        </div>
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="sm"
                                        onClick={() => {
                                            setSelectedLead(null)
                                            setCheckInLeadSearch("")
                                        }}
                                    >
                                        Change
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    <Label>Notes (optional)</Label>
                                    <Textarea
                                        placeholder="Any notes about this visit..."
                                        value={checkInNotes}
                                        onChange={(e) => setCheckInNotes(e.target.value)}
                                        rows={3}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setShowCheckInModal(false)
                            setSelectedLead(null)
                            setCheckInLeadSearch("")
                            setCheckInNotes("")
                        }}>
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleCheckIn}
                            disabled={!selectedLead || checkInLoading}
                        >
                            {checkInLoading ? "Checking In..." : "Check In"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Check-in: link to which appointment? (when lead has multiple) */}
            <Dialog open={showCheckInAppointmentModal} onOpenChange={(open) => { if (!open) { setShowCheckInAppointmentModal(false); setLeadAppointmentsForCheckIn([]) } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Store className="h-5 w-5 text-teal-600" />
                            Link check-in to an appointment?
                        </DialogTitle>
                        <DialogDescription>
                            This lead has more than one upcoming appointment. Choose which one they are here for, or check in without linking.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {leadAppointmentsForCheckIn.map((apt) => (
                            <Button
                                key={apt.id}
                                variant="outline"
                                className="w-full justify-start text-left h-auto py-3 px-4"
                                onClick={() => doCheckIn(apt.id)}
                                disabled={checkInLoading}
                            >
                                <CalendarClock className="h-4 w-4 mr-3 shrink-0 text-muted-foreground" />
                                <div className="min-w-0">
                                    <div className="font-medium truncate">{apt.title || "Appointment"}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {formatDateInTimezone(apt.scheduled_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
                                    </div>
                                </div>
                            </Button>
                        ))}
                        <Button
                            variant="ghost"
                            className="w-full justify-start text-muted-foreground"
                            onClick={() => doCheckIn(null)}
                            disabled={checkInLoading}
                        >
                            Check in without linking to an appointment
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Create Lead (from check-in when not found) */}
            <CreateLeadModal
                isOpen={showCreateLeadFromCheckIn}
                onClose={() => setShowCreateLeadFromCheckIn(false)}
                onSuccess={(lead) => {
                    if (lead) {
                        setSelectedLead(lead)
                        setCheckInLeadSearch("")
                    }
                    setShowCreateLeadFromCheckIn(false)
                    loadData()
                }}
            />

            {/* Check-Out Modal */}
            <Dialog open={showCheckOutModal} onOpenChange={setShowCheckOutModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LogOut className="h-5 w-5" />
                            Check Out Customer
                        </DialogTitle>
                        <DialogDescription>
                            Record the outcome of this dealership visit.
                        </DialogDescription>
                    </DialogHeader>

                    {checkOutVisit && (
                        <div className="space-y-4">
                            <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-4">
                                <UserAvatar 
                                    firstName={checkOutVisit.lead?.first_name ?? ""}
                                    lastName={checkOutVisit.lead?.last_name ?? ""}
                                    size="md"
                                />
                                <div className="flex-1">
                                    <div className="font-medium">
                                        {checkOutVisit.lead?.first_name} {checkOutVisit.lead?.last_name}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        Checked in {formatDistanceToNow(new Date(checkOutVisit.checked_in_at))} ago
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Visit Outcome</Label>
                                <Select value={checkOutOutcome} onValueChange={(v) => setCheckOutOutcome(v as ShowroomOutcome)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sold">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                                Sold - Converted to customer
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="follow_up">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-blue-600" />
                                                Follow Up - Needs more time
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="reschedule">
                                            <div className="flex items-center gap-2">
                                                <ArrowUpDown className="h-4 w-4 text-purple-600" />
                                                Reschedule - Coming back later
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="not_interested">
                                            <div className="flex items-center gap-2">
                                                <XCircle className="h-4 w-4 text-gray-600" />
                                                Not Interested
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="browsing">
                                            <div className="flex items-center gap-2">
                                                <Users className="h-4 w-4 text-yellow-600" />
                                                Just Browsing
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="couldnt_qualify">
                                            <div className="flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4 text-amber-600" />
                                                Couldn&apos;t Qualify
                                            </div>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {checkOutOutcome === "reschedule" && checkOutVisit?.appointment_id && (
                                <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                                    <p className="text-sm font-medium">Reschedule linked appointment</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Date</Label>
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className={cn("w-full justify-start text-left font-normal", !checkOutRescheduleDate && "text-muted-foreground")}
                                                    >
                                                        <Calendar className="mr-2 h-4 w-4" />
                                                        {checkOutRescheduleDate ? format(checkOutRescheduleDate, "MMM d, yyyy") : "Pick date"}
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="start">
                                                    <CalendarComponent
                                                        mode="single"
                                                        selected={checkOutRescheduleDate}
                                                        onSelect={setCheckOutRescheduleDate}
                                                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                                    />
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">Time</Label>
                                            <Select
                                                value={checkOutRescheduleTime}
                                                onValueChange={setCheckOutRescheduleTime}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue placeholder="Select time" />
                                                </SelectTrigger>
                                                <SelectContent className="max-h-[220px]">
                                                    {RESCHEDULE_TIME_SLOTS.map((t) => (
                                                        <SelectItem key={t.value} value={t.value}>
                                                            {t.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label>Notes (optional)</Label>
                                <Textarea
                                    placeholder="Any notes about this visit..."
                                    value={checkOutNotes}
                                    onChange={(e) => setCheckOutNotes(e.target.value)}
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowCheckOutModal(false)
                                setCheckOutRescheduleDate(undefined)
                                setCheckOutRescheduleTime("")
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCheckOut}
                            disabled={
                                checkOutLoading ||
                                !!(checkOutOutcome === "reschedule" &&
                                    checkOutVisit?.appointment_id &&
                                    (!checkOutRescheduleDate || !checkOutRescheduleTime))
                            }
                        >
                            {checkOutLoading ? "Checking Out..." : "Check Out"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
