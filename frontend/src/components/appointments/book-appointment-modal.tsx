"use client"

import * as React from "react"
import { format } from "date-fns"
import { X, Loader2, CalendarClock, MapPin, Calendar as CalendarIcon, Clock, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { AppointmentService } from "@/services/appointment-service"
import { LeadService } from "@/services/lead-service"
import { TeamService, UserBrief } from "@/services/team-service"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"
import { useRole } from "@/hooks/use-role"
import { cn } from "@/lib/utils"

interface BookAppointmentModalProps {
    isOpen: boolean
    onClose: () => void
    leadId: string
    leadName?: string
    onSuccess?: () => void
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

export function BookAppointmentModal({ 
    isOpen, 
    onClose, 
    leadId,
    leadName,
    onSuccess 
}: BookAppointmentModalProps) {
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const isAdmin = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [calendarOpen, setCalendarOpen] = React.useState(false)
    
    const [title, setTitle] = React.useState("")
    const [date, setDate] = React.useState<Date | undefined>(undefined)
    const [time, setTime] = React.useState("")
    const [duration, setDuration] = React.useState("30")
    const [location, setLocation] = React.useState("")
    const [notes, setNotes] = React.useState("")
    
    // Salesperson assignment (for admins): primary = who handles this appointment; secondary is on the lead
    const [teamMembers, setTeamMembers] = React.useState<UserBrief[]>([])
    const [assignedTo, setAssignedTo] = React.useState<string>("auto")
    const [loadingTeam, setLoadingTeam] = React.useState(false)
    const [leadPrimaryName, setLeadPrimaryName] = React.useState<string | null>(null)
    const [leadSecondaryName, setLeadSecondaryName] = React.useState<string | null>(null)

    // Reset form when modal opens
    React.useEffect(() => {
        if (isOpen) {
            const now = new Date()
            // Round to next hour
            now.setHours(now.getHours() + 1)
            now.setMinutes(0)
            
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:00`
            const name = leadName || "Lead"
            
            setTitle(`Meeting with ${name}`)
            setDate(now)
            setTime(timeStr)
            setDuration("30")
            setLocation("")
            setNotes("")
            setError(null)
            setCalendarOpen(false)
            setAssignedTo("auto")
            setLeadPrimaryName(null)
            setLeadSecondaryName(null)
            
            // If admin, fetch lead to get dealership, team, and primary/secondary for display
            if (isAdmin && leadId) {
                setLoadingTeam(true)
                LeadService.getLead(leadId)
                    .then(async (lead) => {
                        if (lead.assigned_to_user) {
                            setLeadPrimaryName(`${lead.assigned_to_user.first_name} ${lead.assigned_to_user.last_name}`.trim())
                        }
                        if (lead.secondary_salesperson) {
                            setLeadSecondaryName(`${lead.secondary_salesperson.first_name} ${lead.secondary_salesperson.last_name}`.trim())
                        }
                        if (lead.dealership_id) {
                            const members = await TeamService.getSalespersons(lead.dealership_id)
                            setTeamMembers(members)
                            if (lead.assigned_to) {
                                setAssignedTo(lead.assigned_to)
                            }
                        }
                    })
                    .catch(console.error)
                    .finally(() => setLoadingTeam(false))
            }
        }
    }, [isOpen, leadName, leadId, isAdmin])

    const handleSubmit = async (e?: React.FormEvent, confirmSkate?: boolean) => {
        if (e) e.preventDefault()
        setError(null)
        
        if (!date || !time) {
            setError("Date and time are required")
            return
        }

        setIsLoading(true)

        try {
            // Combine date and time
            const [hours, minutes] = time.split(':').map(Number)
            const scheduledAt = new Date(date)
            scheduledAt.setHours(hours, minutes, 0, 0)
            
            const result = await AppointmentService.create({
                lead_id: leadId,
                title: title.trim() || "Appointment",
                description: notes || undefined,
                appointment_type: "in_person", // Always in person
                scheduled_at: scheduledAt.toISOString(),
                duration_minutes: parseInt(duration),
                location: location || undefined,
                assigned_to: assignedTo !== "auto" ? assignedTo : undefined,
                confirmSkate,
            })

            // Check if this is a skate warning response
            if (isSkateWarningResponse(result)) {
                useSkateConfirmStore.getState().show(
                    result as SkateWarningInfo,
                    () => handleSubmit(undefined, true) // Retry with confirmation
                )
            } else {
                onSuccess?.()
                onClose()
            }
        } catch (err: any) {
            const skate = getSkateAttemptDetail(err)
            if (skate) {
                useSkateAlertStore.getState().show(skate)
                onClose()
            } else {
                const detail = err.response?.data?.detail
                setError(typeof detail === "string" ? detail : detail?.message || "Failed to book appointment")
            }
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />
            
            {/* Modal */}
            <div className="relative bg-background rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
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

                    {/* Lead Info */}
                    {leadName && (
                        <div className="bg-muted/50 rounded-lg p-3 text-sm">
                            <span className="text-muted-foreground">Scheduling for:</span>{" "}
                            <span className="font-medium">{leadName}</span>
                        </div>
                    )}

                    {/* Primary / Secondary assignment (Admin only) */}
                    {isAdmin && (
                        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                            <Label className="flex items-center gap-2 text-sm font-medium">
                                <Users className="h-4 w-4" />
                                Assignment (primary & secondary)
                            </Label>
                            {(leadPrimaryName || leadSecondaryName) && (
                                <div className="text-xs text-muted-foreground space-y-1">
                                    {leadPrimaryName && <div><span className="font-medium">Lead primary:</span> {leadPrimaryName}</div>}
                                    {leadSecondaryName && <div><span className="font-medium">Lead secondary:</span> {leadSecondaryName}</div>}
                                    <p className="text-muted-foreground">Primary and secondary cannot be changed from here. Use &quot;Assign to Team Member&quot; on the lead details to change them.</p>
                                </div>
                            )}
                            {loadingTeam ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading team…
                                </div>
                            ) : teamMembers.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    Assign this lead to a dealership (and optionally to a team member) to choose who handles this appointment.
                                </p>
                            ) : (leadPrimaryName || leadSecondaryName) ? (
                                <p className="text-xs text-muted-foreground">
                                    This appointment will be handled by the lead&apos;s primary. To change who handles the lead, use &quot;Assign to Team Member&quot; on the lead details.
                                </p>
                            ) : (
                                <>
                                    <Label className="text-xs">Primary (who handles this appointment)</Label>
                                    <Select value={assignedTo} onValueChange={setAssignedTo}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Auto (lead's salesperson or you)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="auto">
                                                <span className="text-muted-foreground">Auto (lead's primary)</span>
                                            </SelectItem>
                                            {teamMembers.map((person) => (
                                                <SelectItem key={person.id} value={person.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span>{person.first_name} {person.last_name}</span>
                                                        <Badge variant={getRoleVariant(person.role)} size="sm">
                                                            {person.role === 'dealership_owner' ? 'Owner' : 
                                                             person.role === 'dealership_admin' ? 'Admin' : 
                                                             person.role === 'salesperson' ? 'Sales' : person.role}
                                                        </Badge>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        Secondary salesperson is set on the lead via &quot;Assign to Team Member&quot;.
                                    </p>
                                </>
                            )}
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

                    {/* Date Picker with Calendar */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4" />
                            Date *
                        </Label>
                        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !date && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? format(date, "EEEE, MMMM d, yyyy") : "Select a date"}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={date}
                                    onSelect={(newDate) => {
                                        setDate(newDate)
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
                            <Select value={time} onValueChange={setTime}>
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
