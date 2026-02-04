"use client"

import * as React from "react"
import { useParams, useSearchParams } from "next/navigation"
import {
    Phone,
    Mail,
    Calendar,
    CalendarClock,
    Clock,
    ChevronLeft,
    MessageSquare,
    Send,
    User,
    Building2,
    Loader2,
    CheckCircle,
    XCircle,
    AlertCircle,
    UserPlus,
    PhoneCall,
    RefreshCw,
    PlusCircle,
    Trash2
} from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { MentionInput } from "@/components/ui/mention-input"
import { Button } from "@/components/ui/button"
import { Badge, getStatusVariant, getSourceVariant, getRoleVariant } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { LeadService, Lead, getLeadFullName } from "@/services/lead-service"
import { ActivityService, Activity, ACTIVITY_TYPE_INFO, ActivityType } from "@/services/activity-service"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { AssignToDealershipModal, AssignToSalespersonModal } from "@/components/leads/assignment-modal"
import { EmailComposerModal } from "@/components/emails/email-composer-modal"
import { ScheduleFollowUpModal } from "@/components/follow-ups/schedule-follow-up-modal"
import { BookAppointmentModal } from "@/components/appointments/book-appointment-modal"
import { useLeadUpdateEvents, useActivityEvents } from "@/hooks/use-websocket"
import { LocalTime } from "@/components/ui/local-time"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"
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

const LEAD_STATUSES = [
    { value: "new", label: "New", color: "blue" },
    { value: "contacted", label: "Contacted", color: "amber" },
    { value: "follow_up", label: "Follow Up", color: "purple" },
    { value: "interested", label: "Interested", color: "emerald" },
    { value: "not_interested", label: "Not Interested", color: "gray" },
    { value: "converted", label: "Converted", color: "emerald" },
    { value: "lost", label: "Lost", color: "rose" },
]

// Activity type icon mapping
const getActivityIcon = (type: ActivityType) => {
    switch (type) {
        case "lead_created": return <PlusCircle className="h-4 w-4 text-emerald-500" />
        case "lead_assigned": return <UserPlus className="h-4 w-4 text-blue-500" />
        case "lead_reassigned": return <RefreshCw className="h-4 w-4 text-amber-500" />
        case "status_changed": return <RefreshCw className="h-4 w-4 text-purple-500" />
        case "note_added": return <MessageSquare className="h-4 w-4 text-gray-500" />
        case "call_logged": return <PhoneCall className="h-4 w-4 text-emerald-500" />
        case "email_sent": return <Send className="h-4 w-4 text-blue-500" />
        case "email_received": return <Mail className="h-4 w-4 text-indigo-500" />
        case "follow_up_scheduled": return <Calendar className="h-4 w-4 text-amber-500" />
        case "follow_up_completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />
        case "appointment_scheduled": return <CalendarClock className="h-4 w-4 text-purple-500" />
        case "appointment_completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />
        case "appointment_cancelled": return <XCircle className="h-4 w-4 text-rose-500" />
        default: return <Clock className="h-4 w-4 text-gray-400" />
    }
}

export default function LeadDetailsPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const leadId = params.id as string
    const noteIdFromUrl = searchParams.get("note")
    const { canAssignToSalesperson, canAssignToDealership, role, isDealershipLevel, isSuperAdmin } = useRole()
    const user = useAuthStore(state => state.user)
    
    const [lead, setLead] = React.useState<Lead | null>(null)
    const [activities, setActivities] = React.useState<Activity[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isLoadingActivities, setIsLoadingActivities] = React.useState(false)
    const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false)
    const [newNote, setNewNote] = React.useState("")
    const [isAddingNote, setIsAddingNote] = React.useState(false)
    
    // Call/Email logging
    const [showCallModal, setShowCallModal] = React.useState(false)
    const [isLoggingCall, setIsLoggingCall] = React.useState(false)
    const [showEmailComposer, setShowEmailComposer] = React.useState(false)
    
    // Follow-up scheduling
    const [showScheduleFollowUp, setShowScheduleFollowUp] = React.useState(false)
    
    // Appointment booking
    const [showBookAppointment, setShowBookAppointment] = React.useState(false)
    
    // Assignment modals
    const [showDealershipModal, setShowDealershipModal] = React.useState(false)
    const [showSalespersonModal, setShowSalespersonModal] = React.useState(false)
    
    // Delete confirmation
    const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    
    // Lost reason modal
    const [showLostReasonModal, setShowLostReasonModal] = React.useState(false)
    const [lostReason, setLostReason] = React.useState("")
    
    // Reply to note
    const [replyingTo, setReplyingTo] = React.useState<string | null>(null)
    const [replyContent, setReplyContent] = React.useState("")
    const [mentionedUserIds, setMentionedUserIds] = React.useState<string[]>([])
    // Ref for pending SKATE confirmation data
    const pendingNoteSkateRef = React.useRef<{ content: string; userIds?: string[] } | null>(null)
    // Which note threads have replies expanded (click to load replies)
    const [expandedReplies, setExpandedReplies] = React.useState<Set<string>>(new Set())
    // Active tab: default to Notes when opening from mention link (?note=activity_id)
    const [activeActivityTab, setActiveActivityTab] = React.useState<"timeline" | "notes">(
        noteIdFromUrl ? "notes" : "timeline"
    )

    const fetchLead = React.useCallback(async () => {
        try {
            const data = await LeadService.getLead(leadId)
            setLead(data)
        } catch (error) {
            console.error("Failed to fetch lead:", error)
        } finally {
            setIsLoading(false)
        }
    }, [leadId])
    
    const fetchActivities = React.useCallback(async () => {
        setIsLoadingActivities(true)
        try {
            const data = await ActivityService.getLeadTimeline(leadId)
            setActivities(data.items)
        } catch (error) {
            console.error("Failed to fetch activities:", error)
        } finally {
            setIsLoadingActivities(false)
        }
    }, [leadId])

    React.useEffect(() => {
        fetchLead()
        fetchActivities()
    }, [fetchLead, fetchActivities])
    
    // When opened from mention notification (?note=activity_id): expand thread if reply, then scroll to note
    const scrolledToNoteRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!noteIdFromUrl || !activities.length || activeActivityTab !== "notes") return
        if (scrolledToNoteRef.current === noteIdFromUrl) return
        const targetNote = activities.find(a => a.type === "note_added" && a.id === noteIdFromUrl)
        if (!targetNote) return
        if (targetNote.parent_id) {
            setExpandedReplies(prev => new Set(prev).add(targetNote.parent_id!))
        }
        const scrollToNote = () => {
            const el = document.querySelector(`[data-activity-id="${noteIdFromUrl}"]`)
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" })
                el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-md")
                setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-md"), 2500)
            }
            scrolledToNoteRef.current = noteIdFromUrl
        }
        if (targetNote.parent_id) {
            setTimeout(scrollToNote, 300)
        } else {
            requestAnimationFrame(scrollToNote)
        }
    }, [noteIdFromUrl, activities, activeActivityTab])
    
    // Sync tab to "notes" when URL has ?note= (e.g. user landed from notification)
    React.useEffect(() => {
        if (noteIdFromUrl && activeActivityTab !== "notes") setActiveActivityTab("notes")
    }, [noteIdFromUrl])
    
    React.useEffect(() => {
        if (!noteIdFromUrl) scrolledToNoteRef.current = null
    }, [noteIdFromUrl])
    
    // Listen for real-time lead updates via WebSocket
    const handleLeadUpdate = React.useCallback((data: any) => {
        if (data.lead_id === leadId) {
            console.log("Received lead update:", data)
            
            // Handle different update types for optimistic UI updates
            if (data.update_type === "assigned" && data.assigned_to_user) {
                // Update assigned user in realtime without full refetch
                setLead(prev => prev ? {
                    ...prev,
                    assigned_to: data.assigned_to,
                    assigned_to_user: data.assigned_to_user,
                    dealership: data.dealership || prev.dealership
                } : null)
            } else if (data.update_type === "dealership_assigned" && data.dealership) {
                // Update dealership in realtime
                setLead(prev => prev ? {
                    ...prev,
                    dealership_id: data.dealership_id,
                    dealership: data.dealership
                } : null)
            } else if (data.update_type === "status_changed") {
                // Update status in realtime
                setLead(prev => prev ? {
                    ...prev,
                    status: data.status
                } : null)
            } else {
                // For other updates, do a full refetch
                fetchLead()
            }
        }
    }, [leadId, fetchLead])
    
    useLeadUpdateEvents(leadId, handleLeadUpdate)
    
    // Listen for real-time activity updates via WebSocket
    const handleNewActivity = React.useCallback((data: any) => {
        if (data.lead_id === leadId) {
            console.log("Received new activity:", data)
            
            // Check if this is an assignment activity that might change Lead Context
            const assignmentTypes = ["lead_assigned", "lead_reassigned"]
            if (assignmentTypes.includes(data.activity?.type)) {
                // Refresh both activities and lead data for assignment changes
                fetchActivities()
                fetchLead()
            } else if (data.activity) {
                // For other activities, add to timeline optimistically
                setActivities(prev => {
                    // Check if activity already exists (avoid duplicates)
                    if (prev.some(a => a.id === data.activity.id)) {
                        return prev
                    }
                    // Add new activity to the beginning of the list
                    return [data.activity, ...prev]
                })
            } else {
                // Fallback: refetch if no activity data
                fetchActivities()
            }
        }
    }, [leadId, fetchActivities, fetchLead])
    
    useActivityEvents(leadId, handleNewActivity)

    const handleStatusChange = async (newStatus: string, notes?: string, confirmSkate?: boolean) => {
        if (!lead) return
        
        // If changing to lost, show the lost reason modal
        if (newStatus === "lost" && !notes) {
            setShowLostReasonModal(true)
            return
        }
        
        setIsUpdatingStatus(true)
        try {
            const result = await LeadService.updateLeadStatus(lead.id, newStatus, notes, confirmSkate)
            // Check if this is a skate warning response
            if (isSkateWarningResponse(result)) {
                useSkateConfirmStore.getState().show(
                    result as SkateWarningInfo,
                    () => handleStatusChange(newStatus, notes, true) // Retry with confirmation
                )
            } else {
                setLead({ ...lead, status: newStatus })
                fetchActivities() // Refresh to show the status change with reason
            }
        } catch (error) {
            const skate = getSkateAttemptDetail(error)
            if (skate) useSkateAlertStore.getState().show(skate)
            else console.error("Failed to update status:", error)
        } finally {
            setIsUpdatingStatus(false)
        }
    }
    
    const handleMarkAsLost = async () => {
        if (!lostReason.trim()) return
        await handleStatusChange("lost", `Lost Reason: ${lostReason}`)
        setShowLostReasonModal(false)
        setLostReason("")
    }

    const handleDeleteLead = async () => {
        if (!lead) return
        
        setIsDeleting(true)
        try {
            await LeadService.deleteLead(lead.id)
            // Redirect to leads list after deletion
            window.location.href = "/leads"
        } catch (error) {
            console.error("Failed to delete lead:", error)
        } finally {
            setIsDeleting(false)
        }
    }

    const handleAddNote = async (confirmSkate?: boolean) => {
        if (!lead) return
        
        // If confirmSkate is true, use the pending values from ref
        let noteContent: string
        let userIds: string[] | undefined
        
        if (confirmSkate && pendingNoteSkateRef.current) {
            noteContent = pendingNoteSkateRef.current.content
            userIds = pendingNoteSkateRef.current.userIds
        } else {
            if (!newNote.trim()) return
            noteContent = String(newNote)
            userIds = mentionedUserIds.length > 0 ? mentionedUserIds.map(String) : undefined
        }
        
        setIsAddingNote(true)
        const leadId = String(lead.id)
        
        try {
            const result = await LeadService.addNote(leadId, noteContent, {
                mentioned_user_ids: userIds,
                confirmSkate: Boolean(confirmSkate)
            })
            // Check if this is a skate warning response
            if (isSkateWarningResponse(result)) {
                // Store the values for retry
                pendingNoteSkateRef.current = { content: noteContent, userIds }
                useSkateConfirmStore.getState().show(
                    result as SkateWarningInfo,
                    () => {
                        // Use setTimeout to break out of any potential sync issues
                        setTimeout(() => handleAddNote(true), 0)
                    }
                )
            } else {
                pendingNoteSkateRef.current = null
                setNewNote("")
                setMentionedUserIds([])
                fetchActivities() // Refresh activities to show new note
            }
        } catch (err) {
            pendingNoteSkateRef.current = null
            // Safely log error without causing serialization issues
            console.error("Failed to add note:", err instanceof Error ? err.message : String(err))
        } finally {
            setIsAddingNote(false)
        }
    }
    
    const handleLogCall = async (outcome: string, notes?: string, duration?: number, confirmSkate?: boolean) => {
        if (!lead) return
        setIsLoggingCall(true)
        try {
            const result = await ActivityService.logCall(lead.id, {
                outcome,
                notes,
                duration_seconds: duration,
                confirmSkate
            })
            // Check if this is a skate warning response
            if (isSkateWarningResponse(result)) {
                useSkateConfirmStore.getState().show(
                    result as SkateWarningInfo,
                    () => handleLogCall(outcome, notes, duration, true) // Retry with confirmation
                )
            } else {
                fetchActivities() // Refresh activities
                fetchLead() // Refresh lead to update last_contacted_at
            }
        } catch (error) {
            const skate = getSkateAttemptDetail(error)
            if (skate) useSkateAlertStore.getState().show(skate)
            else console.error("Failed to log call:", error)
        } finally {
            setIsLoggingCall(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!lead) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Card className="max-w-md">
                    <CardContent className="p-6 text-center">
                        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground/20" />
                        <h2 className="mt-4 text-lg font-semibold">Lead Not Found</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            The lead you're looking for doesn't exist or you don't have access.
                        </p>
                        <Link href="/leads">
                            <Button className="mt-4">Back to Leads</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const currentStatus = LEAD_STATUSES.find(s => s.value === lead.status)
    const isMentionOnly = lead.access_level === "mention_only"

    return (
        <div className="h-[calc(100vh-120px)] flex flex-col max-w-7xl mx-auto overflow-hidden">
            {/* Navigation */}
            <div className="flex items-center justify-between shrink-0 mb-4">
                <Link href="/leads" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <ChevronLeft className="h-4 w-4" />
                    Back to Leads
                </Link>
                <div className="flex items-center gap-2">
                    <Badge variant={getSourceVariant(lead.source)}>
                        {lead.source.replace('_', ' ')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                        Created <LocalTime date={lead.created_at} />
                    </span>
                    {isSuperAdmin && !isMentionOnly && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowDeleteDialog(true)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                        </Button>
                    )}
                </div>
            </div>

            {isMentionOnly && (
                <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
                    You have limited access (you were mentioned in a note). You can read this lead and reply to notes only.
                </div>
            )}

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0 overflow-hidden">
                {/* Left Column: Profile & Info */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto">
                    {/* Profile Card */}
                    <Card>
                        <CardContent className="p-6">
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold mb-4">
                                    {lead.first_name.charAt(0)}
                                </div>
                                <h1 className="text-2xl font-bold">
                                    {lead.first_name} {lead.last_name}
                                </h1>
                                
                                {/* Status Selector - hidden for mention-only access */}
                                {!isMentionOnly && (
                                <div className="mt-3 w-full max-w-xs">
                                    <Select 
                                        value={lead.status} 
                                        onValueChange={handleStatusChange}
                                        disabled={isUpdatingStatus}
                                    >
                                        <SelectTrigger className="w-full">
                                            <div className="flex items-center gap-2">
                                                {isUpdatingStatus && <Loader2 className="h-4 w-4 animate-spin" />}
                                                <Badge variant={getStatusVariant(lead.status)}>
                                                    {lead.status.replace('_', ' ')}
                                                </Badge>
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LEAD_STATUSES.map((status) => (
                                                <SelectItem key={status.value} value={status.value}>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={getStatusVariant(status.value)} size="sm">
                                                            {status.label}
                                                        </Badge>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                )}

                                {/* Quick Actions - hidden for mention-only access */}
                                {!isMentionOnly && (
                                <div className="flex flex-col gap-2 mt-6 w-full">
                                    <div className="flex gap-2">
                                        {lead.phone && (
                                            <Button 
                                                className="flex-1"
                                                onClick={() => {
                                                    window.open(`tel:${lead.phone}`, '_self')
                                                    setTimeout(() => {
                                                        const outcome = window.prompt("Call outcome (e.g., Answered, No Answer, Voicemail):")
                                                        if (outcome) {
                                                            handleLogCall(outcome)
                                                        }
                                                    }, 500)
                                                }}
                                            >
                                                <Phone className="h-4 w-4 mr-2" />
                                                Call
                                            </Button>
                                        )}
                                        {lead.email && (
                                            <Button 
                                                variant="outline" 
                                                className="flex-1"
                                                onClick={() => setShowEmailComposer(true)}
                                            >
                                                <Mail className="h-4 w-4 mr-2" />
                                                Email
                                            </Button>
                                        )}
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        className="w-full"
                                        onClick={() => setShowScheduleFollowUp(true)}
                                    >
                                        <Calendar className="h-4 w-4 mr-2" />
                                        Schedule Follow-up
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        className="w-full"
                                        onClick={() => setShowBookAppointment(true)}
                                    >
                                        <CalendarClock className="h-4 w-4 mr-2" />
                                        Book Appointment
                                    </Button>
                                </div>
                                )}
                            </div>

                            {/* Contact Details */}
                            <div className="mt-8 space-y-4 pt-6 border-t border-dashed">
                                {lead.email && (
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Mail className="h-4 w-4" /> Email
                                        </span>
                                        <span className="font-medium">{lead.email}</span>
                                    </div>
                                )}
                                {lead.phone && (
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Phone className="h-4 w-4" /> Phone
                                        </span>
                                        <span className="font-medium">{lead.phone}</span>
                                    </div>
                                )}
                                {lead.alternate_phone && (
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Phone className="h-4 w-4" /> Alt. Phone
                                        </span>
                                        <span className="font-medium">{lead.alternate_phone}</span>
                                    </div>
                                )}
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground flex items-center gap-2">
                                        <Calendar className="h-4 w-4" /> Created
                                    </span>
                                    <span className="font-medium">
                                        <LocalTime date={lead.created_at} />
                                    </span>
                                </div>
                                {lead.last_contacted_at && (
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Clock className="h-4 w-4" /> Last Contact
                                        </span>
                                        <span className="font-medium">
                                            <LocalTime date={lead.last_contacted_at} />
                                        </span>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Lead Context Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-primary" />
                                Lead Context
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Dealership Section */}
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                    Dealership
                                </p>
                                {lead.dealership ? (
                                    <p className="font-medium flex items-center gap-2">
                                        <Building2 className="h-4 w-4 text-primary" />
                                        {lead.dealership.name}
                                    </p>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                                            Not Assigned to Dealership
                                        </Badge>
                                        {!isMentionOnly && canAssignToDealership && (
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => setShowDealershipModal(true)}
                                            >
                                                <Building2 className="h-3 w-3 mr-1" />
                                                Assign
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            {/* Assigned Salesperson Section */}
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                    Assigned To
                                </p>
                                {lead.assigned_to_user ? (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <UserAvatar 
                                                firstName={lead.assigned_to_user.first_name}
                                                lastName={lead.assigned_to_user.last_name}
                                                size="sm"
                                            />
                                            <div>
                                                <p className="font-medium text-sm">
                                                    {lead.assigned_to_user.first_name} {lead.assigned_to_user.last_name}
                                                </p>
                                                <Badge variant={getRoleVariant(lead.assigned_to_user.role)} size="sm">
                                                    {lead.assigned_to_user.role === 'dealership_owner' ? 'Owner' : 
                                                     lead.assigned_to_user.role === 'dealership_admin' ? 'Admin' : 
                                                     lead.assigned_to_user.role === 'salesperson' ? 'Sales' : 
                                                     lead.assigned_to_user.role.replace('_', ' ')}
                                                </Badge>
                                            </div>
                                        </div>
                                        {!isMentionOnly && (canAssignToSalesperson || isDealershipLevel || isSuperAdmin) && lead.dealership_id && (
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => setShowSalespersonModal(true)}
                                            >
                                                <RefreshCw className="h-3 w-3 mr-1" />
                                                Reassign
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                                            Unassigned
                                        </Badge>
                                        {!isMentionOnly && (canAssignToSalesperson || isDealershipLevel || isSuperAdmin) && lead.dealership_id && (
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => setShowSalespersonModal(true)}
                                            >
                                                <UserPlus className="h-3 w-3 mr-1" />
                                                Assign
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            {lead.interested_in && (
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                        Interested In
                                    </p>
                                    <div className="rounded-lg bg-muted/50 p-3 mt-1 text-sm border">
                                        <p className="font-bold text-primary">{lead.interested_in}</p>
                                        {lead.budget_range && (
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                Budget: {lead.budget_range}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {lead.notes && (
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                        Notes
                                    </p>
                                    <p className="text-sm text-muted-foreground">{lead.notes}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Quick Status Actions - hidden for mention-only access */}
                    {!isMentionOnly && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Quick Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button 
                                className="w-full justify-start" 
                                variant="outline"
                                onClick={() => setShowScheduleFollowUp(true)}
                            >
                                <Calendar className="h-4 w-4 mr-2 text-blue-500" />
                                Schedule Follow-up
                            </Button>
                            <Button 
                                className="w-full justify-start" 
                                variant="outline"
                                onClick={() => setShowBookAppointment(true)}
                            >
                                <CalendarClock className="h-4 w-4 mr-2 text-purple-500" />
                                Book Appointment
                            </Button>
                            {lead.status !== "converted" && (
                                <Button 
                                    className="w-full justify-start" 
                                    variant="outline"
                                    onClick={() => handleStatusChange("converted")}
                                    disabled={isUpdatingStatus}
                                >
                                    <CheckCircle className="h-4 w-4 mr-2 text-emerald-500" />
                                    Mark as Converted
                                </Button>
                            )}
                            {lead.status !== "lost" && lead.status !== "converted" && (
                                <Button 
                                    className="w-full justify-start" 
                                    variant="outline"
                                    onClick={() => handleStatusChange("lost")}
                                    disabled={isUpdatingStatus}
                                >
                                    <XCircle className="h-4 w-4 mr-2 text-rose-500" />
                                    Mark as Lost
                                </Button>
                            )}
                            {lead.status === "new" && (
                                <Button 
                                    className="w-full justify-start" 
                                    variant="outline"
                                    onClick={() => handleStatusChange("contacted")}
                                    disabled={isUpdatingStatus}
                                >
                                    <Phone className="h-4 w-4 mr-2 text-amber-500" />
                                    Mark as Contacted
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                    )}
                </div>

                {/* Right Column: Activity & Interaction */}
                <div className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden">
                    <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        <Tabs value={activeActivityTab} onValueChange={(v) => setActiveActivityTab(v as "timeline" | "notes")} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            <div className="border-b px-6">
                                <TabsList className="bg-transparent h-auto p-0">
                                    <TabsTrigger 
                                        value="timeline"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4"
                                    >
                                        Activity Timeline
                                    </TabsTrigger>
                                    <TabsTrigger 
                                        value="notes"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4"
                                    >
                                        Notes
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value="timeline" className="flex-1 p-6 m-0 overflow-y-auto min-h-0">
                                {isLoadingActivities ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : activities.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground">
                                        <Clock className="h-12 w-12 mx-auto opacity-10 mb-2" />
                                        <p className="text-sm font-medium">No activities yet</p>
                                        <p className="text-xs">All lead activities will appear here</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {activities.map((activity, index) => (
                                            <div key={activity.id} className="flex gap-3 relative">
                                                {/* Timeline line */}
                                                {index < activities.length - 1 && (
                                                    <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
                                                )}
                                                
                                                {/* Icon */}
                                                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center z-10">
                                                    {getActivityIcon(activity.type)}
                                                </div>
                                                
                                                {/* Content */}
                                                <div className="flex-1 pb-4">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div>
                                                            <p className="text-sm font-medium">
                                                                {ACTIVITY_TYPE_INFO[activity.type]?.label || activity.type.replace('_', ' ')}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {activity.description}
                                                            </p>
                                                            {activity.user && (
                                                                <p className="text-xs text-muted-foreground mt-1">
                                                                    by {activity.user.first_name} {activity.user.last_name}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                            <LocalTime date={activity.created_at} />
                                                        </span>
                                                    </div>
                                                    
                                                    {/* Show metadata for notes and calls */}
                                                    {activity.type === "note_added" && activity.meta_data?.content != null ? (
                                                        <div className="mt-2 p-2 bg-muted/50 rounded text-sm">
                                                            {String(activity.meta_data.content)}
                                                        </div>
                                                    ) : null}
                                                    {activity.type === "call_logged" && (
                                                        <div className="mt-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-sm">
                                                            <span className="font-medium">{String(activity.meta_data?.outcome || 'Call')}</span>
                                                            {activity.meta_data?.duration_seconds != null ? (
                                                                <span className="text-muted-foreground ml-2">
                                                                    ({Math.floor(Number(activity.meta_data.duration_seconds) / 60)}m {Number(activity.meta_data.duration_seconds) % 60}s)
                                                                </span>
                                                            ) : null}
                                                            {activity.meta_data?.notes != null ? (
                                                                <p className="text-muted-foreground mt-1">{String(activity.meta_data.notes)}</p>
                                                            ) : null}
                                                        </div>
                                                    )}
                                                    {(activity.type === "email_sent" || activity.type === "email_received") && (
                                                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm">
                                                            <span className="font-medium">{String(activity.meta_data?.subject || 'Email')}</span>
                                                        </div>
                                                    )}
                                                    {activity.type === "status_changed" && activity.meta_data?.old_status != null ? (
                                                        <div className="mt-2 flex items-center gap-2 text-xs">
                                                            <Badge variant={getStatusVariant(String(activity.meta_data.old_status))} size="sm">
                                                                {String(activity.meta_data.old_status).replace('_', ' ')}
                                                            </Badge>
                                                            <span>→</span>
                                                            <Badge variant={getStatusVariant(String(activity.meta_data.new_status))} size="sm">
                                                                {String(activity.meta_data.new_status).replace('_', ' ')}
                                                            </Badge>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="notes" className="flex-1 p-6 m-0 overflow-y-auto min-h-0">
                                {(() => {
                                    const allNotes = activities.filter(a => a.type === "note_added")
                                    // Separate parent notes and replies (threaded)
                                    const parentNotes = allNotes
                                        .filter(n => !n.parent_id)
                                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                                    const repliesMap = allNotes.reduce((acc, note) => {
                                        if (note.parent_id) {
                                            if (!acc[note.parent_id]) acc[note.parent_id] = []
                                            acc[note.parent_id].push(note)
                                        }
                                        return acc
                                    }, {} as Record<string, typeof allNotes>)
                                    // Sort replies by created_at (oldest first) within each thread
                                    Object.keys(repliesMap).forEach(parentId => {
                                        repliesMap[parentId] = repliesMap[parentId].sort(
                                            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                                        )
                                    })
                                    
                                    if (parentNotes.length === 0) {
                                        return (
                                            <div className="text-center py-12 text-muted-foreground">
                                                <MessageSquare className="h-12 w-12 mx-auto opacity-10 mb-2" />
                                                <p className="text-sm font-medium">No notes yet</p>
                                                <p className="text-xs">Add a note below to get started</p>
                                            </div>
                                        )
                                    }
                                    
                                    const handleReply = async (parentId: string) => {
                                        if (!lead || !replyContent.trim()) return
                                        setIsAddingNote(true)
                                        try {
                                            await LeadService.addNote(lead.id, replyContent, {
                                                parent_id: parentId,
                                                mentioned_user_ids: mentionedUserIds.length > 0 ? mentionedUserIds : undefined
                                            })
                                            setReplyContent("")
                                            setReplyingTo(null)
                                            setMentionedUserIds([])
                                            setExpandedReplies(prev => new Set(prev).add(parentId)) // expand thread so new reply is visible
                                            fetchActivities()
                                        } catch (error) {
                                            console.error("Failed to add reply:", error)
                                        } finally {
                                            setIsAddingNote(false)
                                        }
                                    }
                                    
                                    return (
                                        <div className="space-y-4">
                                            {parentNotes.map((note) => {
                                                const replies = repliesMap[note.id] || []
                                                const mentionedUsers = note.meta_data?.mentioned_users as Array<{id: string; name: string}> | undefined
                                                
                                                return (
                                                    <div key={note.id} className="border rounded-lg" data-activity-id={note.id}>
                                                        {/* Parent Note */}
                                                        <div className="p-3">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    {note.user && (
                                                                        <UserAvatar 
                                                                            firstName={note.user.first_name}
                                                                            lastName={note.user.last_name}
                                                                            size="sm"
                                                                        />
                                                                    )}
                                                                    <span className="text-sm font-medium">
                                                                        {note.user ? `${note.user.first_name} ${note.user.last_name}` : 'System'}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-muted-foreground">
                                                                    <LocalTime date={note.created_at} />
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                                {String(note.meta_data?.content || note.description)}
                                                            </p>
                                                            {mentionedUsers && mentionedUsers.length > 0 && (
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {mentionedUsers.map(u => (
                                                                        <Badge key={u.id} variant="secondary" size="sm">
                                                                            @{u.name}
                                                                        </Badge>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div className="mt-2 flex items-center gap-3">
                                                                <button
                                                                    onClick={() => setReplyingTo(replyingTo === note.id ? null : note.id)}
                                                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                                                >
                                                                    <MessageSquare className="h-3 w-3" />
                                                                    Reply
                                                                </button>
                                                                {replies.length > 0 && (
                                                                    <button
                                                                        onClick={() => {
                                                                            const next = new Set(expandedReplies)
                                                                            if (next.has(note.id)) next.delete(note.id)
                                                                            else next.add(note.id)
                                                                            setExpandedReplies(next)
                                                                        }}
                                                                        className="text-xs text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1"
                                                                    >
                                                                        {expandedReplies.has(note.id)
                                                                            ? `Hide ${replies.length} reply${replies.length !== 1 ? "ies" : ""}`
                                                                            : `View ${replies.length} reply${replies.length !== 1 ? "ies" : ""}`}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        
                                                        {/* Replies - nested, shown only when expanded */}
                                                        {replies.length > 0 && expandedReplies.has(note.id) && (
                                                            <div className="border-t border-l-4 border-l-primary/30 bg-muted/20 ml-4 mr-3 mb-2 rounded-r">
                                                                <div className="text-xs font-medium text-muted-foreground px-3 pt-2 pb-1">
                                                                    {replies.length} reply{replies.length !== 1 ? "ies" : ""}
                                                                </div>
                                                                {replies.map(reply => {
                                                                    const replyMentions = reply.meta_data?.mentioned_users as Array<{id: string; name: string}> | undefined
                                                                    return (
                                                                        <div key={reply.id} className="p-3 pl-6 border-b last:border-b-0 border-border/50" data-activity-id={reply.id}>
                                                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    {reply.user && (
                                                                                        <UserAvatar 
                                                                                            firstName={reply.user.first_name}
                                                                                            lastName={reply.user.last_name}
                                                                                            size="sm"
                                                                                        />
                                                                                    )}
                                                                                    <span className="text-xs font-medium">
                                                                                        {reply.user ? `${reply.user.first_name} ${reply.user.last_name}` : 'System'}
                                                                                    </span>
                                                                                </div>
                                                                                <span className="text-xs text-muted-foreground">
                                                                                    <LocalTime date={reply.created_at} />
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                                                {String(reply.meta_data?.content || reply.description)}
                                                                            </p>
                                                                            {replyMentions && replyMentions.length > 0 && (
                                                                                <div className="mt-1 flex flex-wrap gap-1">
                                                                                    {replyMentions.map(u => (
                                                                                        <Badge key={u.id} variant="secondary" size="sm">
                                                                                            @{u.name}
                                                                                        </Badge>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        )}
                                                        
                                                        {/* Reply Input */}
                                                        {replyingTo === note.id && (
                                                            <div className="p-3 border-t bg-muted/20">
                                                                <MentionInput
                                                                    value={replyContent}
                                                                    onChange={setReplyContent}
                                                                    onMentionedUsersChange={setMentionedUserIds}
                                                                    placeholder="Write a reply... Use @ to mention someone"
                                                                    rows={2}
                                                                    disabled={isAddingNote}
                                                                />
                                                                <div className="flex justify-end gap-2 mt-2">
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => {
                                                                            setReplyingTo(null)
                                                                            setReplyContent("")
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        onClick={() => handleReply(note.id)}
                                                                        disabled={!replyContent.trim() || isAddingNote}
                                                                    >
                                                                        {isAddingNote ? (
                                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                                        ) : (
                                                                            "Reply"
                                                                        )}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                })()}
                            </TabsContent>
                        </Tabs>

                        {/* Quick Note Input - Fixed at bottom */}
                        <div className="p-4 border-t bg-muted/30 shrink-0">
                            <div className="flex flex-col gap-2 relative">
                                <MentionInput
                                    value={newNote}
                                    onChange={setNewNote}
                                    onMentionedUsersChange={setMentionedUserIds}
                                    placeholder="Add a note... Use @ to mention someone"
                                    rows={2}
                                    disabled={isAddingNote}
                                />
                                <div className="flex justify-end">
                                    <Button 
                                        onClick={() => handleAddNote()}
                                        disabled={!newNote.trim() || isAddingNote}
                                    >
                                        {isAddingNote ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        ) : (
                                            <Send className="h-4 w-4 mr-1" />
                                        )}
                                        Add Note
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Assignment Modals */}
            <AssignToDealershipModal
                open={showDealershipModal}
                onOpenChange={setShowDealershipModal}
                selectedLeads={lead ? [lead] : []}
                onSuccess={fetchLead}
            />
            
            <AssignToSalespersonModal
                open={showSalespersonModal}
                onOpenChange={setShowSalespersonModal}
                lead={lead}
                onSuccess={fetchLead}
            />
            
            {/* Email Composer Modal */}
            <EmailComposerModal
                isOpen={showEmailComposer}
                onClose={() => setShowEmailComposer(false)}
                leadId={lead?.id}
                leadEmail={lead?.email}
                leadName={lead ? `${lead.first_name} ${lead.last_name}` : undefined}
                onSent={() => {
                    fetchActivities()
                    fetchLead()
                }}
            />
            
            {/* Schedule Follow-up Modal */}
            {lead && (
                <ScheduleFollowUpModal
                    isOpen={showScheduleFollowUp}
                    onClose={() => setShowScheduleFollowUp(false)}
                    preselectedLeadId={lead.id}
                    onSuccess={() => {
                        fetchActivities() // Refresh activities to show the new follow-up activity
                    }}
                />
            )}
            
            {/* Book Appointment Modal */}
            {lead && (
                <BookAppointmentModal
                    isOpen={showBookAppointment}
                    onClose={() => setShowBookAppointment(false)}
                    leadId={lead.id}
                    leadName={getLeadFullName(lead)}
                    onSuccess={() => {
                        fetchActivities() // Refresh activities to show the new appointment
                    }}
                />
            )}
            
            {/* Delete Confirmation Dialog */}
            {lead && (
                <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{lead.first_name} {lead.last_name || ''}</strong>? 
                                This action cannot be undone. All associated activities, notes, and communications will be permanently removed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDeleteLead}
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
            )}
            
            {/* Lost Reason Modal */}
            <Dialog open={showLostReasonModal} onOpenChange={setShowLostReasonModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <XCircle className="h-5 w-5 text-rose-500" />
                            Mark Lead as Lost
                        </DialogTitle>
                        <DialogDescription>
                            Please provide a reason why this lead was lost. This helps with future analysis and improvements.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="lostReason">Reason for Loss *</Label>
                            <Textarea
                                id="lostReason"
                                placeholder="e.g., Went with competitor, Budget constraints, Not ready to buy, No response..."
                                value={lostReason}
                                onChange={(e) => setLostReason(e.target.value)}
                                rows={4}
                            />
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Common reasons: Price too high, Chose competitor, Not a good fit, Timing issues, No response
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowLostReasonModal(false)
                                setLostReason("")
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleMarkAsLost}
                            disabled={!lostReason.trim() || isUpdatingStatus}
                        >
                            {isUpdatingStatus ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </>
                            ) : (
                                "Mark as Lost"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
