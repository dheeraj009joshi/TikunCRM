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
    Users,
    X,
    Store,
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
    getAppointmentStatusColor,
    isAppointmentStatusTerminal
} from "@/services/appointment-service"
import { LeadService, Lead, getLeadFullName } from "@/services/lead-service"
import { TeamService, UserBrief } from "@/services/team-service"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { useAuthStore } from "@/stores/auth-store"
import { useRole } from "@/hooks/use-role"
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
import { Badge, getRoleVariant } from "@/components/ui/badge"
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
    const user = useAuthStore((s) => s.user)
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const isAdmin = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [loadingLeads, setLoadingLeads] = React.useState(false)
    const [calendarOpen, setCalendarOpen] = React.useState(false)
    const [teamMembers, setTeamMembers] = React.useState<UserBrief[]>([])
    const [assignedTo, setAssignedTo] = React.useState<string>("auto")
    const [loadingTeam, setLoadingTeam] = React.useState(false)
    const [leadAssignedToUser, setLeadAssignedToUser] = React.useState<UserBrief | null>(null)
    
    const [title, setTitle] = React.useState("")
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(undefined)
    const [selectedTime, setSelectedTime] = React.useState("")
    const [duration, setDuration] = React.useState("30")
    const [location, setLocation] = React.useState("")
    const [notes, setNotes] = React.useState("")
    const [leadId, setLeadId] = React.useState(preselectedLead?.id || "")
    
    // Load leads for selector: salesperson sees only their leads + unassigned; admin sees all
    React.useEffect(() => {
        if (isOpen && !preselectedLead) {
            setLoadingLeads(true)
            if (isAdmin) {
                LeadService.listLeads({ page_size: 100 })
                    .then(res => setLeads(res.items))
                    .catch(console.error)
                    .finally(() => setLoadingLeads(false))
            } else {
                Promise.all([
                    LeadService.listLeads({ pool: "mine", page_size: 100 }),
                    LeadService.listUnassignedToSalesperson({ page_size: 100 }),
                ])
                    .then(([mineRes, unassignedRes]) => {
                        const byId = new Map<string, Lead>()
                        mineRes.items.forEach((l) => byId.set(l.id, l))
                        unassignedRes.items.forEach((l) => byId.set(l.id, l))
                        setLeads(Array.from(byId.values()))
                    })
                    .catch(console.error)
                    .finally(() => setLoadingLeads(false))
            }
        }
    }, [isOpen, preselectedLead, isAdmin])
    
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
            setAssignedTo("auto")
            setLeadAssignedToUser(null)
        }
    }, [isOpen, preselectedLead])

    // When lead is selected, load team and default assignment
    React.useEffect(() => {
        if (!isOpen) return
        const effectiveLeadId = leadId || preselectedLead?.id
        if (!effectiveLeadId) {
            setTeamMembers([])
            setAssignedTo("auto")
            setLeadAssignedToUser(null)
            return
        }
        setLoadingTeam(true)
        setLeadAssignedToUser(null)
        LeadService.getLead(effectiveLeadId)
            .then(async (lead) => {
                if (lead.assigned_to && lead.assigned_to_user) {
                    setLeadAssignedToUser(lead.assigned_to_user as UserBrief)
                    setAssignedTo(lead.assigned_to)
                } else {
                    setLeadAssignedToUser(null)
                }
                const dealershipId = lead.dealership_id || user?.dealership_id
                if (dealershipId) {
                    const members = await TeamService.getSalespersons(dealershipId)
                    setTeamMembers(members)
                    if (!lead.assigned_to) {
                        setAssignedTo(user?.id || "auto")
                    }
                } else {
                    setTeamMembers([])
                    if (!lead.assigned_to) {
                        setAssignedTo(user?.id || "auto")
                    }
                }
            })
            .catch(() => {
                setTeamMembers([])
                setAssignedTo(user?.id || "auto")
                setLeadAssignedToUser(null)
            })
            .finally(() => setLoadingTeam(false))
    }, [isOpen, leadId, preselectedLead?.id, user?.dealership_id, user?.id])
    
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
                lead_id: leadId,
                assigned_to: isAdmin ? (assignedTo !== "auto" ? assignedTo : undefined) : undefined,
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
                                <span className="font-medium">{preselectedLead.customer?.first_name || ""} {preselectedLead.customer?.last_name || ""}</span>
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
                                            {getLeadFullName(lead)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Assign to (admin can select; non-admin is always self) */}
                    {(leadId || preselectedLead) && (
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                Assign to
                            </Label>
                            {!isAdmin ? (
                                <div className="rounded-lg border bg-muted/30 p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{user?.first_name} {user?.last_name}</span>
                                        <Badge variant="outline" size="sm">You</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        This appointment will be assigned to you.
                                    </p>
                                </div>
                            ) : loadingTeam ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading team…
                                </div>
                            ) : leadAssignedToUser ? (
                                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{leadAssignedToUser.first_name} {leadAssignedToUser.last_name}</span>
                                        <Badge variant={getRoleVariant(leadAssignedToUser.role)} size="sm">
                                            {leadAssignedToUser.role === "dealership_owner" ? "Owner" :
                                             leadAssignedToUser.role === "dealership_admin" ? "Admin" :
                                             leadAssignedToUser.role === "salesperson" ? "Sales" : leadAssignedToUser.role}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Lead is already assigned. To change assignment, use &quot;Assign to Team Member&quot; on the lead details page.
                                    </p>
                                </div>
                            ) : (
                                <Select value={assignedTo} onValueChange={setAssignedTo}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Auto (lead's primary or you)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">
                                            <span className="text-muted-foreground">Auto (lead's primary or me)</span>
                                        </SelectItem>
                                        {teamMembers.map((person) => (
                                            <SelectItem key={person.id} value={person.id}>
                                                <div className="flex items-center gap-2">
                                                    <span>{person.first_name} {person.last_name}</span>
                                                    <Badge variant={getRoleVariant(person.role)} size="sm">
                                                        {person.role === "dealership_owner" ? "Owner" :
                                                         person.role === "dealership_admin" ? "Admin" :
                                                         person.role === "salesperson" ? "Sales" : person.role}
                                                    </Badge>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    )}
                    
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

// Reschedule Appointment Modal – same appointment, new date/time
function RescheduleAppointmentModal({
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
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(undefined)
    const [selectedTime, setSelectedTime] = React.useState("")
    const [calendarOpen, setCalendarOpen] = React.useState(false)

    React.useEffect(() => {
        if (isOpen && appointment) {
            const d = new Date(appointment.scheduled_at)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            setSelectedDate(d < today ? today : d)
            const h = d.getHours()
            const m = d.getMinutes()
            const roundedM = Math.round(m / 15) * 15
            const minute = roundedM === 60 ? 0 : roundedM
            const hour = roundedM === 60 ? h + 1 : h
            const value = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
            const slot = TIME_SLOTS.find(s => s.value === value)
            setSelectedTime(slot ? slot.value : TIME_SLOTS[0]?.value ?? "09:00")
            setCalendarOpen(false)
        }
    }, [isOpen, appointment])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!appointment || !selectedDate || !selectedTime) return
        const [hours, minutes] = selectedTime.split(":").map(Number)
        const scheduledAt = new Date(selectedDate)
        scheduledAt.setHours(hours, minutes, 0, 0)
        setIsLoading(true)
        try {
            await AppointmentService.update(appointment.id, {
                scheduled_at: scheduledAt.toISOString(),
                status: "scheduled"
            })
            onSuccess()
            onClose()
        } catch (err) {
            console.error("Failed to reschedule appointment:", err)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen || !appointment) return null

    const minDate = new Date()
    minDate.setHours(0, 0, 0, 0)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" onClick={onClose} />
            <div className="relative z-50 w-full max-w-md bg-background rounded-lg shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-1">Reschedule appointment</h2>
                <p className="text-muted-foreground mb-4">{appointment.title}</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Date</Label>
                        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !selectedDate && "text-muted-foreground"
                                    )}
                                >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Select date"}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <CalendarPicker
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(d) => {
                                        setSelectedDate(d)
                                        setCalendarOpen(false)
                                    }}
                                    disabled={(date) => date < minDate}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Time
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
                    <div className="flex justify-end gap-3 pt-4">
                        <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading || !selectedDate || !selectedTime}>
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default function AppointmentsPage() {
    const { user } = useAuthStore()
    const { timezone } = useBrowserTimezone()
    
    const [appointments, setAppointments] = React.useState<Appointment[]>([])
    const [stats, setStats] = React.useState<AppointmentStats | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [page, setPage] = React.useState(1)
    const [totalPages, setTotalPages] = React.useState(1)
    
    // Filters
    const [filter, setFilter] = React.useState<"all" | "today" | "upcoming" | "overdue" | "completed">("all")
    const [statusFilter, setStatusFilter] = React.useState<AppointmentStatus | "">("")
    const [dateMode, setDateMode] = React.useState<"range" | "specific">("range")
    const [dateFrom, setDateFrom] = React.useState<Date | undefined>(undefined)
    const [dateTo, setDateTo] = React.useState<Date | undefined>(undefined)
    const [specificDate, setSpecificDate] = React.useState<Date | undefined>(undefined)
    const [dateFromOpen, setDateFromOpen] = React.useState(false)
    const [dateToOpen, setDateToOpen] = React.useState(false)
    const [specificDateOpen, setSpecificDateOpen] = React.useState(false)
    
    // Modals
    const [showCreateModal, setShowCreateModal] = React.useState(false)
    const [showCompleteModal, setShowCompleteModal] = React.useState(false)
    const [showRescheduleModal, setShowRescheduleModal] = React.useState(false)
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
                    date_from: dateMode === "specific" && specificDate 
                        ? new Date(specificDate.setHours(0, 0, 0, 0)).toISOString()
                        : dateFrom?.toISOString(),
                    date_to: dateMode === "specific" && specificDate 
                        ? new Date(specificDate.setHours(23, 59, 59, 999)).toISOString()
                        : dateTo?.toISOString()
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
    }, [page, filter, statusFilter, dateFrom, dateTo, dateMode, specificDate])
    
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

    async function handleConfirm(appointment: Appointment) {
        try {
            await AppointmentService.update(appointment.id, { status: "confirmed" })
            loadData()
        } catch (err) {
            console.error("Failed to confirm appointment:", err)
        }
    }

    function handleReschedule(appointment: Appointment) {
        setSelectedAppointment(appointment)
        setShowRescheduleModal(true)
    }

    async function handleStatusUpdate(appointment: Appointment, status: AppointmentStatus) {
        try {
            await AppointmentService.update(appointment.id, { status })
            loadData()
        } catch (err) {
            console.error("Failed to update status:", err)
        }
    }

    async function handleNoShow(appointment: Appointment) {
        try {
            await AppointmentService.complete(appointment.id, { status: "no_show" })
            loadData()
        } catch (err) {
            console.error("Failed to mark no show:", err)
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
            apt.lead ? (apt.lead.customer?.full_name || `${apt.lead.customer?.first_name || ""} ${apt.lead.customer?.last_name || ""}`.trim() || "Unknown") : "-",
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
                <title>Appointments Report - TikunCRM</title>
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
                                <td>${apt.lead ? (apt.lead.customer?.full_name || `${apt.lead.customer?.first_name || ""} ${apt.lead.customer?.last_name || ""}`.trim() || "Unknown") : "-"}</td>
                                <td>${apt.assigned_to_user ? `${apt.assigned_to_user.first_name} ${apt.assigned_to_user.last_name}` : "-"}</td>
                                <td class="status-${apt.status}">${getAppointmentStatusLabel(apt.status)}</td>
                                <td>${apt.location || "-"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
                <div class="footer">
                    <p>TikunCRM - Appointments Report</p>
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
                        <SelectItem value="arrived">Arrived</SelectItem>
                        <SelectItem value="in_showroom">In Showroom</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="sold">Sold</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                        <SelectItem value="no_show">No Show</SelectItem>
                        <SelectItem value="rescheduled">Rescheduled</SelectItem>
                    </SelectContent>
                </Select>
                
                {/* Date Filter Mode Toggle */}
                <div className="flex items-center gap-1 border rounded-md p-0.5">
                    <Button
                        variant={dateMode === "range" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => { 
                            setDateMode("range"); 
                            setSpecificDate(undefined); 
                            setPage(1);
                        }}
                    >
                        Range
                    </Button>
                    <Button
                        variant={dateMode === "specific" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => { 
                            setDateMode("specific"); 
                            setDateFrom(undefined);
                            setDateTo(undefined);
                            setPage(1);
                        }}
                    >
                        Specific Day
                    </Button>
                </div>
                
                {/* Date Range Filter (when dateMode is "range") */}
                {dateMode === "range" && (
                    <>
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
                    </>
                )}
                
                {/* Specific Date Filter (when dateMode is "specific") */}
                {dateMode === "specific" && (
                    <Popover open={specificDateOpen} onOpenChange={setSpecificDateOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                    "w-[180px] justify-start text-left font-normal",
                                    !specificDate && "text-muted-foreground"
                                )}
                            >
                                <Calendar className="mr-2 h-4 w-4" />
                                {specificDate ? format(specificDate, "EEEE, MMM d, yyyy") : "Select date"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <CalendarPicker
                                mode="single"
                                selected={specificDate}
                                onSelect={(d) => { setSpecificDate(d); setSpecificDateOpen(false); setPage(1) }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                )}
                
                {/* Clear Filters */}
                {(dateFrom || dateTo || specificDate || filter !== "all" || statusFilter) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setDateFrom(undefined)
                            setSpecificDate(undefined)
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
                                    appointment.status === "completed" || appointment.status === "sold"
                                        ? "bg-green-100 dark:bg-green-900/30"
                                        : appointment.status === "cancelled"
                                        ? "bg-gray-100 dark:bg-gray-900/30"
                                        : appointment.status === "arrived" || appointment.status === "in_showroom"
                                        ? "bg-orange-100 dark:bg-orange-900/30"
                                        : isOverdue(appointment)
                                        ? "bg-red-100 dark:bg-red-900/30"
                                        : "bg-blue-100 dark:bg-blue-900/30"
                                }`}>
                                    {appointment.status === "completed" || appointment.status === "sold" ? (
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    ) : appointment.status === "cancelled" ? (
                                        <XCircle className="h-5 w-5 text-gray-600" />
                                    ) : appointment.status === "arrived" || appointment.status === "in_showroom" ? (
                                        <Users className="h-5 w-5 text-orange-600" />
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
                                                        {appointment.lead.customer?.full_name || `${appointment.lead.customer?.first_name || ""} ${appointment.lead.customer?.last_name || ""}`.trim() || "Unknown"}
                                                    </Link>
                                                ) : (
                                                    <span className="font-medium">{appointment.title || "Appointment"}</span>
                                                )}
                                                <Badge variant={
                                                    appointment.status === "completed" || appointment.status === "sold" ? "default" :
                                                    appointment.status === "cancelled" ? "secondary" :
                                                    appointment.status === "confirmed" ? "default" :
                                                    appointment.status === "arrived" || appointment.status === "in_showroom" ? "default" :
                                                    "outline"
                                                } className={
                                                    appointment.status === "completed" ? "bg-green-100 text-green-800 dark:bg-green-900/30" :
                                                    appointment.status === "sold" ? "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/30" :
                                                    appointment.status === "cancelled" ? "bg-gray-100 text-gray-800" :
                                                    appointment.status === "confirmed" ? "bg-blue-100 text-blue-800" :
                                                    appointment.status === "arrived" ? "bg-cyan-100 text-cyan-800" :
                                                    appointment.status === "in_showroom" ? "bg-orange-100 text-orange-800" :
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
                                                {appointment.lead?.customer?.phone && (
                                                    <div className="flex items-center gap-1">
                                                        <Phone className="h-4 w-4" />
                                                        <span>{appointment.lead.customer.phone}</span>
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
                                        
                                        {/* Actions Dropdown - show for all non-terminal statuses */}
                                        {!isAppointmentStatusTerminal(appointment.status) && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {appointment.status === "scheduled" && (
                                                        <DropdownMenuItem onClick={() => handleConfirm(appointment)}>
                                                            <CheckCircle className="mr-2 h-4 w-4 text-blue-600" />
                                                            Confirm
                                                        </DropdownMenuItem>
                                                    )}
                                                    {(appointment.status === "scheduled" || appointment.status === "confirmed" || appointment.status === "arrived" || appointment.status === "in_showroom" || appointment.status === "in_progress" || appointment.status === "no_show") && (
                                                        <DropdownMenuItem onClick={() => handleReschedule(appointment)}>
                                                            <CalendarClock className="mr-2 h-4 w-4" />
                                                            Reschedule
                                                        </DropdownMenuItem>
                                                    )}
                                                    {appointment.status === "arrived" && (
                                                        <DropdownMenuItem onClick={() => handleStatusUpdate(appointment, "in_showroom")}>
                                                            <Store className="mr-2 h-4 w-4" />
                                                            Mark as In Showroom
                                                        </DropdownMenuItem>
                                                    )}
                                                    {(appointment.status === "arrived" || appointment.status === "in_showroom") && (
                                                        <DropdownMenuItem onClick={() => handleStatusUpdate(appointment, "in_progress")}>
                                                            <Clock className="mr-2 h-4 w-4" />
                                                            Mark as In Progress
                                                        </DropdownMenuItem>
                                                    )}
                                                    {(appointment.status === "scheduled" || appointment.status === "confirmed" || appointment.status === "arrived" || appointment.status === "in_showroom" || appointment.status === "in_progress" || appointment.status === "no_show") && (
                                                        <DropdownMenuItem onClick={() => handleComplete(appointment)}>
                                                            <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                                                            Mark as Completed
                                                        </DropdownMenuItem>
                                                    )}
                                                    {(appointment.status === "scheduled" || appointment.status === "confirmed" || appointment.status === "arrived" || appointment.status === "in_showroom" || appointment.status === "in_progress") && (
                                                        <DropdownMenuItem onClick={() => handleNoShow(appointment)}>
                                                            <XCircle className="mr-2 h-4 w-4 text-amber-600" />
                                                            No Show
                                                        </DropdownMenuItem>
                                                    )}
                                                    {(appointment.status === "scheduled" || appointment.status === "confirmed" || appointment.status === "arrived" || appointment.status === "in_showroom" || appointment.status === "in_progress" || appointment.status === "no_show") && (
                                                        <DropdownMenuItem onClick={() => handleCancel(appointment)} className="text-red-600">
                                                            <XCircle className="mr-2 h-4 w-4" />
                                                            Cancel Appointment
                                                        </DropdownMenuItem>
                                                    )}
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
            <RescheduleAppointmentModal
                isOpen={showRescheduleModal}
                onClose={() => { setShowRescheduleModal(false); setSelectedAppointment(null) }}
                appointment={selectedAppointment}
                onSuccess={loadData}
            />
        </div>
    )
}
