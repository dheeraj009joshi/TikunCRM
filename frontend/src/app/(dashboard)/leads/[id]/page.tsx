"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import {
    Phone,
    Mail,
    Calendar,
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
import { LeadService, Lead } from "@/services/lead-service"
import { ActivityService, Activity, ACTIVITY_TYPE_INFO, ActivityType } from "@/services/activity-service"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { AssignToDealershipModal, AssignToSalespersonModal } from "@/components/leads/assignment-modal"
import { EmailComposerModal } from "@/components/emails/email-composer-modal"
import { ScheduleFollowUpModal } from "@/components/follow-ups/schedule-follow-up-modal"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
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
        default: return <Clock className="h-4 w-4 text-gray-400" />
    }
}

export default function LeadDetailsPage() {
    const params = useParams()
    const leadId = params.id as string
    const { canAssignToSalesperson, canAssignToDealership, role, isDealershipLevel, isSuperAdmin } = useRole()
    const { timezone } = useDealershipTimezone()
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
    
    // Assignment modals
    const [showDealershipModal, setShowDealershipModal] = React.useState(false)
    const [showSalespersonModal, setShowSalespersonModal] = React.useState(false)
    
    // Delete confirmation
    const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)

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

    const handleStatusChange = async (newStatus: string) => {
        if (!lead) return
        setIsUpdatingStatus(true)
        try {
            await LeadService.updateLeadStatus(lead.id, newStatus)
            setLead({ ...lead, status: newStatus })
        } catch (error) {
            console.error("Failed to update status:", error)
        } finally {
            setIsUpdatingStatus(false)
        }
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

    const handleAddNote = async () => {
        if (!lead || !newNote.trim()) return
        setIsAddingNote(true)
        try {
            await LeadService.addNote(lead.id, newNote)
            setNewNote("")
            fetchActivities() // Refresh activities to show new note
        } catch (error) {
            console.error("Failed to add note:", error)
        } finally {
            setIsAddingNote(false)
        }
    }
    
    const handleLogCall = async (outcome: string, notes?: string, duration?: number) => {
        if (!lead) return
        setIsLoggingCall(true)
        try {
            await ActivityService.logCall(lead.id, {
                outcome,
                notes,
                duration_seconds: duration
            })
            fetchActivities() // Refresh activities
            fetchLead() // Refresh lead to update last_contacted_at
        } catch (error) {
            console.error("Failed to log call:", error)
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

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            {/* Navigation */}
            <div className="flex items-center justify-between">
                <Link href="/leads" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <ChevronLeft className="h-4 w-4" />
                    Back to Leads
                </Link>
                <div className="flex items-center gap-2">
                    <Badge variant={getSourceVariant(lead.source)}>
                        {lead.source.replace('_', ' ')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                        Created {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium" })}
                    </span>
                    {isSuperAdmin && (
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Profile & Info */}
                <div className="lg:col-span-1 space-y-6">
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
                                
                                {/* Status Selector */}
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

                                {/* Quick Actions */}
                                <div className="flex flex-col gap-2 mt-6 w-full">
                                    <div className="flex gap-2">
                                        {lead.phone && (
                                            <Button 
                                                className="flex-1"
                                                onClick={() => {
                                                    window.open(`tel:${lead.phone}`, '_self')
                                                    // Quick call log prompt
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
                                </div>
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
                                        {formatDateInTimezone(lead.created_at, timezone, { dateStyle: "medium" })}
                                    </span>
                                </div>
                                {lead.last_contacted_at && (
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Clock className="h-4 w-4" /> Last Contact
                                        </span>
                                        <span className="font-medium">
                                            {formatDateInTimezone(lead.last_contacted_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
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
                                        {canAssignToDealership && (
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
                                        {(canAssignToSalesperson || isDealershipLevel || isSuperAdmin) && lead.dealership_id && (
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
                                        {(canAssignToSalesperson || isDealershipLevel || isSuperAdmin) && lead.dealership_id && (
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

                    {/* Quick Status Actions */}
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
                </div>

                {/* Right Column: Activity & Interaction */}
                <div className="lg:col-span-2">
                    <Card className="h-full flex flex-col">
                        <Tabs defaultValue="timeline" className="flex-1 flex flex-col">
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

                            <TabsContent value="timeline" className="flex-1 p-6 m-0 overflow-y-auto max-h-[500px]">
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
                                                            {formatDateInTimezone(activity.created_at, timezone, { dateStyle: "short", timeStyle: "short" })}
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

                            <TabsContent value="notes" className="flex-1 p-6 m-0 overflow-y-auto max-h-[500px]">
                                {(() => {
                                    const notes = activities.filter(a => a.type === "note_added")
                                    if (notes.length === 0) {
                                        return (
                                            <div className="text-center py-12 text-muted-foreground">
                                                <MessageSquare className="h-12 w-12 mx-auto opacity-10 mb-2" />
                                                <p className="text-sm font-medium">No notes yet</p>
                                                <p className="text-xs">Add a note below to get started</p>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div className="space-y-4">
                                            {notes.map((note) => (
                                                <div key={note.id} className="p-3 border rounded-lg">
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
                                                            {formatDateInTimezone(note.created_at, timezone, { dateStyle: "medium" })}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">
                                                        {String(note.meta_data?.content || note.description)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )
                                })()}
                            </TabsContent>
                        </Tabs>

                        {/* Quick Note Input */}
                        <div className="p-4 border-t bg-muted/30">
                            <div className="relative flex items-center gap-2">
                                <div className="relative flex-1">
                                    <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        value={newNote}
                                        onChange={(e) => setNewNote(e.target.value)}
                                        placeholder="Add a private note or log an activity..."
                                        className="w-full rounded-xl border bg-background pl-10 pr-4 py-3 text-sm focus:ring-1 focus:ring-primary outline-none shadow-inner transition-all"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault()
                                                handleAddNote()
                                            }
                                        }}
                                    />
                                </div>
                                <Button 
                                    onClick={handleAddNote}
                                    disabled={!newNote.trim() || isAddingNote}
                                    loading={isAddingNote}
                                >
                                    <Send className="h-4 w-4 mr-1" />
                                    Log
                                </Button>
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
        </div>
    )
}
