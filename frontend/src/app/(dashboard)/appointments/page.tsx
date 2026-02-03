"use client"

import * as React from "react"
import Link from "next/link"
import { format } from "date-fns"
import { 
    CalendarClock, 
    Plus, 
    Phone, 
    Mail, 
    MapPin, 
    Video, 
    Calendar,
    Clock,
    CheckCircle,
    XCircle,
    AlertCircle,
    AlertTriangle,
    Filter,
    MoreHorizontal,
    MoreVertical,
    User,
    X,
    Loader2,
    Download,
    Printer,
    FileText
} from "lucide-react"
import { 
    AppointmentService, 
    Appointment, 
    AppointmentStats,
    AppointmentStatus,
    AppointmentType,
    getAppointmentTypeLabel,
    getAppointmentStatusLabel,
    getAppointmentStatusColor
} from "@/services/appointment-service"
import { LeadService, Lead } from "@/services/lead-service"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { useAuthStore } from "@/stores/auth-store"
import { UserAvatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Calendar as CalendarPicker } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Stats Card Component
function StatsCard({ 
    title, 
    value, 
    icon: Icon, 
    color = "primary",
    onClick,
    isActive = false
}: { 
    title: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    color?: "primary" | "success" | "warning" | "danger"
    onClick?: () => void
    isActive?: boolean
}) {
    const colorClasses = {
        primary: "bg-blue-100 text-blue-600",
        success: "bg-emerald-100 text-emerald-600",
        warning: "bg-amber-100 text-amber-600",
        danger: "bg-red-100 text-red-600"
    }
    
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-4 p-4 rounded-lg border transition-all ${
                isActive 
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20" 
                    : "border-border bg-card hover:border-primary/50"
            } ${onClick ? "cursor-pointer" : ""}`}
        >
            <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="text-left">
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{title}</p>
            </div>
        </button>
    )
}

// Appointment Type Icon
function AppointmentTypeIcon({ type }: { type: AppointmentType }) {
    const icons: Record<AppointmentType, React.ComponentType<{ className?: string }>> = {
        phone_call: Phone,
        email: Mail,
        in_person: MapPin,
        video_call: Video,
        other: Calendar
    }
    const Icon = icons[type] || Calendar
    return <Icon className="h-4 w-4" />
}

// Generate time slots from 6 AM to 11 PM in 15-minute intervals
const TIME_SLOTS: { value: string; label: string }[] = []
for (let hour = 6; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
        const h = hour.toString().padStart(2, '0')
        const m = minute.toString().padStart(2, '0')
        const value = `${h}:${m}`
        const period = hour >= 12 ? 'PM' : 'AM'
        const displayHour = hour % 12 || 12
        const label = `${displayHour}:${m} ${period}`
        TIME_SLOTS.push({ value, label })
    }
}

// Create Appointment Modal
function CreateAppointmentModal({
    isOpen,
    onClose,
    onSuccess,
    preselectedLead
}: {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    preselectedLead?: Lead
}) {
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [loadingLeads, setLoadingLeads] = React.useState(false)
    const [calendarOpen, setCalendarOpen] = React.useState(false)
    
    const [title, setTitle] = React.useState("")
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(undefined)
    const [selectedTime, setSelectedTime] = React.useState("")
    const [duration, setDuration] = React.useState("30")
    const [location, setLocation] = React.useState("")
    const [notes, setNotes] = React.useState("")
    const [leadId, setLeadId] = React.useState(preselectedLead?.id || "")
    
    // Load leads for selector
    React.useEffect(() => {
        if (isOpen && !preselectedLead) {
            setLoadingLeads(true)
            LeadService.listLeads({ page_size: 100 })
                .then(res => setLeads(res.items))
                .catch(console.error)
                .finally(() => setLoadingLeads(false))
        }
    }, [isOpen, preselectedLead])
    
    // Reset form when modal opens
    React.useEffect(() => {
        if (isOpen) {
            const now = new Date()
            now.setHours(now.getHours() + 1)
            now.setMinutes(0)
            
            setTitle("")
            setSelectedDate(now)
            setSelectedTime(`${now.getHours().toString().padStart(2, '0')}:00`)
            setDuration("30")
            setLocation("")
            setNotes("")
            setLeadId(preselectedLead?.id || "")
            setError(null)
            setCalendarOpen(false)
        }
    }, [isOpen, preselectedLead])
    
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        
        if (!leadId) {
            setError("Please select a lead")
            return
        }
        
        if (!selectedDate || !selectedTime) {
            setError("Date and time are required")
            return
        }
        
        setIsLoading(true)
        
        try {
            const [hours, minutes] = selectedTime.split(':').map(Number)
            const scheduledAt = new Date(selectedDate)
            scheduledAt.setHours(hours, minutes, 0, 0)
            
            await AppointmentService.create({
                title: title.trim() || "Appointment",
                description: notes || undefined,
                appointment_type: "in_person", // Always in person
                scheduled_at: scheduledAt.toISOString(),
                duration_minutes: parseInt(duration),
                location: location || undefined,
                lead_id: leadId
            })
            
            onSuccess()
            onClose()
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to create appointment")
        } finally {
            setIsLoading(false)
        }
    }
    
    if (!isOpen) return null
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={onClose} />
            <div className="relative z-50 w-full max-w-md bg-background rounded-lg shadow-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">Book Appointment</h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                
                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {error && (
                        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                            {error}
                        </div>
                    )}
                    
                    {/* Title */}
                    <div className="space-y-2">
                        <Label htmlFor="title">Title (Optional)</Label>
                        <Input
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g., Meeting with client"
                        />
                    </div>
                    
                    {/* Lead Selector */}
                    <div className="space-y-2">
                        <Label>Lead *</Label>
                        {preselectedLead ? (
                            <div className="bg-muted/50 rounded-lg p-3 text-sm">
                                <span className="font-medium">{preselectedLead.first_name} {preselectedLead.last_name}</span>
                            </div>
                        ) : (
                            <Select 
                                value={leadId} 
                                onValueChange={(v) => setLeadId(v)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a lead" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[200px]">
                                    {leads.map(lead => (
                                        <SelectItem key={lead.id} value={lead.id}>
                                            {lead.first_name} {lead.last_name || ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    
                    {/* Date Picker with Calendar */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            Date *
                        </Label>
                        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !selectedDate && "text-muted-foreground"
                                    )}
                                >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Select a date"}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <CalendarPicker
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(newDate) => {
                                        setSelectedDate(newDate)
                                        setCalendarOpen(false)
                                    }}
                                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    
                    {/* Time and Duration */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Time *
                            </Label>
                            <Select value={selectedTime} onValueChange={setSelectedTime}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select time" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                    {TIME_SLOTS.map((t) => (
                                        <SelectItem key={t.value} value={t.value}>
                                            {t.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Duration</Label>
                            <Select value={duration} onValueChange={setDuration}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="15">15 min</SelectItem>
                                    <SelectItem value="30">30 min</SelectItem>
                                    <SelectItem value="45">45 min</SelectItem>
                                    <SelectItem value="60">1 hour</SelectItem>
                                    <SelectItem value="90">1.5 hours</SelectItem>
                                    <SelectItem value="120">2 hours</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    {/* Location */}
                    <div className="space-y-2">
                        <Label htmlFor="location">Location</Label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="location"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="Enter meeting location"
                                className="pl-10"
                            />
                        </div>
                    </div>
                    
                    {/* Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add any notes about this appointment..."
                            rows={3}
                        />
                    </div>
                    
                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="flex-1"
                            disabled={isLoading}
                        >
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Book Appointment
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// Complete Appointment Modal
function CompleteAppointmentModal({
    isOpen,
    onClose,
    appointment,
    onSuccess
}: {
    isOpen: boolean
    onClose: () => void
    appointment: Appointment | null
    onSuccess: () => void
}) {
    const [isLoading, setIsLoading] = React.useState(false)
    const [outcomeNotes, setOutcomeNotes] = React.useState("")
    const [status, setStatus] = React.useState<AppointmentStatus>("completed")
    
    React.useEffect(() => {
        if (isOpen) {
            setOutcomeNotes("")
            setStatus("completed")
        }
    }, [isOpen])
    
    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!appointment) return
        
        setIsLoading(true)
        try {
            await AppointmentService.complete(appointment.id, {
                outcome_notes: outcomeNotes || undefined,
                status
            })
            onSuccess()
            onClose()
        } catch (err) {
            console.error("Failed to complete appointment:", err)
        } finally {
            setIsLoading(false)
        }
    }
    
    if (!isOpen || !appointment) return null
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={onClose} />
            <div className="relative z-50 w-full max-w-md bg-background rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Complete Appointment</h2>
                <p className="text-muted-foreground mb-4">{appointment.title}</p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Status</label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                            className="w-full px-3 py-2 border rounded-md"
                        >
                            <option value="completed">Completed</option>
                            <option value="no_show">No Show</option>
                            <option value="rescheduled">Rescheduled</option>
                        </select>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium mb-1">Outcome Notes</label>
                        <textarea
                            value={outcomeNotes}
                            onChange={(e) => setOutcomeNotes(e.target.value)}
                            placeholder="What was discussed or accomplished?"
                            rows={4}
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">
                            Cancel
                        </button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
                            {isLoading ? "Saving..." : "Save"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default function AppointmentsPage() {
    const { user } = useAuthStore()
    const { timezone } = useDealershipTimezone()
    
    const [appointments, setAppointments] = React.useState<Appointment[]>([])
    const [stats, setStats] = React.useState<AppointmentStats | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [page, setPage] = React.useState(1)
    const [totalPages, setTotalPages] = React.useState(1)
    
    // Filters
    const [filter, setFilter] = React.useState<"all" | "today" | "upcoming" | "overdue" | "completed">("all")
    const [statusFilter, setStatusFilter] = React.useState<AppointmentStatus | "">("")
    const [dateFrom, setDateFrom] = React.useState<Date | undefined>(undefined)
    const [dateTo, setDateTo] = React.useState<Date | undefined>(undefined)
    const [dateFromOpen, setDateFromOpen] = React.useState(false)
    const [dateToOpen, setDateToOpen] = React.useState(false)
    
    // Modals
    const [showCreateModal, setShowCreateModal] = React.useState(false)
    const [showCompleteModal, setShowCompleteModal] = React.useState(false)
    const [selectedAppointment, setSelectedAppointment] = React.useState<Appointment | null>(null)
    
    // Load data
    const loadData = React.useCallback(async () => {
        setLoading(true)
        try {
            const [appointmentsRes, statsRes] = await Promise.all([
                AppointmentService.list({
                    page,
                    page_size: 20,
                    status: statusFilter || undefined,
                    today_only: filter === "today",
                    upcoming_only: filter === "upcoming",
                    overdue_only: filter === "overdue",
                    date_from: dateFrom?.toISOString(),
                    date_to: dateTo?.toISOString()
                }),
                AppointmentService.getStats()
            ])
            
            // Filter completed locally if needed
            let items = appointmentsRes.items
            if (filter === "completed") {
                items = items.filter(a => a.status === "completed")
            }
            
            setAppointments(items)
            setTotalPages(appointmentsRes.total_pages)
            setStats(statsRes)
        } catch (err) {
            console.error("Failed to load appointments:", err)
        } finally {
            setLoading(false)
        }
    }, [page, filter, statusFilter, dateFrom, dateTo])
    
    React.useEffect(() => {
        loadData()
    }, [loadData])
    
    function handleComplete(appointment: Appointment) {
        setSelectedAppointment(appointment)
        setShowCompleteModal(true)
    }
    
    async function handleCancel(appointment: Appointment) {
        if (!confirm("Are you sure you want to cancel this appointment?")) return
        
        try {
            await AppointmentService.delete(appointment.id)
            loadData()
        } catch (err) {
            console.error("Failed to cancel appointment:", err)
        }
    }
    
    function isOverdue(appointment: Appointment): boolean {
        return new Date(appointment.scheduled_at) < new Date() && 
               ["scheduled", "confirmed"].includes(appointment.status)
    }
    
    // Export appointments to CSV
    function handleExportCSV() {
        if (appointments.length === 0) {
            alert("No appointments to export")
            return
        }
        
        const headers = ["Title", "Date", "Time", "Status", "Type", "Lead", "Assigned To", "Location", "Notes"]
        const rows = appointments.map(apt => [
            apt.title,
            formatDateInTimezone(apt.scheduled_at, timezone, { dateStyle: "medium" }),
            formatDateInTimezone(apt.scheduled_at, timezone, { timeStyle: "short" }),
            getAppointmentStatusLabel(apt.status),
            getAppointmentTypeLabel(apt.appointment_type),
            apt.lead ? `${apt.lead.first_name} ${apt.lead.last_name || ""}`.trim() : "-",
            apt.assigned_to_user ? `${apt.assigned_to_user.first_name} ${apt.assigned_to_user.last_name}` : "-",
            apt.location || "-",
            apt.description || "-"
        ])
        
        const csvContent = [
            headers.join(","),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        ].join("\n")
        
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `appointments_${format(new Date(), "yyyy-MM-dd")}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }
    
    // Print appointments report
    function handlePrint() {
        if (appointments.length === 0) {
            alert("No appointments to print")
            return
        }
        
        const printWindow = window.open("", "_blank")
        if (!printWindow) {
            alert("Please allow popups to print")
            return
        }
        
        const dateRange = dateFrom && dateTo 
            ? `${format(dateFrom, "MMM d, yyyy")} - ${format(dateTo, "MMM d, yyyy")}`
            : dateFrom 
                ? `From ${format(dateFrom, "MMM d, yyyy")}`
                : dateTo 
                    ? `Until ${format(dateTo, "MMM d, yyyy")}`
                    : "All Dates"
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Appointments Report - LeadsCRM</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
                    .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                    th { background: #f5f5f5; font-weight: bold; }
                    tr:nth-child(even) { background: #fafafa; }
                    .status-scheduled { color: #3b82f6; }
                    .status-confirmed { color: #10b981; }
                    .status-completed { color: #059669; }
                    .status-cancelled { color: #ef4444; }
                    .footer { margin-top: 30px; font-size: 12px; color: #999; text-align: center; }
                    @media print {
                        body { padding: 0; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <h1>Appointments Report</h1>
                <div class="meta">
                    <p><strong>Date Range:</strong> ${dateRange}</p>
                    <p><strong>Filter:</strong> ${filter === "all" ? "All Appointments" : filter.charAt(0).toUpperCase() + filter.slice(1)}</p>
                    <p><strong>Generated:</strong> ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}</p>
                    <p><strong>Total:</strong> ${appointments.length} appointment(s)</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Date & Time</th>
                            <th>Title</th>
                            <th>Lead</th>
                            <th>Assigned To</th>
                            <th>Status</th>
                            <th>Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${appointments.map(apt => `
                            <tr>
                                <td>${formatDateInTimezone(apt.scheduled_at, timezone, { dateStyle: "medium", timeStyle: "short" })}</td>
                                <td>${apt.title}</td>
                                <td>${apt.lead ? `${apt.lead.first_name} ${apt.lead.last_name || ""}`.trim() : "-"}</td>
                                <td>${apt.assigned_to_user ? `${apt.assigned_to_user.first_name} ${apt.assigned_to_user.last_name}` : "-"}</td>
                                <td class="status-${apt.status}">${getAppointmentStatusLabel(apt.status)}</td>
                                <td>${apt.location || "-"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                <div class="footer">
                    <p>LeadsCRM - Appointments Report</p>
                </div>
                <script>window.onload = function() { window.print(); }</script>
            </body>
            </html>
        `)
        printWindow.document.close()
    }
    
    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Appointments</h1>
                    <p className="text-muted-foreground">Schedule and manage your appointments</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportCSV}
                        disabled={appointments.length === 0}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrint}
                        disabled={appointments.length === 0}
                    >
                        <Printer className="h-4 w-4 mr-2" />
                        Print Report
                    </Button>
                    <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        New Appointment
                    </Button>
                </div>
            </div>
            
            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <StatsCard
                        title="Today"
                        value={stats.today}
                        icon={Calendar}
                        color="primary"
                        onClick={() => setFilter("today")}
                        isActive={filter === "today"}
                    />
                    <StatsCard
                        title="Upcoming"
                        value={stats.upcoming}
                        icon={CalendarClock}
                        color="primary"
                        onClick={() => setFilter("upcoming")}
                        isActive={filter === "upcoming"}
                    />
                    <StatsCard
                        title="Overdue"
                        value={stats.overdue}
                        icon={AlertTriangle}
                        color="danger"
                        onClick={() => setFilter("overdue")}
                        isActive={filter === "overdue"}
                    />
                    <StatsCard
                        title="Completed (Week)"
                        value={stats.completed_this_week}
                        icon={CheckCircle}
                        color="success"
                        onClick={() => setFilter("completed")}
                        isActive={filter === "completed"}
                    />
                    <StatsCard
                        title="Cancelled (Week)"
                        value={stats.cancelled_this_week}
                        icon={XCircle}
                        color="warning"
                    />
                    <StatsCard
                        title="Total Scheduled"
                        value={stats.total_scheduled}
                        icon={Clock}
                        color="primary"
                        onClick={() => setFilter("all")}
                        isActive={filter === "all"}
                    />
                </div>
            )}
            
            {/* Filters */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Filter:</span>
                </div>
                <Select value={filter} onValueChange={(v) => { setFilter(v as any); setPage(1) }}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={statusFilter || "all_statuses"} onValueChange={(v) => { setStatusFilter(v === "all_statuses" ? "" : v as any); setPage(1) }}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all_statuses">All Statuses</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="no_show">No Show</SelectItem>
                    </SelectContent>
                </Select>
                
                {/* Date Range Filter */}
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">From:</span>
                    <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                    "w-[140px] justify-start text-left font-normal",
                                    !dateFrom && "text-muted-foreground"
                                )}
                            >
                                <Calendar className="mr-2 h-4 w-4" />
                                {dateFrom ? format(dateFrom, "MMM d, yyyy") : "Start date"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <CalendarPicker
                                mode="single"
                                selected={dateFrom}
                                onSelect={(d) => { setDateFrom(d); setDateFromOpen(false); setPage(1) }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">To:</span>
                    <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                    "w-[140px] justify-start text-left font-normal",
                                    !dateTo && "text-muted-foreground"
                                )}
                            >
                                <Calendar className="mr-2 h-4 w-4" />
                                {dateTo ? format(dateTo, "MMM d, yyyy") : "End date"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <CalendarPicker
                                mode="single"
                                selected={dateTo}
                                onSelect={(d) => { setDateTo(d); setDateToOpen(false); setPage(1) }}
                                disabled={(date) => dateFrom ? date < dateFrom : false}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                
                {/* Clear Filters */}
                {(dateFrom || dateTo || filter !== "all" || statusFilter) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setDateFrom(undefined)
                            setDateTo(undefined)
                            setFilter("all")
                            setStatusFilter("")
                            setPage(1)
                        }}
                    >
                        <X className="h-4 w-4 mr-1" />
                        Clear
                    </Button>
                )}
            </div>
            
            {/* Appointments List */}
            <div className="border rounded-lg overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-muted-foreground">
                        Loading appointments...
                    </div>
                ) : appointments.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        <CalendarClock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No appointments found</p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="mt-4 text-primary hover:underline"
                        >
                            Schedule your first appointment
                        </button>
                    </div>
                ) : (
                    <div className="divide-y">
                        {appointments.map((appointment) => (
                            <div 
                                key={appointment.id} 
                                className={`p-4 flex items-start gap-4 ${
                                    isOverdue(appointment) ? "bg-red-50" : ""
                                }`}
                            >
                                {/* Status Icon */}
                                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                                    appointment.status === "completed" 
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : appointment.status === "cancelled"
                                        ? "bg-gray-100 dark:bg-gray-900/30"
                                        : isOverdue(appointment)
                                        ? "bg-red-100 dark:bg-red-900/30"
                                        : "bg-blue-100 dark:bg-blue-900/30"
                                }`}>
                                    {appointment.status === "completed" ? (
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    ) : appointment.status === "cancelled" ? (
                                        <XCircle className="h-5 w-5 text-gray-600" />
                                    ) : isOverdue(appointment) ? (
                                        <AlertCircle className="h-5 w-5 text-red-600" />
                                    ) : (
                                        <CalendarClock className="h-5 w-5 text-blue-600" />
                                    )}
                                </div>
                                
                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                {appointment.lead ? (
                                                    <Link 
                                                        href={`/leads/${appointment.lead_id}`} 
                                                        className="font-medium hover:underline text-left"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {appointment.lead.first_name} {appointment.lead.last_name}
                                                    </Link>
                                                ) : (
                                                    <span className="font-medium">{appointment.title || "Appointment"}</span>
                                                )}
                                                <Badge variant={
                                                    appointment.status === "completed" ? "default" :
                                                    appointment.status === "cancelled" ? "secondary" :
                                                    appointment.status === "confirmed" ? "default" :
                                                    "outline"
                                                } className={
                                                    appointment.status === "completed" ? "bg-green-100 text-green-800 dark:bg-green-900/30" :
                                                    appointment.status === "cancelled" ? "bg-gray-100 text-gray-800" :
                                                    appointment.status === "confirmed" ? "bg-blue-100 text-blue-800" :
                                                    ""
                                                }>
                                                    {getAppointmentStatusLabel(appointment.status)}
                                                </Badge>
                                                {isOverdue(appointment) && (
                                                    <Badge variant="destructive" className="text-xs">
                                                        Overdue
                                                    </Badge>
                                                )}
                                            </div>
                                            
                                            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-4 w-4" />
                                                    <span>
                                                        {formatDateInTimezone(appointment.scheduled_at, timezone, {
                                                            dateStyle: "medium",
                                                            timeStyle: "short"
                                                        })}
                                                    </span>
                                                </div>
                                                {appointment.assigned_to_user && (
                                                    <div className="flex items-center gap-1">
                                                        <User className="h-4 w-4" />
                                                        <span>
                                                            {appointment.assigned_to_user.first_name} {appointment.assigned_to_user.last_name}
                                                        </span>
                                                    </div>
                                                )}
                                                {appointment.lead?.phone && (
                                                    <div className="flex items-center gap-1">
                                                        <Phone className="h-4 w-4" />
                                                        <span>{appointment.lead.phone}</span>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {appointment.title && appointment.lead && (
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {appointment.title}
                                                </p>
                                            )}
                                            
                                            {appointment.description && (
                                                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                                    {appointment.description}
                                                </p>
                                            )}
                                            
                                            {appointment.location && (
                                                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                                                    <MapPin className="h-4 w-4" />
                                                    {appointment.location}
                                                </p>
                                            )}
                                        </div>
                                        
                                        {/* Actions Dropdown */}
                                        {["scheduled", "confirmed"].includes(appointment.status) && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleComplete(appointment)}>
                                                        <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                                                        Mark as Completed
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleCancel(appointment)} className="text-red-600">
                                                        <XCircle className="mr-2 h-4 w-4" />
                                                        Cancel Appointment
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-sm border rounded-md disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1 text-sm border rounded-md disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            )}
            
            {/* Modals */}
            <CreateAppointmentModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSuccess={loadData}
            />
            <CompleteAppointmentModal
                isOpen={showCompleteModal}
                onClose={() => setShowCompleteModal(false)}
                appointment={selectedAppointment}
                onSuccess={loadData}
            />
        </div>
    )
}
