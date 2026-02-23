"use client"

import * as React from "react"
import { Calendar, Clock, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { FollowUpService, FollowUp, FollowUpStatus, FollowUpUpdate, FOLLOW_UP_STATUS_INFO } from "@/services/follow-up-service"

const TIME_SLOTS: { value: string; label: string }[] = []
for (let hour = 6; hour <= 23; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
        const h = hour.toString().padStart(2, "0")
        const m = minute.toString().padStart(2, "0")
        const value = `${h}:${m}`
        const period = hour >= 12 ? "PM" : "AM"
        const displayHour = hour % 12 || 12
        const label = `${displayHour}:${m} ${period}`
        TIME_SLOTS.push({ value, label })
    }
}

interface EditFollowUpModalProps {
    followUp: FollowUp | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
}

export function EditFollowUpModal({
    followUp,
    open,
    onOpenChange,
    onSuccess
}: EditFollowUpModalProps) {
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    
    const [formData, setFormData] = React.useState({
        scheduled_date: "",
        scheduled_time: "",
        notes: "",
        status: "pending" as FollowUpStatus,
    })
    
    React.useEffect(() => {
        if (open && followUp) {
            const scheduledDate = new Date(followUp.scheduled_at)
            const dateStr = scheduledDate.toLocaleDateString('en-CA')
            const hours = scheduledDate.getHours().toString().padStart(2, "0")
            const minutes = scheduledDate.getMinutes().toString().padStart(2, "0")
            const timeStr = `${hours}:${minutes}`
            
            setFormData({
                scheduled_date: dateStr,
                scheduled_time: TIME_SLOTS.find(t => t.value === timeStr)?.value || TIME_SLOTS[0]?.value || "09:00",
                notes: followUp.notes || "",
                status: followUp.status,
            })
            setError("")
        }
    }, [open, followUp])
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        
        if (!followUp) return
        
        if (!formData.scheduled_date) {
            setError("Please select a date")
            return
        }
        
        if (!formData.scheduled_time) {
            setError("Please select a time")
            return
        }
        
        const [year, month, day] = formData.scheduled_date.split('-').map(Number)
        const [hours, minutes] = formData.scheduled_time.split(':').map(Number)
        const localDateTime = new Date(year, month - 1, day, hours, minutes)
        
        if (isNaN(localDateTime.getTime())) {
            setError("Invalid date or time")
            return
        }
        
        setIsLoading(true)
        setError("")
        
        try {
            const updateData: FollowUpUpdate = {
                scheduled_at: localDateTime.toISOString(),
                notes: formData.notes || undefined,
                status: formData.status,
            }
            
            await FollowUpService.updateFollowUp(followUp.id, updateData)
            
            onSuccess?.()
            onOpenChange(false)
        } catch (err: any) {
            setError(err?.response?.data?.detail || "Failed to update follow-up. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }
    
    const handleClose = () => {
        setError("")
        onOpenChange(false)
    }
    
    const leadName = followUp?.lead?.customer
        ? `${followUp.lead.customer.first_name || ""} ${followUp.lead.customer.last_name || ""}`.trim()
        : "Unknown Lead"
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Edit Follow-up
                    </DialogTitle>
                    <DialogDescription>
                        Edit the follow-up for {leadName}
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="status">Status</Label>
                        <Select
                            value={formData.status}
                            onValueChange={(value) => setFormData(prev => ({ ...prev, status: value as FollowUpStatus }))}
                        >
                            <SelectTrigger id="status">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(FOLLOW_UP_STATUS_INFO) as FollowUpStatus[]).map((status) => (
                                    <SelectItem key={status} value={status}>
                                        {FOLLOW_UP_STATUS_INFO[status].label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="scheduled_date">Date</Label>
                            <Input
                                id="scheduled_date"
                                type="date"
                                value={formData.scheduled_date}
                                onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="scheduled_time" className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Time
                            </Label>
                            <Select
                                value={formData.scheduled_time}
                                onValueChange={(value) => setFormData(prev => ({ ...prev, scheduled_time: value }))}
                                required
                            >
                                <SelectTrigger id="scheduled_time">
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
                    </div>
                    
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                            id="notes"
                            placeholder="Add any notes about this follow-up..."
                            value={formData.notes}
                            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                            rows={4}
                        />
                    </div>
                    
                    {error && (
                        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                            {error}
                        </div>
                    )}
                    
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Changes
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
