"use client"

import * as React from "react"
import { format } from "date-fns"
import { X, Loader2, CalendarClock, MapPin, Calendar as CalendarIcon, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { AppointmentService } from "@/services/appointment-service"
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
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [calendarOpen, setCalendarOpen] = React.useState(false)
    
    const [title, setTitle] = React.useState("")
    const [date, setDate] = React.useState<Date | undefined>(undefined)
    const [time, setTime] = React.useState("")
    const [duration, setDuration] = React.useState("30")
    const [location, setLocation] = React.useState("")
    const [notes, setNotes] = React.useState("")

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
        }
    }, [isOpen, leadName])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
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
            
            await AppointmentService.create({
                lead_id: leadId,
                title: title.trim() || undefined,
                description: notes || undefined,
                appointment_type: "in_person", // Always in person
                scheduled_at: scheduledAt.toISOString(),
                duration_minutes: parseInt(duration),
                location: location || undefined,
            })

            onSuccess?.()
            onClose()
        } catch (err: any) {
            console.error("Failed to book appointment:", err)
            setError(err.response?.data?.detail || "Failed to book appointment")
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
