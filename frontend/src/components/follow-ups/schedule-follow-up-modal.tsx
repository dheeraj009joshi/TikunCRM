"use client"

import * as React from "react"
import { Calendar, Clock, Loader2, User, Users } from "lucide-react"
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
import { LeadService, Lead } from "@/services/lead-service"
import { FollowUpService, FollowUpCreate } from "@/services/follow-up-service"

// Same time slots as book-appointment-modal: 6 AM–11 PM in 15-minute intervals
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
import { TeamService, UserBrief } from "@/services/team-service"
import { useAuthStore } from "@/stores/auth-store"
import { useRole } from "@/hooks/use-role"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"
import { Badge, getRoleVariant } from "@/components/ui/badge"

interface ScheduleFollowUpModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    preselectedLeadId?: string
}

export function ScheduleFollowUpModal({
    isOpen,
    onClose,
    onSuccess,
    preselectedLeadId
}: ScheduleFollowUpModalProps) {
    const { timezone } = useBrowserTimezone()
    const user = useAuthStore((s) => s.user)
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const isAdmin = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    
    const [isLoading, setIsLoading] = React.useState(false)
    const [isLoadingLeads, setIsLoadingLeads] = React.useState(false)
    const [error, setError] = React.useState("")
    const [leads, setLeads] = React.useState<Lead[]>([])
    const [preselectedLead, setPreselectedLead] = React.useState<Lead | null>(null)
    const [teamMembers, setTeamMembers] = React.useState<UserBrief[]>([])
    const [assignedTo, setAssignedTo] = React.useState<string>("auto")
    const [loadingTeam, setLoadingTeam] = React.useState(false)
    const [leadAssignedToUser, setLeadAssignedToUser] = React.useState<UserBrief | null>(null)
    
    const [formData, setFormData] = React.useState({
        lead_id: preselectedLeadId || "",
        scheduled_at: "",
        scheduled_time: "",
        notes: "",
    })
    
    // Fetch leads when modal opens
    React.useEffect(() => {
        if (isOpen && !preselectedLeadId) {
            fetchLeads()
        } else if (isOpen && preselectedLeadId) {
            setFormData(prev => ({ ...prev, lead_id: preselectedLeadId }))
            fetchPreselectedLead()
        }
    }, [isOpen, preselectedLeadId])

    // When lead is selected, load team and default assignment (lead's primary or current user)
    const effectiveLeadId = formData.lead_id || preselectedLeadId
    React.useEffect(() => {
        if (!isOpen || !effectiveLeadId) {
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
                        if (user?.id) setAssignedTo(user.id)
                        else setAssignedTo("auto")
                    }
                } else {
                    setTeamMembers([])
                    if (!lead.assigned_to) setAssignedTo(user?.id || "auto")
                }
            })
            .catch(() => {
                setTeamMembers([])
                setAssignedTo(user?.id || "auto")
                setLeadAssignedToUser(null)
            })
            .finally(() => setLoadingTeam(false))
    }, [isOpen, effectiveLeadId, user?.dealership_id, user?.id])
    
    const fetchPreselectedLead = async () => {
        if (!preselectedLeadId) return
        
        setIsLoadingLeads(true)
        try {
            const lead = await LeadService.getLead(preselectedLeadId)
            setPreselectedLead(lead)
        } catch (error) {
            console.error("Failed to fetch preselected lead:", error)
            setError("Failed to load lead information")
        } finally {
            setIsLoadingLeads(false)
        }
    }
    
    const fetchLeads = async () => {
        setIsLoadingLeads(true)
        try {
            const response = await LeadService.listLeads({ page_size: 100 })
            setLeads(response.items)
        } catch (error) {
            console.error("Failed to fetch leads:", error)
        } finally {
            setIsLoadingLeads(false)
        }
    }
    
    const resetForm = () => {
        setFormData({
            lead_id: preselectedLeadId || "",
            scheduled_at: "",
            scheduled_time: "",
            notes: "",
        })
        setError("")
        setPreselectedLead(null)
        setAssignedTo("auto")
        setLeadAssignedToUser(null)
    }
    
    const handleSubmit = async (e?: React.FormEvent, confirmSkate?: boolean) => {
        if (e) e.preventDefault()
        
        if (!formData.lead_id) {
            setError("Please select a lead")
            return
        }
        
        if (!formData.scheduled_at) {
            setError("Please select a date")
            return
        }
        
        if (!formData.scheduled_time) {
            setError("Please select a time")
            return
        }
        
        // Combine date and time - create in local timezone first
        const [year, month, day] = formData.scheduled_at.split('-').map(Number)
        const [hours, minutes] = formData.scheduled_time.split(':').map(Number)
        
        // Create date in local timezone
        const localDateTime = new Date(year, month - 1, day, hours, minutes)
        
        if (isNaN(localDateTime.getTime())) {
            setError("Invalid date or time")
            return
        }
        
        if (localDateTime < new Date()) {
            setError("Scheduled time must be in the future")
            return
        }
        
        // Convert to ISO string for backend (backend expects UTC)
        const scheduledDateTime = localDateTime
        
        setIsLoading(true)
        setError("")
        
        try {
            const followUpData: FollowUpCreate = {
                lead_id: formData.lead_id,
                scheduled_at: scheduledDateTime.toISOString(),
                notes: formData.notes || undefined,
                assigned_to: isAdmin ? (assignedTo !== "auto" ? assignedTo : undefined) : undefined,
                confirmSkate,
            }
            
            const result = await FollowUpService.scheduleFollowUp(formData.lead_id, followUpData)
            
            // Check if this is a skate warning response
            if (isSkateWarningResponse(result)) {
                useSkateConfirmStore.getState().show(
                    result as SkateWarningInfo,
                    () => handleSubmit(undefined, true) // Retry with confirmation
                )
            } else {
                resetForm()
                onSuccess?.()
                onClose()
            }
        } catch (err: any) {
            const skate = getSkateAttemptDetail(err)
            if (skate) {
                useSkateAlertStore.getState().show(skate)
                onClose()
            } else {
                setError(err?.response?.data?.detail || "Failed to schedule follow-up. Please try again.")
            }
        } finally {
            setIsLoading(false)
        }
    }
    
    const handleClose = () => {
        resetForm()
        onClose()
    }
    
    // Get minimum date (today) for date input
    const minDate = new Date().toISOString().split('T')[0]
    
    // Default time: 1 hour from now, rounded to nearest 15-min slot (same as appointment modal)
    const getDefaultTime = () => {
        const now = new Date()
        now.setHours(now.getHours() + 1)
        now.setMinutes(0)
        const h = now.getHours().toString().padStart(2, "0")
        const m = now.getMinutes().toString().padStart(2, "0")
        const value = `${h}:${m}`
        return TIME_SLOTS.some((s) => s.value === value) ? value : TIME_SLOTS[0]?.value ?? "09:00"
    }
    
    React.useEffect(() => {
        if (isOpen && !formData.scheduled_time) {
            setFormData(prev => ({ ...prev, scheduled_time: getDefaultTime() }))
        }
    }, [isOpen])
    
    const selectedLead = leads.find(l => l.id === formData.lead_id)
    
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Schedule Follow-up
                    </DialogTitle>
                    <DialogDescription>
                        Schedule a follow-up task for a lead. You'll be reminded when it's time.
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Lead Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="lead_id">Lead *</Label>
                        {preselectedLeadId ? (
                            <div className="flex items-center gap-2 p-3 border rounded-md bg-muted/50">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">
                                    {isLoadingLeads ? (
                                        "Loading..."
                                    ) : preselectedLead ? (
                                        `${preselectedLead.first_name} ${preselectedLead.last_name || ""}`.trim()
                                    ) : (
                                        "Lead not found"
                                    )}
                                </span>
                            </div>
                        ) : (
                            <Select
                                value={formData.lead_id}
                                onValueChange={(value) => setFormData(prev => ({ ...prev, lead_id: value }))}
                                disabled={isLoadingLeads}
                            >
                                <SelectTrigger id="lead_id">
                                    <SelectValue placeholder={isLoadingLeads ? "Loading leads..." : "Select a lead"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {leads.map((lead) => (
                                        <SelectItem key={lead.id} value={lead.id}>
                                            <div className="flex items-center gap-2">
                                                <span>
                                                    {lead.first_name} {lead.last_name || ""}
                                                </span>
                                                {lead.email && (
                                                    <span className="text-xs text-muted-foreground">
                                                        ({lead.email})
                                                    </span>
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Assign to (admin can select; non-admin is always self) */}
                    {effectiveLeadId && (
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
                                        This follow-up will be assigned to you.
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
                    
                    {/* Date and Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="scheduled_at">Date *</Label>
                            <Input
                                id="scheduled_at"
                                type="date"
                                value={formData.scheduled_at}
                                onChange={(e) => setFormData(prev => ({ ...prev, scheduled_at: e.target.value }))}
                                min={minDate}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="scheduled_time" className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Time *
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
                    
                    {/* Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes (Optional)</Label>
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
                                    Scheduling...
                                </>
                            ) : (
                                <>
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Schedule Follow-up
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
