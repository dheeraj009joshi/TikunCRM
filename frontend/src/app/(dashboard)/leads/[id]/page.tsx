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
    MessageCircle,
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
    Trash2,
    MapPin,
    Briefcase,
    Pencil,
    Save,
    X,
    Copy,
    Store,
    LogOut,
    MoreVertical,
    Download,
    FileStack,
    Upload,
    ExternalLink,
    FileText
} from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { LeadService, Lead, getLeadFullName, getLeadPhone, getLeadEmail } from "@/services/lead-service"
import { LeadStageService, LeadStage, getStageLabel, getStageColor } from "@/services/lead-stage-service"
import { ActivityService, Activity, ACTIVITY_TYPE_INFO, ActivityType } from "@/services/activity-service"
import { ShowroomService, ShowroomVisit, ShowroomOutcome, getOutcomeLabel } from "@/services/showroom-service"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { AssignToDealershipModal, AssignToSalespersonModal, AssignSecondaryCustomerModal } from "@/components/leads/assignment-modal"
import { getCustomerFullName } from "@/services/customer-service"
import { EmailComposerModal } from "@/components/emails/email-composer-modal"
import { ScheduleFollowUpModal } from "@/components/follow-ups/schedule-follow-up-modal"
import { BookAppointmentModal } from "@/components/appointments/book-appointment-modal"
import { AppointmentService, Appointment, AppointmentStatus, getAppointmentStatusLabel, getAppointmentStatusColor, isAppointmentStatusTerminal } from "@/services/appointment-service"
import { FollowUpService, FollowUp, FOLLOW_UP_STATUS_INFO } from "@/services/follow-up-service"
import { StipsService, StipsCategory, StipDocument } from "@/services/stips-service"
import { useLeadUpdateEvents, useActivityEvents } from "@/hooks/use-websocket"
import { LocalTime } from "@/components/ui/local-time"
import { format } from "date-fns"
import { formatDateInTimezone, parseAsUTC } from "@/utils/timezone"
import { Calendar as CalendarPicker } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { getSkateAttemptDetail } from "@/lib/skate-alert"
import { useSkateAlertStore } from "@/stores/skate-alert-store"
import { useSkateConfirmStore, isSkateWarningResponse, type SkateWarningInfo } from "@/stores/skate-confirm-store"
import { useCallLeadOptional } from "@/contexts/call-lead-context"
import { voiceService } from "@/services/voice-service"
import JSZip from "jszip"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
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

const STAGES_HIDDEN_FROM_STATUS_UI = ["follow_up", "negotiation", "reschedule", "in_showroom"]

// Activity type icon mapping
const getActivityIcon = (type: ActivityType) => {
    switch (type) {
        case "lead_created": return <PlusCircle className="h-4 w-4 text-emerald-500" />
        case "lead_assigned": return <UserPlus className="h-4 w-4 text-blue-500" />
        case "lead_reassigned": return <RefreshCw className="h-4 w-4 text-amber-500" />
        case "lead_updated": return <Pencil className="h-4 w-4 text-slate-500" />
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
        case "stip_document_added": return <FileStack className="h-4 w-4 text-blue-500" />
        case "stip_document_removed": return <FileStack className="h-4 w-4 text-slate-500" />
        case "credit_app_initiated": return <FileText className="h-4 w-4 text-blue-500" />
        case "credit_app_completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />
        case "credit_app_abandoned": return <XCircle className="h-4 w-4 text-amber-500" />
        default: return <Clock className="h-4 w-4 text-gray-400" />
    }
}

function renderCreditAppCompletedBlock(meta: Record<string, unknown> | undefined): React.ReactNode {
    if (!meta) return null;
    const appId = meta.application_id; const formId = meta.form_id; const taxId = meta.tax_id;
    if (appId == null && formId == null && taxId == null) return null;
    return (
        <div className="mt-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded text-sm">
            {Boolean(appId) && <p><span className="font-medium">Application ID:</span> {String(appId)}</p>}
            {Boolean(formId) && <p><span className="font-medium">Form ID:</span> {String(formId)}</p>}
            {Boolean(taxId) && <p><span className="font-medium">Tax ID:</span> {String(taxId)}</p>}
        </div>
    ) as React.ReactNode;
}

function LeadAppointmentCompleteForm({
    appointment,
    onSuccess,
    onClose,
}: {
    appointment: Appointment
    onSuccess: () => void
    onClose: () => void
}) {
    const [loading, setLoading] = React.useState(false)
    const [status, setStatus] = React.useState<AppointmentStatus>("completed")
    const [outcomeNotes, setOutcomeNotes] = React.useState("")
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            await AppointmentService.complete(appointment.id, { status, outcome_notes: outcomeNotes || undefined })
            onSuccess()
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to complete")
        } finally {
            setLoading(false)
        }
    }
    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="no_show">No Show</SelectItem>
                        <SelectItem value="rescheduled">Rescheduled</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label>Outcome Notes (optional)</Label>
                <Textarea
                    value={outcomeNotes}
                    onChange={(e) => setOutcomeNotes(e.target.value)}
                    placeholder="What was discussed or accomplished?"
                    rows={3}
                />
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
            </DialogFooter>
        </form>
    )
}

function LeadAppointmentRescheduleForm({
    appointment,
    timeSlots,
    onSuccess,
    onClose,
}: {
    appointment: Appointment
    timeSlots: { value: string; label: string }[]
    onSuccess: () => void
    onClose: () => void
}) {
    const [loading, setLoading] = React.useState(false)
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(() => {
        const d = new Date(appointment.scheduled_at)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return d < today ? today : d
    })
    const [selectedTime, setSelectedTime] = React.useState(() => {
        const d = new Date(appointment.scheduled_at)
        const h = d.getHours()
        const m = d.getMinutes()
        const roundedM = Math.round(m / 15) * 15
        const minute = roundedM === 60 ? 0 : roundedM
        const hour = roundedM === 60 ? h + 1 : h
        const value = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
        const slot = timeSlots.find((s) => s.value === value)
        return slot ? slot.value : timeSlots[0]?.value ?? "09:00"
    })
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedDate || !selectedTime) return
        const [hours, minutes] = selectedTime.split(":").map(Number)
        const scheduledAt = new Date(selectedDate)
        scheduledAt.setHours(hours, minutes, 0, 0)
        setLoading(true)
        try {
            await AppointmentService.update(appointment.id, {
                scheduled_at: scheduledAt.toISOString(),
                status: "scheduled",
            })
            onSuccess()
        } catch (err: any) {
            alert(err.response?.data?.detail || "Failed to reschedule")
        } finally {
            setLoading(false)
        }
    }
    const minDate = new Date()
    minDate.setHours(0, 0, 0, 0)
    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label>Date</Label>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className={cn("w-full justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                            <Calendar className="mr-2 h-4 w-4" />
                            {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Pick date"}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <CalendarPicker mode="single" selected={selectedDate} onSelect={setSelectedDate} disabled={(date) => date < minDate} />
                    </PopoverContent>
                </Popover>
            </div>
            <div className="space-y-2">
                <Label>Time</Label>
                <Select value={selectedTime} onValueChange={setSelectedTime}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[220px]">
                        {timeSlots.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={loading || !selectedDate || !selectedTime}>{loading ? "Saving..." : "Save"}</Button>
            </DialogFooter>
        </form>
    )
}

export default function LeadDetailsPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const leadId = params.id as string
    const noteIdFromUrl = searchParams.get("note")
    const { canAssignToSalesperson, canAssignToDealership, role, isDealershipLevel, isSuperAdmin, isSalesperson } = useRole()
    const user = useAuthStore(state => state.user)
    const { timezone } = useBrowserTimezone()
    const { toast } = useToast()
    
    const [lead, setLead] = React.useState<Lead | null>(null)
    const [activities, setActivities] = React.useState<Activity[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isLoadingActivities, setIsLoadingActivities] = React.useState(false)
    const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false)
    const [newNote, setNewNote] = React.useState("")
    const [isAddingNote, setIsAddingNote] = React.useState(false)
    
    // Call/Email logging
    const [showCallModal, setShowCallModal] = React.useState(false)
    const [showCallTextComingSoon, setShowCallTextComingSoon] = React.useState(false)
    const [voiceEnabled, setVoiceEnabled] = React.useState(false)
    const callLeadCtx = useCallLeadOptional()
    const [isLoggingCall, setIsLoggingCall] = React.useState(false)
    const [showEmailComposer, setShowEmailComposer] = React.useState(false)
    
    // Follow-up scheduling
    const [showScheduleFollowUp, setShowScheduleFollowUp] = React.useState(false)
    
    // Appointment booking
    const [showBookAppointment, setShowBookAppointment] = React.useState(false)
    
    // Assignment modals
    const [showDealershipModal, setShowDealershipModal] = React.useState(false)
    const [showSalespersonModal, setShowSalespersonModal] = React.useState(false)
    const [showSecondaryCustomerModal, setShowSecondaryCustomerModal] = React.useState(false)
    const [showRemoveSecondaryConfirm, setShowRemoveSecondaryConfirm] = React.useState(false)
    
    // Delete confirmation
    const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    
    // Lost reason modal
    const [showLostReasonModal, setShowLostReasonModal] = React.useState(false)
    const [showStageNotesModal, setShowStageNotesModal] = React.useState(false)
    const [pendingStageForNotes, setPendingStageForNotes] = React.useState<string | null>(null)
    const [stageNotes, setStageNotes] = React.useState("")
    const [lostReason, setLostReason] = React.useState("")
    
    // Showroom check-in/out
    const [currentVisit, setCurrentVisit] = React.useState<ShowroomVisit | null>(null)
    const [isCheckingIn, setIsCheckingIn] = React.useState(false)
    const [showCheckInAppointmentModal, setShowCheckInAppointmentModal] = React.useState(false)
    const [leadAppointmentsForCheckIn, setLeadAppointmentsForCheckIn] = React.useState<Appointment[]>([])
    const [leadAppointments, setLeadAppointments] = React.useState<Appointment[]>([])
    const [leadFollowUps, setLeadFollowUps] = React.useState<FollowUp[]>([])
    const [loadingAppointmentsFollowUps, setLoadingAppointmentsFollowUps] = React.useState(false)
    const [showCheckOutModal, setShowCheckOutModal] = React.useState(false)
    const [checkOutOutcome, setCheckOutOutcome] = React.useState<ShowroomOutcome>("follow_up")
    const [checkOutNotes, setCheckOutNotes] = React.useState("")
    const [checkOutRescheduleDate, setCheckOutRescheduleDate] = React.useState<Date | undefined>(undefined)
    const [checkOutRescheduleTime, setCheckOutRescheduleTime] = React.useState("")
    const [isCheckingOut, setIsCheckingOut] = React.useState(false)
    // Appointment actions (lead detail Appointments tab)
    const [appointmentCompleteModal, setAppointmentCompleteModal] = React.useState<Appointment | null>(null)
    const [appointmentRescheduleModal, setAppointmentRescheduleModal] = React.useState<Appointment | null>(null)
    // Credit app outcome (capture when user returns after initiating)
    const [showCreditAppOutcomeModal, setShowCreditAppOutcomeModal] = React.useState(false)
    const [creditAppOutcomeSubmitting, setCreditAppOutcomeSubmitting] = React.useState<"complete" | "abandon" | null>(null)
    const [isInitiatingCreditApp, setIsInitiatingCreditApp] = React.useState(false)
    
    // Reply to note
    const [replyingTo, setReplyingTo] = React.useState<string | null>(null)
    const [replyContent, setReplyContent] = React.useState("")
    const [mentionedUserIds, setMentionedUserIds] = React.useState<string[]>([])
    // Ref for pending SKATE confirmation data
    const pendingNoteSkateRef = React.useRef<{ content: string; userIds?: string[] } | null>(null)
    // Which note threads have replies expanded (click to load replies)
    const [expandedReplies, setExpandedReplies] = React.useState<Set<string>>(new Set())
    // Active tab: default to Notes when opening from mention link (?note=activity_id)
    const [activeActivityTab, setActiveActivityTab] = React.useState<"timeline" | "notes" | "appointments" | "followups" | "stips">(
        noteIdFromUrl ? "notes" : "timeline"
    )
    // Stips: categories, documents, and upload state
    const [stipsCategories, setStipsCategories] = React.useState<StipsCategory[]>([])
    const [stipsDocuments, setStipsDocuments] = React.useState<StipDocument[]>([])
    const [stipsConfigured, setStipsConfigured] = React.useState(false)
    const [stipsLoading, setStipsLoading] = React.useState(false)
    const [activeStipsCategoryId, setActiveStipsCategoryId] = React.useState<string | null>(null)
    const [stipsUploadingCategoryId, setStipsUploadingCategoryId] = React.useState<string | null>(null)
    const [stipsUploadProgress, setStipsUploadProgress] = React.useState<number>(0)
    const [stipsUploadTotalFiles, setStipsUploadTotalFiles] = React.useState<number>(0)
    const [stipsUploadCompletedCount, setStipsUploadCompletedCount] = React.useState<number>(0)
    const [stipsViewDoc, setStipsViewDoc] = React.useState<{ url: string; fileName: string; contentType: string } | null>(null)
    const [exportLoading, setExportLoading] = React.useState(false)
    const [exportProgress, setExportProgress] = React.useState(0)
    const [exportStatus, setExportStatus] = React.useState("")

    // Pipeline stages (for status dropdown with correct colors)
    const [stages, setStages] = React.useState<LeadStage[]>([])
    
    // Lead details editing
    const [isEditingDetails, setIsEditingDetails] = React.useState(false)
    const [isSavingDetails, setIsSavingDetails] = React.useState(false)
    const [editForm, setEditForm] = React.useState({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        alternate_phone: "",
        address: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
        company: "",
        job_title: "",
        date_of_birth: "",
        preferred_contact_method: "",
        preferred_contact_time: "",
        interested_in: "",
        budget_range: "",
        notes: "",
    })

    // Voice: in-app call opens softphone when enabled
    React.useEffect(() => {
        voiceService.getConfig().then((c) => setVoiceEnabled(c.voice_enabled)).catch(() => {})
    }, [])

    const handleCallClick = React.useCallback(() => {
        if (!lead) return
        const phone = getLeadPhone(lead)
        if (!phone) return
        if (voiceEnabled && callLeadCtx) {
            callLeadCtx.setCallLead({ phone, leadId: lead.id, leadName: getLeadFullName(lead) })
        } else {
            setShowCallTextComingSoon(true)
        }
    }, [lead, voiceEnabled, callLeadCtx])

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

    // Check if lead is currently in showroom
    const fetchShowroomStatus = React.useCallback(async () => {
        if (!leadId) return
        try {
            const visit = await ShowroomService.getCurrentVisitForLead(leadId)
            setCurrentVisit(visit)
        } catch (error) {
            console.error("Failed to fetch showroom status:", error)
        }
    }, [leadId])

    const fetchLeadAppointmentsAndFollowUps = React.useCallback(async () => {
        if (!leadId) return
        setLoadingAppointmentsFollowUps(true)
        try {
            const [appointmentsRes, followUpsList] = await Promise.all([
                AppointmentService.list({ lead_id: leadId, page_size: 100 }),
                FollowUpService.listFollowUps({ lead_id: leadId }).catch(() => []),
            ])
            setLeadAppointments(appointmentsRes.items)
            setLeadFollowUps(followUpsList)
        } catch (error) {
            console.error("Failed to fetch appointments/follow-ups:", error)
        } finally {
            setLoadingAppointmentsFollowUps(false)
        }
    }, [leadId])

    // Badge: only today's count; color = red if any of today's are overdue, else green. Hide when 0.
    const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "confirmed", "arrived", "in_showroom", "in_progress", "rescheduled"] as const
    const {
        appointmentBadgeCount,
        appointmentBadgeColor,
        followUpBadgeCount,
        followUpBadgeColor,
        appointmentsToday,
        appointmentsUpcoming,
        followUpsToday,
        followUpsUpcoming,
    } = React.useMemo(() => {
        const now = new Date()
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
        const isSameDay = (d: Date) =>
            d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
        const toDate = (s: string) => parseAsUTC(s)
        const relevantAppointments = leadAppointments.filter(
            (a) => ACTIVE_APPOINTMENT_STATUSES.includes(a.status as typeof ACTIVE_APPOINTMENT_STATUSES[number])
        )
        const todayApt: Appointment[] = []
        const upcomingApt: Appointment[] = []
        let aptTodayOverdue = false
        relevantAppointments.forEach((a) => {
            const d = toDate(a.scheduled_at)
            if (isNaN(d.getTime())) return
            if (isSameDay(d)) {
                todayApt.push(a)
                if (d.getTime() < now.getTime()) aptTodayOverdue = true
            } else if (d.getTime() > endOfToday.getTime()) upcomingApt.push(a)
        })
        todayApt.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
        upcomingApt.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
        const appointmentBadgeCount = todayApt.length
        const appointmentBadgeColor = aptTodayOverdue ? "red" : "green"
        const relevantFollowUps = leadFollowUps.filter((f) => f.status === "pending")
        const todayFu: FollowUp[] = []
        const upcomingFu: FollowUp[] = []
        let fuTodayOverdue = false
        relevantFollowUps.forEach((f) => {
            const d = toDate(f.scheduled_at)
            if (isNaN(d.getTime())) return
            if (isSameDay(d)) {
                todayFu.push(f)
                if (d.getTime() < now.getTime()) fuTodayOverdue = true
            } else if (d.getTime() > endOfToday.getTime()) upcomingFu.push(f)
        })
        todayFu.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
        upcomingFu.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
        const followUpBadgeCount = todayFu.length
        const followUpBadgeColor = fuTodayOverdue ? "red" : "green"
        return {
            appointmentBadgeCount,
            appointmentBadgeColor,
            followUpBadgeCount,
            followUpBadgeColor,
            appointmentsToday: todayApt,
            appointmentsUpcoming: upcomingApt,
            followUpsToday: todayFu,
            followUpsUpcoming: upcomingFu,
        }
    }, [leadAppointments, leadFollowUps])

    const doCheckIn = async (appointmentId: string | null) => {
        setIsCheckingIn(true)
        try {
            const visit = await ShowroomService.checkIn({
                lead_id: leadId,
                ...(appointmentId ? { appointment_id: appointmentId } : {}),
            })
            setCurrentVisit(visit)
            setShowCheckInAppointmentModal(false)
            setLeadAppointmentsForCheckIn([])
            fetchActivities() // Refresh to show check-in activity
        } catch (error: any) {
            const detail = error.response?.data?.detail
            const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(" ") : "Failed to check in"
            alert(message)
            if (typeof detail === "string" && detail.toLowerCase().includes("already checked in")) {
                fetchShowroomStatus()
            }
        } finally {
            setIsCheckingIn(false)
        }
    }

    const handleCheckIn = async () => {
        setIsCheckingIn(true)
        try {
            const now = new Date()
            const startOfToday = new Date(now)
            startOfToday.setHours(0, 0, 0, 0)
            const res = await AppointmentService.list({
                lead_id: leadId,
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
            setIsCheckingIn(false)
        }
    }

    const handleCheckOut = async () => {
        if (!currentVisit) return
        const needsReschedule = checkOutOutcome === "reschedule" && currentVisit.appointment_id
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
        setIsCheckingOut(true)
        try {
            await ShowroomService.checkOut(currentVisit.id, {
                outcome: checkOutOutcome,
                notes: checkOutNotes || undefined,
                reschedule_scheduled_at,
            })
            setCurrentVisit(null)
            setShowCheckOutModal(false)
            setCheckOutNotes("")
            setCheckOutRescheduleDate(undefined)
            setCheckOutRescheduleTime("")
            fetchActivities()
            fetchLead()
            fetchLeadAppointmentsAndFollowUps()
        } catch (error: any) {
            alert(error.response?.data?.detail || "Failed to check out")
        } finally {
            setIsCheckingOut(false)
        }
    }

    const refreshAppointments = React.useCallback(() => {
        fetchLeadAppointmentsAndFollowUps()
        fetchActivities()
    }, [fetchLeadAppointmentsAndFollowUps, fetchActivities])

    async function handleAppointmentConfirm(apt: Appointment) {
        try {
            await AppointmentService.update(apt.id, { status: "confirmed" })
            refreshAppointments()
        } catch (e: any) {
            alert(e.response?.data?.detail || "Failed to confirm")
        }
    }
    async function handleAppointmentStatusUpdate(apt: Appointment, status: AppointmentStatus) {
        try {
            await AppointmentService.update(apt.id, { status })
            refreshAppointments()
        } catch (e: any) {
            alert(e.response?.data?.detail || "Failed to update status")
        }
    }
    async function handleAppointmentCancel(apt: Appointment) {
        try {
            await AppointmentService.update(apt.id, { status: "cancelled" })
            refreshAppointments()
        } catch (e: any) {
            alert(e.response?.data?.detail || "Failed to cancel")
        }
    }
    async function handleAppointmentNoShow(apt: Appointment) {
        try {
            await AppointmentService.complete(apt.id, { status: "no_show" })
            refreshAppointments()
        } catch (e: any) {
            alert(e.response?.data?.detail || "Failed to mark no show")
        }
    }

    React.useEffect(() => {
        fetchLead()
        fetchActivities()
        fetchShowroomStatus()
        fetchLeadAppointmentsAndFollowUps()
    }, [fetchLead, fetchActivities, fetchShowroomStatus, fetchLeadAppointmentsAndFollowUps])

    // Pending credit app: most recent credit-app activity is "initiated" (not completed/abandoned)
    const hasPendingCreditApp = React.useMemo(() => {
        const creditTypes = ["credit_app_initiated", "credit_app_completed", "credit_app_abandoned"] as const
        const creditActivities = activities
            .filter((a) => creditTypes.includes(a.type as typeof creditTypes[number]))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        const latest = creditActivities[0]
        return latest?.type === "credit_app_initiated"
    }, [activities])

    React.useEffect(() => {
        LeadStageService.list().then(setStages).catch(console.error)
    }, [])

    const fetchStipsCategoriesAndStatus = React.useCallback(async () => {
        if (!leadId) return
        try {
            const [statusRes, categoriesRes] = await Promise.all([
                StipsService.getStatus(),
                StipsService.listCategories(),
            ])
            setStipsConfigured(statusRes.configured)
            setStipsCategories(categoriesRes)
            setActiveStipsCategoryId((prev) =>
                categoriesRes.length === 0 ? null : (prev && categoriesRes.some((c) => c.id === prev) ? prev : categoriesRes[0].id)
            )
        } catch {
            setStipsCategories([])
            setStipsConfigured(false)
        }
    }, [leadId])

    const fetchStipsDocuments = React.useCallback(async () => {
        if (!leadId) return
        setStipsLoading(true)
        try {
            const list = await StipsService.listDocuments(leadId, activeStipsCategoryId ?? undefined)
            setStipsDocuments(list)
        } catch {
            setStipsDocuments([])
        } finally {
            setStipsLoading(false)
        }
    }, [leadId, activeStipsCategoryId])

    React.useEffect(() => {
        if (leadId && activeActivityTab === "stips") {
            fetchStipsCategoriesAndStatus()
        }
    }, [leadId, activeActivityTab, fetchStipsCategoriesAndStatus])

    React.useEffect(() => {
        if (leadId && activeActivityTab === "stips") {
            fetchStipsDocuments()
        }
    }, [leadId, activeActivityTab, activeStipsCategoryId, fetchStipsDocuments])

    const handleExport = React.useCallback(async () => {
        if (!leadId || !lead) return
        setExportLoading(true)
        setExportProgress(0)
        setExportStatus("Fetching activities…")
        toast({ title: "Preparing export…", description: "Gathering activities, notes, and documents." })
        try {
            const zip = new JSZip()
            const leadName = (lead as any).customer
                ? `${(lead as any).customer.first_name || ""} ${(lead as any).customer.last_name || ""}`.trim() || "Lead"
                : "Lead"
            const safeLeadName = leadName.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "Lead"

            // Fetch all activities for export (paginate so we get full timeline and all notes)
            let allActivities: Activity[] = []
            let page = 1
            const pageSize = 100
            while (true) {
                const res = await ActivityService.getLeadTimeline(leadId, { page, page_size: pageSize })
                allActivities = allActivities.concat(res.items)
                if (res.items.length < pageSize || allActivities.length >= res.total) break
                page += 1
            }
            allActivities.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            setExportProgress(20)
            setExportStatus("Building README…")

            const taxIdActivity = allActivities.find(
                (a) => a.type === "credit_app_completed" && (a.meta_data as Record<string, unknown>)?.tax_id
            )
            const taxId = taxIdActivity
                ? String((taxIdActivity.meta_data as Record<string, unknown>).tax_id)
                : null

            const getActivityLabel = (type: string) => (ACTIVITY_TYPE_INFO as Record<string, { label: string }>)[type]?.label ?? type
            const getAuthor = (a: Activity) => a.user ? `${a.user.first_name} ${a.user.last_name}`.trim() : "System"
            const getNoteContent = (a: Activity) => String((a.meta_data as Record<string, unknown>)?.content ?? a.description ?? "").trim()

            let readme = `# Lead: ${leadName}\n\n`
            if (taxId) {
                readme += `## Tax ID\n\n${taxId}\n\n`
            }

            const creditAppActivities = allActivities.filter(
                (a) => a.type === "credit_app_initiated" || a.type === "credit_app_completed" || a.type === "credit_app_abandoned"
            )
            if (creditAppActivities.length > 0) {
                readme += `## Credit Application\n\n`
                creditAppActivities.forEach((a) => {
                    const date = a.created_at ? format(new Date(a.created_at), "yyyy-MM-dd HH:mm") : ""
                    readme += `- **${getActivityLabel(a.type)}** — ${date} — ${getAuthor(a)}\n`
                    readme += `  ${a.description || ""}\n`
                    const meta = (a.meta_data || {}) as Record<string, unknown>
                    if (a.type === "credit_app_completed") {
                        if (meta.application_id) readme += `  Application ID: ${meta.application_id}\n`
                        if (meta.form_id) readme += `  Form ID: ${meta.form_id}\n`
                        if (meta.tax_id) readme += `  Tax ID: ${meta.tax_id}\n`
                    } else if (a.type === "credit_app_abandoned" && meta.reason) {
                        readme += `  Reason: ${meta.reason}\n`
                    }
                    readme += `\n`
                })
            }

            readme += `## Activity Timeline\n\n`
            allActivities.forEach((a) => {
                const date = a.created_at ? format(new Date(a.created_at), "yyyy-MM-dd HH:mm") : ""
                readme += `- **${getActivityLabel(a.type)}** — ${date} — ${getAuthor(a)}\n`
                readme += `  ${a.description || ""}\n`
                if (a.type === "note_added") {
                    const content = getNoteContent(a)
                    if (content) readme += `  ${content}\n`
                }
                readme += `\n`
            })

            const allNotes = allActivities.filter((a) => a.type === "note_added")
            const parentNotes = allNotes
                .filter((n) => !n.parent_id)
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            const repliesMap = allNotes.reduce((acc, note) => {
                if (note.parent_id) {
                    if (!acc[note.parent_id]) acc[note.parent_id] = []
                    acc[note.parent_id].push(note)
                }
                return acc
            }, {} as Record<string, Activity[]>)
            Object.keys(repliesMap).forEach((parentId) => {
                repliesMap[parentId].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            })

            readme += `## Notes\n\n`
            if (parentNotes.length === 0) {
                readme += `No notes.\n`
            } else {
                parentNotes.forEach((note) => {
                    const author = getAuthor(note)
                    const content = getNoteContent(note)
                    const date = note.created_at ? format(new Date(note.created_at), "yyyy-MM-dd HH:mm") : ""
                    readme += `### ${date} — ${author}\n\n${content || "(no content)"}\n\n`
                    const replies = repliesMap[note.id] || []
                    replies.forEach((reply) => {
                        const replyAuthor = getAuthor(reply)
                        const replyContent = getNoteContent(reply)
                        const replyDate = reply.created_at ? format(new Date(reply.created_at), "yyyy-MM-dd HH:mm") : ""
                        readme += `  - **${replyDate} — ${replyAuthor}:** ${replyContent || "(no content)"}\n`
                    })
                    if (replies.length) readme += `\n`
                })
            }
            zip.file("README.md", readme)
            setExportProgress(40)
            setExportStatus("Loading document list…")

            const allDocs = await StipsService.listDocuments(leadId)
            setExportProgress(45)
            const byCategory = allDocs.reduce((acc, doc) => {
                const cat = doc.category_name || "Documents"
                const safe = cat.replace(/[<>:"/\\|?*]/g, "_").trim() || "Documents"
                if (!acc[safe]) acc[safe] = []
                acc[safe].push(doc)
                return acc
            }, {} as Record<string, StipDocument[]>)

            type DocTask = { folderName: string; doc: StipDocument; fileName: string }
            const tasks: DocTask[] = []
            for (const [folderName, docs] of Object.entries(byCategory)) {
                const usedNames = new Set<string>()
                for (const doc of docs) {
                    let fileName = doc.file_name || "document"
                    if (usedNames.has(fileName)) {
                        const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
                        const base = ext ? fileName.slice(0, -ext.length) : fileName
                        let n = 1
                        while (usedNames.has(fileName)) {
                            fileName = base + " (" + String(n) + ")" + ext
                            n += 1
                        }
                    }
                    usedNames.add(fileName)
                    tasks.push({ folderName, doc, fileName })
                }
            }

            const totalDocs = tasks.length
            const CONCURRENCY = 8
            let completed = 0
            const updateProgress = () => {
                completed += 1
                setExportStatus(`Downloading documents (${completed}/${totalDocs})…`)
                setExportProgress(totalDocs > 0 ? 45 + Math.round((50 * completed) / totalDocs) : 95)
            }

            const runOne = async (task: DocTask) => {
                try {
                    const buf = await StipsService.downloadDocument(leadId, task.doc.id)
                    zip.file(`${task.folderName}/${task.fileName}`, buf)
                } catch {
                    zip.file(`${task.folderName}/${task.fileName}`, "[download failed]")
                }
                updateProgress()
            }

            const queue = [...tasks]
            const worker = async () => {
                while (queue.length > 0) {
                    const task = queue.shift()
                    if (task) await runOne(task)
                }
            }
            await Promise.all(
                Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker())
            )

            setExportProgress(95)
            setExportStatus("Generating ZIP…")
            const blob = await zip.generateAsync({ type: "blob" })
            setExportProgress(100)
            setExportStatus("Done")
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${safeLeadName}-export-${format(new Date(), "yyyy-MM-dd")}.zip`
            a.click()
            URL.revokeObjectURL(url)
            toast({ title: "Export ready", description: "ZIP file has been downloaded." })
        } catch (e) {
            console.error(e)
            const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "Export failed"
            toast({ title: "Export failed", description: msg, variant: "destructive" })
        } finally {
            setExportLoading(false)
            setExportProgress(0)
            setExportStatus("")
        }
    }, [leadId, lead, activities, toast])

    const handleExportPdf = React.useCallback(async () => {
        if (!leadId || !lead) return
        setExportLoading(true)
        setExportProgress(0)
        setExportStatus("Fetching activities…")
        toast({ title: "Preparing PDF export…", description: "Gathering lead info, notes, and documents." })
        try {
            const leadName = getLeadFullName(lead)
            const safeLeadName = leadName.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "Lead"

            let allActivities: Activity[] = []
            let page = 1
            const pageSize = 100
            while (true) {
                const res = await ActivityService.getLeadTimeline(leadId, { page, page_size: pageSize })
                allActivities = allActivities.concat(res.items)
                if (res.items.length < pageSize || allActivities.length >= res.total) break
                page += 1
            }
            allActivities.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            setExportProgress(20)
            setExportStatus("Building PDF…")

            const taxIdActivity = allActivities.find(
                (a) => a.type === "credit_app_completed" && (a.meta_data as Record<string, unknown>)?.tax_id
            )
            const taxId = taxIdActivity
                ? String((taxIdActivity.meta_data as Record<string, unknown>).tax_id)
                : null
            const getAuthor = (a: Activity) => a.user ? `${a.user.first_name} ${a.user.last_name}`.trim() : "System"
            const getNoteContent = (a: Activity) => String((a.meta_data as Record<string, unknown>)?.content ?? a.description ?? "").trim()
            const getActivityLabel = (type: string) => (ACTIVITY_TYPE_INFO as Record<string, { label: string }>)[type]?.label ?? type
            const creditAppActivities = allActivities.filter(
                (a) => a.type === "credit_app_initiated" || a.type === "credit_app_completed" || a.type === "credit_app_abandoned"
            )
            const allNotes = allActivities.filter((a) => a.type === "note_added")
            const parentNotes = allNotes
                .filter((n) => !n.parent_id)
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            const repliesMap = allNotes.reduce((acc, note) => {
                if (note.parent_id) {
                    if (!acc[note.parent_id]) acc[note.parent_id] = []
                    acc[note.parent_id].push(note)
                }
                return acc
            }, {} as Record<string, Activity[]>)
            Object.keys(repliesMap).forEach((parentId) => {
                repliesMap[parentId].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            })

            setExportProgress(40)
            setExportStatus("Loading document list…")
            const allDocs = await StipsService.listDocuments(leadId)
            setExportProgress(45)

            type DocWithUrl = StipDocument & { viewUrl?: string }
            const docsWithUrls: DocWithUrl[] = []
            const totalDocs = allDocs.length
            const CONCURRENCY = 8
            let completed = 0
            const queue = [...allDocs]
            const worker = async () => {
                while (queue.length > 0) {
                    const doc = queue.shift()
                    if (!doc) continue
                    try {
                        const { url } = await StipsService.getViewUrl(leadId, doc.id)
                        docsWithUrls.push({ ...doc, viewUrl: url })
                    } catch {
                        docsWithUrls.push({ ...doc, viewUrl: "" })
                    }
                    completed += 1
                    setExportStatus(`Getting document links (${completed}/${totalDocs})…`)
                    setExportProgress(totalDocs > 0 ? 45 + Math.round((50 * completed) / totalDocs) : 95)
                }
            }
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalDocs) }, () => worker()))

            setExportProgress(95)
            setExportStatus("Generating PDF…")
            const doc = new jsPDF({ format: "a4", unit: "mm" })
            const margin = 14
            const pageW = 210
            const pageH = 297
            let y = margin
            const lineH = 6
            const headH = 8
            const primaryBlue = [37, 99, 235] as [number, number, number]
            const white = [255, 255, 255] as [number, number, number]
            const bodyText = [30, 30, 30] as [number, number, number]
            const mutedBg = [248, 250, 252] as [number, number, number]
            const borderGray = [226, 232, 240] as [number, number, number]
            const mutedText = [100, 116, 139] as [number, number, number]
            const titleSize = 20
            const sectionSize = 14
            const subsectionSize = 11
            const bodySize = 10
            const smallSize = 9
            const sectionGap = 12
            const blockPadding = 8
            const cardPadding = 6
            const labelWidth = 50
            let currentPage = 1

            const drawFooter = () => {
                const yFooter = pageH - 10
                doc.setDrawColor(...borderGray)
                doc.setLineWidth(0.3)
                doc.line(margin, yFooter - 2, pageW - margin, yFooter - 2)
                doc.setFontSize(smallSize)
                doc.setTextColor(...mutedText)
                doc.text("Leeds CRM — Lead export", margin, yFooter + 2)
                doc.text(`Page ${currentPage}`, pageW - margin, yFooter + 2, { align: "right" })
            }

            const ensureSpace = (requiredMm: number) => {
                if (y + requiredMm > pageH - margin - 15) {
                    drawFooter()
                    doc.addPage()
                    currentPage += 1
                    y = margin
                }
            }

            const drawHorizontalLine = (yPos: number) => {
                doc.setDrawColor(...borderGray)
                doc.setLineWidth(0.3)
                doc.line(margin, yPos, pageW - margin, yPos)
            }

            const drawSectionHeader = (title: string, num?: number) => {
                ensureSpace(sectionGap + headH + 6)
                const leftBarW = 3
                const barHeight = 7
                doc.setFillColor(...primaryBlue)
                doc.rect(margin, y, leftBarW, barHeight, "F")
                doc.setTextColor(...primaryBlue)
                doc.setFontSize(sectionSize)
                doc.setFont("helvetica", "bold")
                const headerText = num != null ? `${num}. ${title}` : title
                doc.text(headerText, margin + leftBarW + 5, y + barHeight * 0.72)
                doc.setFont("helvetica", "normal")
                y += barHeight + sectionGap
            }

            const drawSubsectionHeader = (title: string) => {
                ensureSpace(lineH + 4)
                doc.setFillColor(...primaryBlue)
                doc.rect(margin, y, 2, subsectionSize * 0.4, "F")
                doc.setTextColor(...primaryBlue)
                doc.setFontSize(subsectionSize)
                doc.setFont("helvetica", "bold")
                doc.text(title, margin + 5, y + subsectionSize * 0.35)
                doc.setFont("helvetica", "normal")
                y += lineH + 4
            }

            const drawCard = (estimatedHeightMm: number, drawContent: () => void) => {
                const cardY = y
                ensureSpace(estimatedHeightMm)
                doc.setFillColor(...mutedBg)
                doc.rect(margin, cardY, pageW - 2 * margin, estimatedHeightMm, "F")
                y = cardY + cardPadding
                drawContent()
                y += cardPadding
                const cardH = y - cardY
                doc.setDrawColor(...borderGray)
                doc.setLineWidth(0.2)
                doc.rect(margin, cardY, pageW - 2 * margin, cardH, "S")
            }

            const addText = (text: string, fontSize?: number, color?: [number, number, number]) => {
                doc.setTextColor(...(color ?? bodyText))
                if (fontSize) doc.setFontSize(fontSize)
                const lines = doc.splitTextToSize(text, pageW - 2 * margin)
                for (const line of lines) {
                    ensureSpace(lineH)
                    doc.text(line, margin, y)
                    y += lineH
                }
                if (fontSize) doc.setFontSize(bodySize)
            }

            const addLabelValue = (label: string, value: string) => {
                ensureSpace(lineH)
                doc.setFontSize(bodySize)
                doc.setTextColor(...mutedText)
                doc.setFont("helvetica", "bold")
                doc.text(`${label}:`, margin, y)
                doc.setFont("helvetica", "normal")
                doc.setTextColor(...bodyText)
                const valueLines = doc.splitTextToSize(value || "—", pageW - 2 * margin - labelWidth - 4)
                doc.text(valueLines[0], margin + labelWidth, y)
                y += lineH
                for (let i = 1; i < valueLines.length; i++) {
                    ensureSpace(lineH)
                    doc.text(valueLines[i], margin + labelWidth, y)
                    y += lineH
                }
            }

            ensureSpace(35)
            doc.setFillColor(...primaryBlue)
            doc.rect(0, 0, pageW, 6, "F")
            y = 10
            doc.setTextColor(...primaryBlue)
            doc.setFontSize(titleSize)
            doc.setFont("helvetica", "bold")
            doc.text(leadName, margin, y)
            doc.setFont("helvetica", "normal")
            y += lineH + 2
            doc.setFontSize(smallSize)
            doc.setTextColor(...mutedText)
            doc.text("Lead export", margin, y)
            y += lineH
            doc.text(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`, margin, y)
            y += lineH + 4
            drawHorizontalLine(y)
            y += sectionGap

            drawSectionHeader("Lead details", 1)
            const sec = (lead as Lead).secondary_customer
            const firstContact = (lead as Lead).first_contacted_at
            const lastContact = (lead as Lead).last_contacted_at
            const assigned = (lead as Lead).assigned_to_user
            const dealership = (lead as Lead).dealership?.name
            ensureSpace(95)
            const leadFields: { label: string; value: string }[] = [
                { label: "Lead", value: leadName },
                { label: "Phone", value: getLeadPhone(lead) ?? "" },
                { label: "Email", value: getLeadEmail(lead) ?? "" },
                { label: "Secondary", value: sec ? [sec.first_name, sec.last_name].filter(Boolean).join(" ") : "" },
                { label: "Stage", value: (lead as Lead).stage?.name ?? "" },
                { label: "Source", value: (lead as Lead).source ?? "" },
                { label: "Created", value: (lead as Lead).created_at ? format(new Date((lead as Lead).created_at), "yyyy-MM-dd HH:mm") : "" },
                { label: "First contacted", value: firstContact ? format(new Date(firstContact), "yyyy-MM-dd HH:mm") : "" },
                { label: "Last contacted", value: lastContact ? format(new Date(lastContact), "yyyy-MM-dd HH:mm") : "" },
                { label: "Assigned to", value: assigned ? `${assigned.first_name} ${assigned.last_name}` : "" },
                { label: "Dealership", value: dealership ?? "" },
                { label: "Tax ID", value: taxId ?? "" },
            ]
            const leadCardHeight = Math.max(90, leadFields.length * lineH * 2 + 2 * cardPadding)
            drawCard(leadCardHeight, () => {
                leadFields.forEach(({ label, value }) => addLabelValue(label, value))
            })
            drawHorizontalLine(y)
            y += sectionGap

            drawSectionHeader("Notes", 2)
            drawSubsectionHeader("2.1 Credit application notes")
            doc.setFontSize(bodySize)

            if (creditAppActivities.length > 0) {
                creditAppActivities.forEach((a) => {
                    ensureSpace(28)
                    const cardStartY = y
                    const date = a.created_at ? format(new Date(a.created_at), "yyyy-MM-dd HH:mm") : ""
                    const author = getAuthor(a)
                    const label = getActivityLabel(a.type)
                    doc.setTextColor(...bodyText)
                    doc.setFontSize(bodySize)
                    doc.text(`${date} — ${author} — ${label}`, margin + 6, y + 4)
                    y += lineH
                    doc.text(a.description || "", margin + 6, y + 4)
                    y += lineH
                    const meta = (a.meta_data || {}) as Record<string, unknown>
                    if (a.type === "credit_app_completed") {
                        if (meta.application_id) { doc.text(`Application ID: ${String(meta.application_id)}`, margin + 6, y + 4); y += lineH }
                        if (meta.form_id) { doc.text(`Form ID: ${String(meta.form_id)}`, margin + 6, y + 4); y += lineH }
                        if (meta.tax_id) { doc.text(`Tax ID: ${String(meta.tax_id)}`, margin + 6, y + 4); y += lineH }
                    } else if (a.type === "credit_app_abandoned" && meta.reason) {
                        doc.text(`Reason: ${String(meta.reason)}`, margin + 6, y + 4)
                        y += lineH
                    }
                    y += 4
                    const cardH = y - cardStartY
                    doc.setFillColor(...primaryBlue)
                    doc.rect(margin, cardStartY, 2, cardH, "F")
                    doc.setDrawColor(...borderGray)
                    doc.setLineWidth(0.2)
                    doc.rect(margin, cardStartY, pageW - 2 * margin, cardH, "S")
                    y += blockPadding
                })
            } else {
                doc.setTextColor(...mutedText)
                addText("No credit application notes.")
                y += blockPadding
            }

            drawSubsectionHeader("2.2 Activity notes")
            doc.setFontSize(bodySize)

            if (parentNotes.length === 0) {
                doc.setTextColor(...mutedText)
                addText("No activity notes.")
            } else {
                parentNotes.forEach((note) => {
                    ensureSpace(35)
                    const cardStartY = y
                    const author = getAuthor(note)
                    const content = getNoteContent(note)
                    const date = note.created_at ? format(new Date(note.created_at), "yyyy-MM-dd HH:mm") : ""
                    doc.setTextColor(...bodyText)
                    doc.setFontSize(bodySize)
                    doc.text(`${date} — ${author}`, margin + 6, y + 4)
                    y += lineH
                    const contentLines = doc.splitTextToSize(content || "(no content)", pageW - 2 * margin - 8)
                    contentLines.forEach((line: string) => { doc.text(line, margin + 6, y + 4); y += lineH })
                    const replies = repliesMap[note.id] || []
                    replies.forEach((reply) => {
                        const replyAuthor = getAuthor(reply)
                        const replyContent = getNoteContent(reply)
                        const replyDate = reply.created_at ? format(new Date(reply.created_at), "yyyy-MM-dd HH:mm") : ""
                        const replyLines = doc.splitTextToSize(`Reply ${replyDate} — ${replyAuthor}: ${replyContent || "(no content)"}`, pageW - 2 * margin - 12)
                        replyLines.forEach((line: string) => { doc.text(`  ${line}`, margin + 6, y + 4); y += lineH })
                    })
                    y += 4
                    const cardH = y - cardStartY
                    doc.setFillColor(...primaryBlue)
                    doc.rect(margin, cardStartY, 2, cardH, "F")
                    doc.setDrawColor(...borderGray)
                    doc.setLineWidth(0.2)
                    doc.rect(margin, cardStartY, pageW - 2 * margin, cardH, "S")
                    y += blockPadding
                })
            }
            y += sectionGap
            drawHorizontalLine(y)
            y += sectionGap

            drawSectionHeader("Documents", 3)
            const byCategory = docsWithUrls.reduce((acc, d) => {
                const cat = d.category_name || "Documents"
                if (!acc[cat]) acc[cat] = []
                acc[cat].push(d)
                return acc
            }, {} as Record<string, DocWithUrl[]>)

            for (const [categoryName, docs] of Object.entries(byCategory)) {
                ensureSpace(40)
                drawSubsectionHeader(categoryName)
                doc.setTextColor(...bodyText)
                const tableBody = docs.map((d, i) => [
                    i + 1,
                    d.file_name || "document",
                    d.uploaded_by_name ?? "—",
                    "Open document",
                ])
                const linkColumnIndex = 3
                autoTable(doc, {
                    startY: y,
                    head: [["S. No.", "Document name", "Uploaded by", "Open document"]],
                    body: tableBody,
                    margin: { left: margin },
                    styles: { fontSize: smallSize, cellPadding: 4 },
                    headStyles: { fillColor: primaryBlue, textColor: white },
                    alternateRowStyles: { fillColor: mutedBg },
                    columnStyles: {
                        0: { cellWidth: 16 },
                        3: { cellWidth: 28 },
                    },
                    didDrawCell: (data) => {
                        if (data.section === "body" && data.column.index === linkColumnIndex) {
                            const rowIndex = data.row.index
                            const viewUrl = docs[rowIndex]?.viewUrl
                            if (viewUrl && typeof viewUrl === "string") {
                                doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: viewUrl })
                            }
                        }
                    },
                })
                const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
                y = (lastTable?.finalY ?? y) + 10
            }

            drawFooter()
            setExportProgress(100)
            setExportStatus("Done")
            doc.save(`${safeLeadName}-${format(new Date(), "yyyy-MM-dd")}.pdf`)
            toast({ title: "Export ready", description: "PDF has been downloaded." })
        } catch (e) {
            console.error("PDF export failed:", e)
            const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "Export failed"
            toast({ title: "Export failed", description: `${msg} Check console for details.`, variant: "destructive" })
        } finally {
            setExportLoading(false)
            setExportProgress(0)
            setExportStatus("")
        }
    }, [leadId, lead, toast])

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
            console.log("Received new activity via WebSocket:", data)
            
            // Get activity type from either nested or root level
            const activityType = data.activity?.type || data.type
            
            // Check if this is an assignment activity that might change Lead Context
            const assignmentTypes = ["lead_assigned", "lead_reassigned"]
            if (assignmentTypes.includes(activityType)) {
                // Refresh both activities and lead data for assignment changes
                fetchActivities()
                fetchLead()
            } else {
                // For all other activities, refetch the activities to get the full data
                // This ensures we always have the complete activity with proper formatting
                fetchActivities()
            }
        }
    }, [leadId, fetchActivities, fetchLead])
    
    useActivityEvents(leadId, handleNewActivity)

    const onStatusSelect = (newStatus: string) => {
        if (!lead) return
        if (newStatus === "lost") {
            setShowLostReasonModal(true)
            return
        }
        const stage = stages.find((s) => s.name === newStatus)
        if (stage?.is_terminal) {
            setPendingStageForNotes(newStatus)
            setStageNotes("")
            setShowStageNotesModal(true)
            return
        }
        handleStatusChange(newStatus)
    }

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
                setLead(result as Lead)
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

    const handleConfirmStageNotes = async () => {
        if (pendingStageForNotes == null) return
        await handleStatusChange(pendingStageForNotes, stageNotes.trim() || undefined)
        setShowStageNotesModal(false)
        setPendingStageForNotes(null)
        setStageNotes("")
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
            const message = err instanceof Error ? err.message : String(err)
            console.error("Failed to add note:", message)
            const isNetworkError = message === "Network Error" || (err as any)?.code === "ERR_NETWORK"
            const detail = (err as any)?.response?.data?.detail
            const userMessage = isNetworkError
                ? "Could not reach the server. Make sure the backend is running (e.g. uvicorn on http://localhost:8000)."
                : typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? String(d)).join(" ") : message
            alert(typeof userMessage === "string" ? userMessage : "Failed to add note")
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
    
    const handleEditStart = () => {
        if (!lead) return
        setEditForm({
            first_name: lead.customer?.first_name || "",
            last_name: lead.customer?.last_name || "",
            email: lead.customer?.email || "",
            phone: lead.customer?.phone || "",
            alternate_phone: (lead as any).customer?.alternate_phone || "",
            address: (lead as any).customer?.address || "",
            city: (lead as any).customer?.city || "",
            state: (lead as any).customer?.state || "",
            postal_code: (lead as any).customer?.postal_code || "",
            country: (lead as any).customer?.country || "",
            company: (lead as any).customer?.company || "",
            job_title: (lead as any).customer?.job_title || "",
            date_of_birth: (lead as any).customer?.date_of_birth ? String((lead as any).customer.date_of_birth).split("T")[0] : "",
            preferred_contact_method: (lead as any).customer?.preferred_contact_method || "",
            preferred_contact_time: (lead as any).customer?.preferred_contact_time || "",
            interested_in: lead.interested_in || "",
            budget_range: lead.budget_range || "",
            notes: lead.notes || "",
        })
        setIsEditingDetails(true)
    }
    
    const handleCancelEdit = () => {
        setIsEditingDetails(false)
    }
    
    const handleSaveDetails = async () => {
        if (!lead) return
        setIsSavingDetails(true)
        try {
            const updateData: Partial<typeof editForm> = {}
            // Only include fields that changed
            if (editForm.first_name !== (lead.customer?.first_name || "")) updateData.first_name = editForm.first_name
            if (editForm.last_name !== (lead.customer?.last_name || "")) updateData.last_name = editForm.last_name || undefined
            if (editForm.email !== (lead.customer?.email || "")) updateData.email = editForm.email || undefined
            if (editForm.phone !== (lead.customer?.phone || "")) updateData.phone = editForm.phone || undefined
            const _c = lead.customer as any || {}
            if (editForm.alternate_phone !== (_c.alternate_phone || "")) updateData.alternate_phone = editForm.alternate_phone || undefined
            if (editForm.address !== (_c.address || "")) updateData.address = editForm.address || undefined
            if (editForm.city !== (_c.city || "")) updateData.city = editForm.city || undefined
            if (editForm.state !== (_c.state || "")) updateData.state = editForm.state || undefined
            if (editForm.postal_code !== (_c.postal_code || "")) updateData.postal_code = editForm.postal_code || undefined
            if (editForm.country !== (_c.country || "")) updateData.country = editForm.country || undefined
            if (editForm.company !== (_c.company || "")) updateData.company = editForm.company || undefined
            if (editForm.job_title !== (_c.job_title || "")) updateData.job_title = editForm.job_title || undefined
            if (editForm.preferred_contact_method !== (_c.preferred_contact_method || "")) updateData.preferred_contact_method = editForm.preferred_contact_method || undefined
            if (editForm.preferred_contact_time !== (_c.preferred_contact_time || "")) updateData.preferred_contact_time = editForm.preferred_contact_time || undefined
            if (editForm.interested_in !== (lead.interested_in || "")) updateData.interested_in = editForm.interested_in || undefined
            if (editForm.budget_range !== (lead.budget_range || "")) updateData.budget_range = editForm.budget_range || undefined
            if (editForm.notes !== (lead.notes || "")) updateData.notes = editForm.notes || undefined
            
            if (Object.keys(updateData).length > 0) {
                await LeadService.updateLead(lead.id, updateData)
                await fetchLead()
                fetchActivities() // Refresh to show update activity
            }
            setIsEditingDetails(false)
        } catch (error) {
            console.error("Failed to update lead:", error)
        } finally {
            setIsSavingDetails(false)
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

    const isMentionOnly = lead.access_level === "mention_only"

    return (
        <div className="h-[calc(100vh-120px)] flex flex-col max-w-7xl mx-auto overflow-hidden">
            {/* Navigation */}
            <div className="flex items-center justify-between shrink-0 mb-4">
                <Link href="/leads" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors duration-200 rounded-md hover:bg-muted/50 px-2 py-1 -mx-2 -my-1">
                    <ChevronLeft className="h-4 w-4 shrink-0" />
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

            {/* In Dealership Banner */}
            {currentVisit && (
                <div className="shrink-0 rounded-lg border border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-full bg-teal-100 dark:bg-teal-900 p-2">
                            <Store className="h-5 w-5 text-teal-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-teal-800 dark:text-teal-200">Customer is in Dealership</p>
                            <p className="text-sm text-teal-600 dark:text-teal-400">
                                Checked in at {new Date(currentVisit.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    </div>
                    <Button 
                        variant="outline" 
                        className="border-teal-300 text-teal-700 hover:bg-teal-100"
                        onClick={() => setShowCheckOutModal(true)}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Check Out
                    </Button>
                </div>
            )}

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0 overflow-hidden">
                {/* Left Column: Profile & Info */}
                <div className="lg:col-span-1 space-y-6 overflow-y-auto">
                    {/* Profile Card */}
                    <Card className="overflow-hidden border-border/80 shadow-sm transition-shadow duration-200 hover:shadow-md">
                        <CardContent className="p-6">
                        <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold mb-4 ring-2 ring-primary/5 transition-transform duration-200 hover:scale-105">
                                    {(lead.customer?.first_name || "?").charAt(0)}
                            </div>
                                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                    {getLeadFullName(lead)}
                                </h1>
                                
                                {/* Status Selector - hidden for mention-only access */}
                                {!isMentionOnly && (
                                <div className="mt-3 w-full max-w-xs">
                                    <Select 
                                        value={lead.stage?.name || ""} 
                                        onValueChange={onStatusSelect}
                                        disabled={isUpdatingStatus}
                                    >
                                        <SelectTrigger className="w-full bg-white border-input hover:bg-muted/50 transition-colors duration-200 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                {isUpdatingStatus && <Loader2 className="h-4 w-4 animate-spin" />}
                                                <Badge size="sm" variant={getStatusVariant(lead.stage?.name ?? "")}>
                                                    {getStageLabel(lead.stage)}
                                                </Badge>
                            </div>
                                        </SelectTrigger>
                                        <SelectContent
                                            className="bg-white shadow-lg max-h-[420px]"
                                            viewportClassName="!h-auto !max-h-[420px]"
                                        >
                                            {stages
                                                .filter((stage) => {
                                                    if (STAGES_HIDDEN_FROM_STATUS_UI.includes(stage.name)) return false
                                                    if (isSalesperson && (stage.name === "lost" || stage.name === "converted" || stage.name === "qualified" || stage.name === "couldnt_qualify")) return false
                                                    return true
                                                })
                                                .map((stage) => (
                                                <SelectItem key={stage.id} value={stage.name}>
                                                    <div className="flex items-center gap-2">
                                                        <Badge size="sm" variant={getStatusVariant(stage.name)}>
                                                            {getStageLabel(stage)}
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
                                <div className="flex flex-col gap-3 mt-6 w-full">
                                    {getLeadPhone(lead) && (
                                        <div className="grid grid-cols-2 gap-2 w-full">
                                            <Button
                                                variant="outline"
                                                className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                                onClick={handleCallClick}
                                                title={voiceEnabled ? "Call in app" : "Call this lead"}
                                            >
                                                <Phone className="h-4 w-4 mr-2 shrink-0" />
                                                <span className="whitespace-nowrap">Call</span>
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                                onClick={() => setShowCallTextComingSoon(true)}
                                                title="Text this lead"
                                            >
                                                <MessageSquare className="h-4 w-4 mr-2 shrink-0" />
                                                <span className="whitespace-nowrap">Text</span>
                                            </Button>
                                        </div>
                                    )}
                                    {getLeadEmail(lead) && (
                                        <Button
                                            variant="outline"
                                            className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                            onClick={() => setShowEmailComposer(true)}
                                        >
                                            <Mail className="h-4 w-4 mr-2 shrink-0" />
                                            <span className="whitespace-nowrap">Email</span>
                                        </Button>
                                    )}
                                    {!hasPendingCreditApp && (
                                        <Button 
                                            variant="outline" 
                                            className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                            title="Initiate credit application (opens Toyota South Atlanta)"
                                            disabled={isInitiatingCreditApp}
                                            onClick={() => {
                                                setIsInitiatingCreditApp(true)
                                                LeadService.creditAppInitiate(lead.id)
                                                    .then((r) => {
                                                        if (r?.redirect_url) window.open(r.redirect_url, "_blank")
                                                        return Promise.all([fetchLead(), fetchActivities()])
                                                    })
                                                    .catch((e) => console.error(e))
                                                    .finally(() => setIsInitiatingCreditApp(false))
                                            }}
                                        >
                                            {isInitiatingCreditApp ? <Loader2 className="h-4 w-4 mr-2 shrink-0 animate-spin text-teal-500" /> : <FileText className="h-4 w-4 mr-2 shrink-0 text-teal-500" />}
                                            Initiate Credit App
                                        </Button>
                                    )}
                                    {hasPendingCreditApp && (
                                        <Button 
                                            variant="outline"
                                            className="w-full h-10 rounded-lg border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all duration-200 hover:shadow-sm active:scale-[0.99]"
                                            onClick={() => setShowCreditAppOutcomeModal(true)}
                                        >
                                            <CheckCircle className="h-4 w-4 mr-2 shrink-0" />
                                            Capture Credit App Outcome
                                        </Button>
                                    )}
                                    <Button 
                                        variant="outline" 
                                        className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                        onClick={() => setShowScheduleFollowUp(true)}
                                    >
                                        <Calendar className="h-4 w-4 mr-2 shrink-0" />
                                        Schedule Follow-up
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                        onClick={() => setShowBookAppointment(true)}
                                    >
                                        <CalendarClock className="h-4 w-4 mr-2 shrink-0" />
                                        Book Appointment
                                    </Button>
                                    {currentVisit ? (
                                        <Button 
                                            variant="outline"
                                            className="w-full h-10 rounded-lg bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100 transition-all duration-200 hover:shadow-sm active:scale-[0.99]"
                                            onClick={() => setShowCheckOutModal(true)}
                                        >
                                            <LogOut className="h-4 w-4 mr-2 shrink-0" />
                                            Check Out of Dealership
                                        </Button>
                                    ) : (
                                        <Button 
                                            variant="outline" 
                                            className="w-full h-10 rounded-lg transition-all duration-200 hover:shadow-sm hover:bg-muted/50 active:scale-[0.99]"
                                            onClick={handleCheckIn}
                                            disabled={isCheckingIn || !lead.dealership_id}
                                            title={!lead.dealership_id ? "Assign this lead to a dealership first (Edit lead or assign from Unassigned Pool)." : undefined}
                                        >
                                            {isCheckingIn ? (
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
                                            ) : (
                                                <Store className="h-4 w-4 mr-2 text-teal-500 shrink-0" />
                                            )}
                                            Check In to Dealership
                                        </Button>
                                    )}
                                </div>
                                )}
                            </div>

                            {/* Contact Details */}
                            <div className="mt-8 space-y-4 pt-6 border-t border-border/60">
                                {getLeadEmail(lead) && (
                            <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Mail className="h-4 w-4" /> Email
                                        </span>
                                        <span className="font-medium">{getLeadEmail(lead)}</span>
                            </div>
                                )}
                                {getLeadPhone(lead) && (
                            <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Phone className="h-4 w-4" /> Phone
                                        </span>
                                        <span className="font-medium">{getLeadPhone(lead)}</span>
                            </div>
                                )}
                                {(lead as any).customer?.alternate_phone && (
                            <div className="flex justify-between items-center text-sm">
                                        <span className="text-muted-foreground flex items-center gap-2">
                                            <Phone className="h-4 w-4" /> Alt. Phone
                                        </span>
                                        <span className="font-medium">{(lead as any).customer?.alternate_phone}</span>
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
                    <Card className="overflow-hidden border-border/80 shadow-sm transition-shadow duration-200 hover:shadow-md">
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-primary" />
                            Lead Context
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Primary customer */}
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                    Primary customer
                                </p>
                                {lead.customer ? (
                                    <Link
                                        href={`/customers/${lead.customer_id}`}
                                        className="font-medium text-sm text-primary hover:underline flex items-center gap-2"
                                    >
                                        <User className="h-4 w-4 text-primary" />
                                        {getCustomerFullName(lead.customer)}
                                    </Link>
                                ) : (
                                    <span className="text-sm text-muted-foreground">—</span>
                                )}
                                {lead.customer && (
                                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                                        {getLeadEmail(lead) && <p>{getLeadEmail(lead)}</p>}
                                        {getLeadPhone(lead) && <p>{getLeadPhone(lead)}</p>}
                            </div>
                                )}
                            </div>

                            {/* Secondary customer (optional) */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
                                        Secondary customer (optional)
                                    </p>
                                    {!isMentionOnly && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-2 text-xs"
                                            onClick={() => setShowSecondaryCustomerModal(true)}
                                        >
                                            {lead.secondary_customer ? (
                                                <span><RefreshCw className="h-3 w-3 mr-1 inline" />Change</span>
                                            ) : (
                                                <span><UserPlus className="h-3 w-3 mr-1 inline" />Add secondary customer</span>
                                            )}
                                        </Button>
                                    )}
                                </div>
                                {lead.secondary_customer ? (
                                    <div className="flex items-center gap-2 pl-1 border-l-2 border-orange-300 ml-1">
                                        <UserAvatar
                                            firstName={lead.secondary_customer.first_name}
                                            lastName={lead.secondary_customer.last_name ?? undefined}
                                            size="sm"
                                            className="bg-gradient-to-br from-orange-400 to-amber-500"
                                        />
                                        <div className="flex-1">
                                            <p className="font-medium text-sm">
                                                {getCustomerFullName(lead.secondary_customer)}
                                            </p>
                                            <div className="flex items-center gap-1">
                                                <Badge variant="outline" size="sm" className="text-[10px] border-orange-300 text-orange-600">Secondary</Badge>
                                            </div>
                                            {(lead.secondary_customer.email || lead.secondary_customer.phone) && (
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {[lead.secondary_customer.email, lead.secondary_customer.phone].filter(Boolean).join(" · ")}
                                                </p>
                                            )}
                                        </div>
                                        {!isMentionOnly && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => setShowRemoveSecondaryConfirm(true)}
                                            >
                                                Remove
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">None</p>
                                )}
                            </div>

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
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">
                                        Assigned To
                                    </p>
                                    {!isMentionOnly && (canAssignToSalesperson || isDealershipLevel || isSuperAdmin) && lead.dealership_id && (
                                        <Button 
                                            size="sm" 
                                            variant="ghost"
                                            className="h-6 px-2 text-xs"
                                            onClick={() => setShowSalespersonModal(true)}
                                        >
                                            {lead.assigned_to_user ? (
                                                <span><RefreshCw className="h-3 w-3 mr-1 inline" />Reassign</span>
                                            ) : (
                                                <span><UserPlus className="h-3 w-3 mr-1 inline" />Assign</span>
                                            )}
                                        </Button>
                                    )}
                                </div>
                                {lead.assigned_to_user ? (
                                    <div className="space-y-2">
                                        {/* Primary Salesperson */}
                                        <div className="flex items-center gap-2">
                                            <UserAvatar 
                                                firstName={lead.assigned_to_user.first_name}
                                                lastName={lead.assigned_to_user.last_name}
                                                size="sm"
                                            />
                                            <div className="flex-1">
                                                <p className="font-medium text-sm">
                                                    {lead.assigned_to_user.first_name} {lead.assigned_to_user.last_name}
                                                </p>
                                                <div className="flex items-center gap-1">
                                                    {lead.secondary_salesperson && (
                                                        <Badge variant="default" size="sm" className="text-[10px]">Primary</Badge>
                                                    )}
                                                    <Badge variant={getRoleVariant(lead.assigned_to_user.role)} size="sm">
                                                        {lead.assigned_to_user.role === 'dealership_owner' ? 'Owner' : 
                                                         lead.assigned_to_user.role === 'dealership_admin' ? 'Admin' : 
                                                         lead.assigned_to_user.role === 'salesperson' ? 'Sales' : 
                                                         lead.assigned_to_user.role.replace('_', ' ')}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>
                                        {/* Secondary Salesperson (if assigned) */}
                                        {lead.secondary_salesperson && (
                                            <div className="flex items-center gap-2 pl-1 border-l-2 border-orange-300 ml-1">
                                                <UserAvatar 
                                                    firstName={lead.secondary_salesperson.first_name}
                                                    lastName={lead.secondary_salesperson.last_name}
                                                    size="sm"
                                                    className="bg-gradient-to-br from-orange-400 to-amber-500"
                                                />
                                                <div className="flex-1">
                                                    <p className="font-medium text-sm">
                                                        {lead.secondary_salesperson.first_name} {lead.secondary_salesperson.last_name}
                                                    </p>
                                                    <div className="flex items-center gap-1">
                                                        <Badge variant="outline" size="sm" className="text-[10px] border-orange-300 text-orange-600">Secondary</Badge>
                                                        <Badge variant={getRoleVariant(lead.secondary_salesperson.role)} size="sm">
                                                            {lead.secondary_salesperson.role === 'dealership_owner' ? 'Owner' : 
                                                             lead.secondary_salesperson.role === 'dealership_admin' ? 'Admin' : 
                                                             lead.secondary_salesperson.role === 'salesperson' ? 'Sales' : 
                                                             lead.secondary_salesperson.role.replace('_', ' ')}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                                        Unassigned
                                    </Badge>
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

                            {lead.notes && !isEditingDetails && (
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                        Notes
                                    </p>
                                    <p className="text-sm text-muted-foreground">{lead.notes}</p>
                        </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Lead Details Card - Editable */}
                    <Card className="overflow-hidden border-border/80 shadow-sm transition-shadow duration-200 hover:shadow-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <User className="h-4 w-4 text-primary" />
                                Lead Details
                            </CardTitle>
                            {!isMentionOnly && !isEditingDetails && (
                                <Button 
                                    size="sm" 
                                    variant="ghost"
                                    onClick={handleEditStart}
                                >
                                    <Pencil className="h-3.5 w-3.5 mr-1" />
                                    Edit
                                </Button>
                            )}
                            {isEditingDetails && (
                                <div className="flex gap-1">
                                    <Button 
                                        size="sm" 
                                        variant="ghost"
                                        onClick={handleCancelEdit}
                                        disabled={isSavingDetails}
                                    >
                                        <X className="h-3.5 w-3.5 mr-1" />
                                        Cancel
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        onClick={handleSaveDetails}
                                        disabled={isSavingDetails}
                                    >
                                        {isSavingDetails ? (
                                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                        ) : (
                                            <Save className="h-3.5 w-3.5 mr-1" />
                                        )}
                                        Save
                                    </Button>
                                </div>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isEditingDetails ? (
                                <div className="space-y-4">
                                    {/* Contact Information */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Contact Information
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-xs">First Name *</Label>
                                                <Input
                                                    value={editForm.first_name}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, first_name: e.target.value }))}
                                                    placeholder="First name"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Last Name</Label>
                                                <Input
                                                    value={editForm.last_name}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, last_name: e.target.value }))}
                                                    placeholder="Last name"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <div>
                                                <Label className="text-xs">Email</Label>
                                                <Input
                                                    type="email"
                                                    value={editForm.email}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                                                    placeholder="Email"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Phone</Label>
                                                <Input
                                                    value={editForm.phone}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                                                    placeholder="Phone"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-2">
                                            <Label className="text-xs">Alternate Phone</Label>
                                            <Input
                                                value={editForm.alternate_phone}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, alternate_phone: e.target.value }))}
                                                placeholder="Alternate phone"
                                                className="h-8 text-sm"
                                            />
                    </div>
                </div>

                                    {/* Address */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Address
                                        </p>
                                        <div>
                                            <Label className="text-xs">Street Address</Label>
                                            <Input
                                                value={editForm.address}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                                                placeholder="Street address"
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <div>
                                                <Label className="text-xs">City</Label>
                                                <Input
                                                    value={editForm.city}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, city: e.target.value }))}
                                                    placeholder="City"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">State/Province</Label>
                                                <Input
                                                    value={editForm.state}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, state: e.target.value }))}
                                                    placeholder="State"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <div>
                                                <Label className="text-xs">Postal Code</Label>
                                                <Input
                                                    value={editForm.postal_code}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, postal_code: e.target.value }))}
                                                    placeholder="Postal code"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Country</Label>
                                                <Input
                                                    value={editForm.country}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, country: e.target.value }))}
                                                    placeholder="Country"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Work Information */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Work Information
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-xs">Company</Label>
                                                <Input
                                                    value={editForm.company}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, company: e.target.value }))}
                                                    placeholder="Company name"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Job Title</Label>
                                                <Input
                                                    value={editForm.job_title}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, job_title: e.target.value }))}
                                                    placeholder="Job title"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Preferences */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Contact Preferences
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-xs">Preferred Method</Label>
                                                <Select 
                                                    value={editForm.preferred_contact_method}
                                                    onValueChange={(value) => setEditForm(prev => ({ ...prev, preferred_contact_method: value }))}
                                                >
                                                    <SelectTrigger className="h-8 text-sm">
                                                        <SelectValue placeholder="Select..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="phone">Phone</SelectItem>
                                                        <SelectItem value="email">Email</SelectItem>
                                                        <SelectItem value="text">Text/SMS</SelectItem>
                                                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label className="text-xs">Preferred Time</Label>
                                                <Select 
                                                    value={editForm.preferred_contact_time}
                                                    onValueChange={(value) => setEditForm(prev => ({ ...prev, preferred_contact_time: value }))}
                                                >
                                                    <SelectTrigger className="h-8 text-sm">
                                                        <SelectValue placeholder="Select..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="morning">Morning (9-12)</SelectItem>
                                                        <SelectItem value="afternoon">Afternoon (12-5)</SelectItem>
                                                        <SelectItem value="evening">Evening (5-8)</SelectItem>
                                                        <SelectItem value="anytime">Anytime</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Interest */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Interest
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-xs">Interested In</Label>
                                                <Input
                                                    value={editForm.interested_in}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, interested_in: e.target.value }))}
                                                    placeholder="e.g., SUV, Sedan"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs">Budget Range</Label>
                                                <Input
                                                    value={editForm.budget_range}
                                                    onChange={(e) => setEditForm(prev => ({ ...prev, budget_range: e.target.value }))}
                                                    placeholder="e.g., $30k-$40k"
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                                            Notes
                                        </p>
                                        <Textarea
                                            value={editForm.notes}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                                            placeholder="Additional notes about this lead..."
                                            rows={3}
                                            className="text-sm"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {(() => { const _cu = (lead as any).customer || {}; return (<>
                                    {/* Display Mode - Address */}
                                    {(_cu.address || _cu.city || _cu.state || _cu.country) && (
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                                <MapPin className="inline h-3 w-3 mr-1" />
                                                Address
                                            </p>
                                            <p className="text-sm">
                                                {[_cu.address, _cu.city, _cu.state, _cu.postal_code, _cu.country]
                                                    .filter(Boolean)
                                                    .join(", ")}
                                            </p>
                                        </div>
                                    )}

                                    {/* Display Mode - Work */}
                                    {(_cu.company || _cu.job_title) && (
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                                <Briefcase className="inline h-3 w-3 mr-1" />
                                                Work
                                            </p>
                                            <p className="text-sm">
                                                {_cu.job_title && <span>{_cu.job_title}</span>}
                                                {_cu.job_title && _cu.company && <span> at </span>}
                                                {_cu.company && <span className="font-medium">{_cu.company}</span>}
                                            </p>
                                        </div>
                                    )}

                                    {/* Display Mode - Contact Preferences */}
                                    {(_cu.preferred_contact_method || _cu.preferred_contact_time) && (
                                        <div>
                                            <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
                                                Contact Preferences
                                            </p>
                                            <div className="flex gap-2 flex-wrap">
                                                {_cu.preferred_contact_method && (
                                                    <Badge variant="secondary" size="sm">
                                                        {_cu.preferred_contact_method}
                                                    </Badge>
                                                )}
                                                {_cu.preferred_contact_time && (
                                                    <Badge variant="outline" size="sm">
                                                        {_cu.preferred_contact_time}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* If no details yet, show placeholder */}
                                    {!_cu.address && !_cu.city && !_cu.company && !_cu.preferred_contact_method && (
                                        <div className="text-center py-4 text-muted-foreground">
                                            <User className="h-8 w-8 mx-auto opacity-20 mb-2" />
                                            <p className="text-sm">No additional details yet</p>
                                            {!isMentionOnly && (
                                                <Button 
                                                    size="sm" 
                                                    variant="outline"
                                                    className="mt-2"
                                                    onClick={handleEditStart}
                                                >
                                                    <Pencil className="h-3.5 w-3.5 mr-1" />
                                                    Add Details
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                    </>); })()}
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
                            {getLeadPhone(lead) && (
                                <div className="grid grid-cols-2 gap-2 w-full">
                                    <Button 
                                        className="w-full justify-start" 
                                        variant="outline"
                                        onClick={handleCallClick}
                                    >
                                        <Phone className="h-4 w-4 mr-2 text-green-500" />
                                        Call
                                    </Button>
                                    <Button 
                                        className="w-full justify-start" 
                                        variant="outline"
                                        onClick={() => setShowCallTextComingSoon(true)}
                                    >
                                        <MessageSquare className="h-4 w-4 mr-2 text-purple-500" />
                                        Text
                                    </Button>
                                </div>
                            )}
                            {!hasPendingCreditApp && (
                                <Button 
                                    className="w-full justify-start" 
                                    variant="outline"
                                    disabled={isInitiatingCreditApp}
                                    onClick={() => {
                                        setIsInitiatingCreditApp(true)
                                        LeadService.creditAppInitiate(lead.id)
                                            .then((r) => {
                                                if (r?.redirect_url) window.open(r.redirect_url, "_blank")
                                                return Promise.all([fetchLead(), fetchActivities()])
                                            })
                                            .catch((e) => console.error(e))
                                            .finally(() => setIsInitiatingCreditApp(false))
                                    }}
                                >
                                    {isInitiatingCreditApp ? <Loader2 className="h-4 w-4 mr-2 animate-spin text-teal-500" /> : <FileText className="h-4 w-4 mr-2 text-teal-500" />}
                                    Initiate Credit App
                                </Button>
                            )}
                            {hasPendingCreditApp && (
                                <Button 
                                    className="w-full justify-start border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" 
                                    variant="outline"
                                    onClick={() => setShowCreditAppOutcomeModal(true)}
                                >
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    Capture Credit App Outcome
                                </Button>
                            )}
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
                            {/* Dealership Check-in/Check-out */}
                            {currentVisit ? (
                                <Button 
                                    className="w-full justify-start bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100" 
                                    variant="outline"
                                    onClick={() => setShowCheckOutModal(true)}
                                >
                                    <LogOut className="h-4 w-4 mr-2" />
                                    Check Out of Dealership
                                </Button>
                            ) : (
                                <Button 
                                    className="w-full justify-start" 
                                    variant="outline"
                                    onClick={handleCheckIn}
                                    disabled={isCheckingIn || !lead.dealership_id}
                                    title={!lead.dealership_id ? "Assign this lead to a dealership first (Edit lead or assign from Unassigned Pool)." : undefined}
                                >
                                    {isCheckingIn ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <Store className="h-4 w-4 mr-2 text-teal-500" />
                                    )}
                                    Check In to Dealership
                                </Button>
                            )}
                            {/* Mark as Converted - only visible to admin/owner, not salesperson */}
                            {!isSalesperson && lead.stage?.name !== "converted" && (
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
                            {/* Mark as Lost - only visible to admin/owner, not salesperson */}
                            {!isSalesperson && lead.stage?.name !== "lost" && lead.stage?.name !== "converted" && (
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
                            {lead.stage?.name === "new" && (
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
                    <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border-border/80 shadow-sm transition-shadow duration-200 hover:shadow-md">
                        <Tabs value={activeActivityTab} onValueChange={(v) => setActiveActivityTab(v as "timeline" | "notes" | "appointments" | "followups" | "stips")} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            <div className="border-b border-border/60 px-6 flex items-center justify-between gap-4">
                                <TabsList className="bg-transparent h-auto p-0 gap-1">
                                    <TabsTrigger 
                                        value="timeline"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4 px-3 transition-colors duration-200"
                            >
                                Activity Timeline
                                    </TabsTrigger>
                                    <TabsTrigger 
                                        value="notes"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4 px-3 transition-colors duration-200"
                                    >
                                        Notes
                                    </TabsTrigger>
                                    <TabsTrigger 
                                        value="appointments"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4 px-3 flex items-center gap-1.5 transition-colors duration-200"
                                    >
                                        Appointments
                                        {appointmentBadgeCount > 0 && (
                                            <span
                                className={cn(
                                                    "h-5 min-w-[20px] rounded-full text-white text-xs font-medium flex items-center justify-center px-1.5",
                                                    appointmentBadgeColor === "red" && "bg-red-500",
                                                    appointmentBadgeColor === "green" && "bg-green-500",
                                                    appointmentBadgeColor === "grey" && "bg-gray-500"
                                                )}
                                            >
                                                {appointmentBadgeCount}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger 
                                        value="followups"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4 flex items-center gap-1.5"
                                    >
                                        Follow-ups
                                        {followUpBadgeCount > 0 && (
                                            <span
                                className={cn(
                                                    "h-5 min-w-[20px] rounded-full text-white text-xs font-medium flex items-center justify-center px-1.5",
                                                    followUpBadgeColor === "red" && "bg-red-500",
                                                    followUpBadgeColor === "green" && "bg-green-500",
                                                    followUpBadgeColor === "grey" && "bg-gray-500"
                                                )}
                                            >
                                                {followUpBadgeCount}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger 
                                        value="stips"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-4 px-3 flex items-center gap-1.5"
                                    >
                                        <FileStack className="h-4 w-4" />
                                        Stips
                                    </TabsTrigger>
                                </TabsList>
                                <div className="shrink-0 flex flex-col items-end gap-1.5 min-w-[140px]">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full"
                                                disabled={exportLoading}
                                                title="Export lead data"
                                            >
                                                {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                                <span className="ml-1.5">Export</span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => handleExport()} disabled={exportLoading}>
                                                <Download className="h-4 w-4 mr-2" />
                                                Export as ZIP
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleExportPdf()} disabled={exportLoading}>
                                                <FileText className="h-4 w-4 mr-2" />
                                                Export as PDF
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    {exportLoading && (
                                        <>
                                            <div className="w-full flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                                <span className="truncate">{exportStatus}</span>
                                                <span className="font-medium tabular-nums">{exportProgress}%</span>
                                            </div>
                                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                                                    style={{ width: `${exportProgress}%` }}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
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
                                        {activities.map((activity, index) => {
                                            const updatedFieldsLabels: string[] = activity.type === "lead_updated" && Array.isArray(activity.meta_data?.updated_fields_labels) ? (activity.meta_data.updated_fields_labels as string[]) : [];
                                            const showUpdatedFields: boolean = updatedFieldsLabels.length > 0 && !/^Secondary customer (added|removed|changed to):/.test(String(activity.description));
                                            const updatedFieldsLabelText: string = updatedFieldsLabels.join(", ");
                                            const updatedFieldsNode: React.ReactNode = (showUpdatedFields ? (
                                                <div className="mt-1 text-xs text-muted-foreground">Fields: {updatedFieldsLabelText}</div>
                                            ) : null) as unknown as React.ReactNode;
                                            return (
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
                                                                {activity.type === "lead_updated"
                                                                    ? activity.description
                                                                    : (ACTIVITY_TYPE_INFO[activity.type]?.label || activity.type.replace('_', ' '))}
                                                            </p>
                                                            {activity.type !== "lead_updated" && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    {activity.description}
                                                                </p>
                                                            )}
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
                                                                {String(activity.meta_data.old_status).replace(/_/g, ' ')}
                                                            </Badge>
                                                            <span className="text-muted-foreground">→</span>
                                                            <Badge variant={getStatusVariant(String(activity.meta_data.new_status))} size="sm">
                                                                {String(activity.meta_data.new_status).replace(/_/g, ' ')}
                                                            </Badge>
                                                        </div>
                                                    ) : null}
                                                    {updatedFieldsNode}
                                                    {null /* @ts-expect-error - Activity.meta_data Record<string,unknown> so call result inferred unknown */}
                                                    {activity.type === "credit_app_completed" ? renderCreditAppCompletedBlock(activity.meta_data) : null}
                                                    {activity.type === "credit_app_abandoned" && activity.meta_data?.reason && (
                                                        <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-sm">
                                                            <span className="font-medium">Reason:</span> {String(activity.meta_data.reason)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="notes" className="flex-1 p-6 m-0 overflow-y-auto min-h-0">
                                {(() => {
                                    const allNotes = activities.filter(a => a.type === "note_added")
                                    // Separate parent notes and replies (threaded)
                                    // Sort parent notes newest first (most recent at top)
                                    const parentNotes = allNotes
                                        .filter(n => !n.parent_id)
                                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
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

                            <TabsContent value="appointments" className="flex-1 p-6 m-0 overflow-y-auto min-h-0">
                                {loadingAppointmentsFollowUps ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : leadAppointments.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-4">No appointments for this lead.</p>
                                ) : (
                                    <div className="space-y-6">
                                        {appointmentsToday.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground mb-2">Today&apos;s</h3>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Title</TableHead>
                                                            <TableHead>Date & time</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {appointmentsToday.map((apt) => (
                                                            <TableRow key={apt.id}>
                                                                <TableCell className="font-medium">{apt.title}</TableCell>
                                                                <TableCell>
                                                                    <LocalTime date={apt.scheduled_at} />
                                                                    {apt.duration_minutes ? ` (${apt.duration_minutes}m)` : ""}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant="outline" className={getAppointmentStatusColor(apt.status)} size="sm">
                                                                        {getAppointmentStatusLabel(apt.status)}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell className="text-right flex items-center justify-end gap-1">
                                                                    <Link href={`/appointments?lead=${leadId}`} className="text-xs text-primary hover:underline">
                                                                        View
                                                                    </Link>
                                                                    {!isAppointmentStatusTerminal(apt.status) && (
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                                                                    <MoreVertical className="h-4 w-4" />
                                                                                </Button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="end">
                                                                                {apt.status === "scheduled" && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentConfirm(apt)}>
                                                                                        <CheckCircle className="mr-2 h-4 w-4 text-blue-600" />
                                                                                        Confirm
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => setAppointmentRescheduleModal(apt)}>
                                                                                        <CalendarClock className="mr-2 h-4 w-4" />
                                                                                        Reschedule
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {apt.status === "arrived" && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentStatusUpdate(apt, "in_showroom")}>
                                                                                        <Store className="mr-2 h-4 w-4" />
                                                                                        Mark as In Showroom
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "arrived" || apt.status === "in_showroom") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentStatusUpdate(apt, "in_progress")}>
                                                                                        <Clock className="mr-2 h-4 w-4" />
                                                                                        Mark as In Progress
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => setAppointmentCompleteModal(apt)}>
                                                                                        <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                                                                                        Mark as Completed
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentNoShow(apt)}>
                                                                                        <XCircle className="mr-2 h-4 w-4 text-amber-600" />
                                                                                        No Show
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentCancel(apt)} className="text-red-600">
                                                                                        <XCircle className="mr-2 h-4 w-4" />
                                                                                        Cancel Appointment
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                    )}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                        {appointmentsUpcoming.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground mb-2">Upcoming</h3>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Title</TableHead>
                                                            <TableHead>Date & time</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {appointmentsUpcoming.map((apt) => (
                                                            <TableRow key={apt.id}>
                                                                <TableCell className="font-medium">{apt.title}</TableCell>
                                                                <TableCell>
                                                                    <LocalTime date={apt.scheduled_at} />
                                                                    {apt.duration_minutes ? ` (${apt.duration_minutes}m)` : ""}
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant="outline" className={getAppointmentStatusColor(apt.status)} size="sm">
                                                                        {getAppointmentStatusLabel(apt.status)}
                                                                    </Badge>
                                                                </TableCell>
                                                                <TableCell className="text-right flex items-center justify-end gap-1">
                                                                    <Link href={`/appointments?lead=${leadId}`} className="text-xs text-primary hover:underline">
                                                                        View
                                                                    </Link>
                                                                    {!isAppointmentStatusTerminal(apt.status) && (
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                                                                    <MoreVertical className="h-4 w-4" />
                                                                                </Button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="end">
                                                                                {apt.status === "scheduled" && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentConfirm(apt)}>
                                                                                        <CheckCircle className="mr-2 h-4 w-4 text-blue-600" />
                                                                                        Confirm
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => setAppointmentRescheduleModal(apt)}>
                                                                                        <CalendarClock className="mr-2 h-4 w-4" />
                                                                                        Reschedule
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {apt.status === "arrived" && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentStatusUpdate(apt, "in_showroom")}>
                                                                                        <Store className="mr-2 h-4 w-4" />
                                                                                        Mark as In Showroom
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "arrived" || apt.status === "in_showroom") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentStatusUpdate(apt, "in_progress")}>
                                                                                        <Clock className="mr-2 h-4 w-4" />
                                                                                        Mark as In Progress
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => setAppointmentCompleteModal(apt)}>
                                                                                        <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                                                                                        Mark as Completed
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentNoShow(apt)}>
                                                                                        <XCircle className="mr-2 h-4 w-4 text-amber-600" />
                                                                                        No Show
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                                {(apt.status === "scheduled" || apt.status === "confirmed" || apt.status === "arrived" || apt.status === "in_showroom" || apt.status === "in_progress" || apt.status === "no_show") && (
                                                                                    <DropdownMenuItem onClick={() => handleAppointmentCancel(apt)} className="text-red-600">
                                                                                        <XCircle className="mr-2 h-4 w-4" />
                                                                                        Cancel Appointment
                                                                                    </DropdownMenuItem>
                                                                                )}
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                    )}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                        {appointmentsToday.length === 0 && appointmentsUpcoming.length === 0 && (
                                            <p className="text-sm text-muted-foreground py-4">No active appointments (past appointments are not listed here).</p>
                                        )}
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="followups" className="flex-1 p-6 m-0 overflow-y-auto min-h-0">
                                {loadingAppointmentsFollowUps ? (
                                    <div className="flex items-center justify-center py-12">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : leadFollowUps.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-4">No follow-ups for this lead.</p>
                                ) : (
                                    <div className="space-y-6">
                                        {followUpsToday.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground mb-2">Today&apos;s</h3>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Due</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead>Notes</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {followUpsToday.map((fu) => {
                                                            const statusInfo = FOLLOW_UP_STATUS_INFO[fu.status]
                                                            return (
                                                                <TableRow key={fu.id}>
                                                                    <TableCell><LocalTime date={fu.scheduled_at} /></TableCell>
                                                                    <TableCell>
                                                                        <Badge variant={statusInfo.variant} size="sm">{statusInfo.label}</Badge>
                                                                    </TableCell>
                                                                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{fu.notes || "—"}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        {fu.status === "pending" && (
                                                                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={async () => {
                                                                                try {
                                                                                    await FollowUpService.completeFollowUp(fu.id)
                                                                                    fetchLeadAppointmentsAndFollowUps()
                                                                                    fetchActivities()
                                                                                } catch (e) {
                                                                                    console.error(e)
                                                                                    alert("Failed to complete follow-up")
                                                                                }
                                                                            }}>
                                                                                Complete
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                        {followUpsUpcoming.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground mb-2">Upcoming</h3>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Due</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead>Notes</TableHead>
                                                            <TableHead className="text-right">Actions</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {followUpsUpcoming.map((fu) => {
                                                            const statusInfo = FOLLOW_UP_STATUS_INFO[fu.status]
                                                            return (
                                                                <TableRow key={fu.id}>
                                                                    <TableCell><LocalTime date={fu.scheduled_at} /></TableCell>
                                                                    <TableCell>
                                                                        <Badge variant={statusInfo.variant} size="sm">{statusInfo.label}</Badge>
                                                                    </TableCell>
                                                                    <TableCell className="max-w-[200px] truncate text-muted-foreground">{fu.notes || "—"}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        {fu.status === "pending" && (
                                                                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={async () => {
                                                                                try {
                                                                                    await FollowUpService.completeFollowUp(fu.id)
                                                                                    fetchLeadAppointmentsAndFollowUps()
                                                                                    fetchActivities()
                                                                                } catch (e) {
                                                                                    console.error(e)
                                                                                    alert("Failed to complete follow-up")
                                                                                }
                                                                            }}>
                                                                                Complete
                                                                            </Button>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            )
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                        {followUpsToday.length === 0 && followUpsUpcoming.length === 0 && (
                                            <p className="text-sm text-muted-foreground py-4">No pending follow-ups for today or later.</p>
                                        )}
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="stips" className="flex-1 p-6 m-0 overflow-y-auto min-h-0 flex flex-col">
                                {!stipsConfigured && (
                                    <p className="text-sm text-muted-foreground mb-4">Stips storage is not configured. Upload is disabled. Configure Azure storage to enable document uploads.</p>
                                )}
                                {stipsCategories.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No Stips categories yet. Add categories in Settings → Stips Categories.</p>
                                ) : (
                                    <>
                                        <Tabs value={activeStipsCategoryId ?? ""} onValueChange={setActiveStipsCategoryId} className="flex-1 flex flex-col min-h-0">
                                            <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1 mb-4">
                                                {stipsCategories.map((cat) => (
                                                    <TabsTrigger key={cat.id} value={cat.id} className="text-xs">
                                                        {cat.name}
                                                    </TabsTrigger>
                                                ))}
                                            </TabsList>
                                            {activeStipsCategoryId && (
                                                <div className="flex-1 flex flex-col min-h-0 space-y-4">
                                                    {stipsConfigured && (
                                                        <div
                                                            className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/40 transition-colors cursor-pointer"
                                                            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-muted/60") }}
                                                            onDragLeave={(e) => { e.currentTarget.classList.remove("bg-muted/60") }}
                                                            onDrop={(e) => {
                                                                e.preventDefault()
                                                                e.currentTarget.classList.remove("bg-muted/60")
                                                                const files = Array.from(e.dataTransfer?.files ?? [])
                                                                if (files.length === 0 || !leadId) return
                                                                const categoryId = activeStipsCategoryId
                                                                setStipsUploadingCategoryId(categoryId)
                                                                setStipsUploadProgress(0)
                                                                setStipsUploadTotalFiles(files.length)
                                                                setStipsUploadCompletedCount(0)
                                                                const total = files.length
                                                                const UPLOAD_CONCURRENCY = 6
                                                                const runUpload = (file: File) =>
                                                                    StipsService.uploadDocument(leadId, categoryId, file).then(() => {
                                                                        setStipsUploadCompletedCount((c) => {
                                                                            const next = c + 1
                                                                            setStipsUploadProgress(total > 0 ? Math.round((next / total) * 100) : 0)
                                                                            return next
                                                                        })
                                                                    })
                                                                if (total === 1) {
                                                                    StipsService.uploadDocument(leadId, categoryId, files[0], (p) => setStipsUploadProgress(p))
                                                                        .then(() => fetchStipsDocuments())
                                                                        .catch((err) => alert(err?.response?.data?.detail ?? "Upload failed"))
                                                                        .finally(() => { setStipsUploadingCategoryId(null); setStipsUploadProgress(0); setStipsUploadTotalFiles(0); setStipsUploadCompletedCount(0) })
                                                                } else {
                                                                    const queue = files.slice()
                                                                    const worker = (): Promise<void> =>
                                                                        queue.length === 0
                                                                            ? Promise.resolve()
                                                                            : runUpload(queue.shift()!).then(() => worker())
                                                                    Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker))
                                                                        .then(() => fetchStipsDocuments())
                                                                        .catch((err) => alert(err?.response?.data?.detail ?? "Upload failed"))
                                                                        .finally(() => { setStipsUploadingCategoryId(null); setStipsUploadProgress(0); setStipsUploadTotalFiles(0); setStipsUploadCompletedCount(0) })
                                                                }
                                                            }}
                                                            onClick={() => document.getElementById(`stips-file-${activeStipsCategoryId}`)?.click()}
                                                        >
                                    <input
                                                                id={`stips-file-${activeStipsCategoryId}`}
                                                                type="file"
                                                                multiple
                                                                className="hidden"
                                                                accept="*/*"
                                                                onChange={(e) => {
                                                                    const files = Array.from(e.target.files ?? [])
                                                                    e.target.value = ""
                                                                    if (files.length === 0 || !leadId) return
                                                                    const categoryId = activeStipsCategoryId
                                                                    setStipsUploadingCategoryId(categoryId)
                                                                    setStipsUploadProgress(0)
                                                                    setStipsUploadTotalFiles(files.length)
                                                                    setStipsUploadCompletedCount(0)
                                                                    const total = files.length
                                                                    const UPLOAD_CONCURRENCY = 6
                                                                    const runUpload = (file: File) =>
                                                                        StipsService.uploadDocument(leadId, categoryId, file).then(() => {
                                                                            setStipsUploadCompletedCount((c) => {
                                                                                const next = c + 1
                                                                                setStipsUploadProgress(total > 0 ? Math.round((next / total) * 100) : 0)
                                                                                return next
                                                                            })
                                                                        })
                                                                    if (total === 1) {
                                                                        StipsService.uploadDocument(leadId, categoryId, files[0], (p) => setStipsUploadProgress(p))
                                                                            .then(() => fetchStipsDocuments())
                                                                            .catch((err) => alert(err?.response?.data?.detail ?? "Upload failed"))
                                                                            .finally(() => { setStipsUploadingCategoryId(null); setStipsUploadProgress(0); setStipsUploadTotalFiles(0); setStipsUploadCompletedCount(0) })
                                                                    } else {
                                                                        const queue = files.slice()
                                                                        const worker = (): Promise<void> =>
                                                                            queue.length === 0
                                                                                ? Promise.resolve()
                                                                                : runUpload(queue.shift()!).then(() => worker())
                                                                        Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker))
                                                                            .then(() => fetchStipsDocuments())
                                                                            .catch((err) => alert(err?.response?.data?.detail ?? "Upload failed"))
                                                                            .finally(() => { setStipsUploadingCategoryId(null); setStipsUploadProgress(0); setStipsUploadTotalFiles(0); setStipsUploadCompletedCount(0) })
                                                                    }
                                                                }}
                                                            />
                                                            {stipsUploadingCategoryId === activeStipsCategoryId ? (
                                                                <div className="w-full max-w-xs mx-auto space-y-3">
                                                                    <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
                                                                    <p className="text-sm font-medium text-muted-foreground">
                                                                        {stipsUploadTotalFiles > 1
                                                                            ? `Uploading… ${stipsUploadCompletedCount} of ${stipsUploadTotalFiles} files (${stipsUploadProgress}%)`
                                                                            : `Uploading… ${stipsUploadProgress}%`}
                                                                    </p>
                                                                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-primary transition-all duration-300 ease-out"
                                                                            style={{ width: `${stipsUploadProgress}%` }}
                                                                        />
                                    </div>
                                </div>
                                                            ) : (
                                                                <>
                                                                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                                                                    <p className="text-sm text-muted-foreground">Drag and drop files here or click to browse (multiple allowed)</p>
                                                                </>
                                                            )}
                            </div>
                        )}
                                                    {stipsLoading ? (
                                                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                                                    ) : stipsDocuments.length === 0 ? (
                                                        <p className="text-sm text-muted-foreground py-4">No documents in this category.</p>
                                                    ) : (
                                                        <ul className="space-y-2">
                                                            {stipsDocuments.map((doc) => (
                                                                <li key={doc.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="text-sm font-medium truncate">{doc.file_name}</p>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {doc.uploaded_by_name && `${doc.uploaded_by_name} · `}
                                                                            {format(new Date(doc.uploaded_at), "MMM d, yyyy HH:mm")}
                                                                        </p>
                    </div>
                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-8"
                                                                            onClick={async () => {
                                                                                try {
                                                                                    const { url } = await StipsService.getViewUrl(leadId!, doc.id)
                                                                                    setStipsViewDoc({ url, fileName: doc.file_name, contentType: doc.content_type })
                                                                                } catch (e) {
                                                                                    console.error(e)
                                                                                    alert("Could not open document")
                                                                                }
                                                                            }}
                                                                        >
                                                                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> View
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-8 text-destructive hover:text-destructive"
                                                                            onClick={async () => {
                                                                                if (!confirm(`Remove "${doc.file_name}"?`)) return
                                                                                try {
                                                                                    await StipsService.deleteDocument(leadId!, doc.id)
                                                                                    fetchStipsDocuments()
                                                                                } catch (e) {
                                                                                    console.error(e)
                                                                                    alert("Failed to remove document")
                                                                                }
                                                                            }}
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </Button>
                </div>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
            </div>
                                            )}
                                        </Tabs>
                                    </>
                                )}
                            </TabsContent>
                        </Tabs>

                        {/* Stips document viewer modal */}
                        <Dialog open={!!stipsViewDoc} onOpenChange={(open) => !open && setStipsViewDoc(null)}>
                            <DialogContent className="max-w-[90vw] w-full max-h-[90vh] flex flex-col p-0 gap-0">
                                <DialogHeader className="px-6 py-3 border-b shrink-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <DialogTitle className="text-base font-medium truncate pr-8">
                                            {stipsViewDoc?.fileName ?? "Document"}
                                        </DialogTitle>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0"
                                            onClick={() => stipsViewDoc && window.open(stipsViewDoc.url, "_blank")}
                                        >
                                            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open in new tab
                                        </Button>
                                    </div>
                                </DialogHeader>
                                <div className="flex-1 min-h-[70vh] flex items-center justify-center overflow-auto bg-muted/30 p-4">
                                    {stipsViewDoc && (
                                        stipsViewDoc.contentType.startsWith("image/") ? (
                                            <img
                                                src={stipsViewDoc.url}
                                                alt={stipsViewDoc.fileName}
                                                className="max-w-full max-h-[78vh] w-auto h-auto object-contain rounded-sm shadow-sm"
                                            />
                                        ) : stipsViewDoc.contentType === "application/pdf" || stipsViewDoc.contentType.startsWith("text/") ? (
                                            <iframe
                                                title={stipsViewDoc.fileName}
                                                src={stipsViewDoc.url}
                                                className="w-full h-full min-h-[70vh] border-0 rounded-sm"
                                                sandbox="allow-same-origin allow-scripts"
                                            />
                                        ) : (
                                            <div className="text-center max-w-sm space-y-3 p-6">
                                                <p className="text-sm text-muted-foreground">
                                                    This file type cannot be previewed in the browser. Use &quot;Open in new tab&quot; above to download or view the document.
                                                </p>
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => stipsViewDoc && window.open(stipsViewDoc.url, "_blank")}
                                                >
                                                    <ExternalLink className="h-4 w-4 mr-2" /> Open in new tab
                                                </Button>
        </div>
    )
                                    )}
                                </div>
                            </DialogContent>
                        </Dialog>

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

            <AssignSecondaryCustomerModal
                open={showSecondaryCustomerModal}
                onOpenChange={setShowSecondaryCustomerModal}
                lead={lead}
                onSuccess={fetchLead}
            />
            
            {/* Email Composer Modal */}
            <EmailComposerModal
                isOpen={showEmailComposer}
                onClose={() => setShowEmailComposer(false)}
                leadId={lead?.id}
                leadEmail={lead ? getLeadEmail(lead) : undefined}
                leadName={lead ? getLeadFullName(lead) : undefined}
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
                        fetchActivities()
                        fetchLeadAppointmentsAndFollowUps()
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
                        fetchActivities()
                        fetchLeadAppointmentsAndFollowUps()
                    }}
                />
            )}

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
                                disabled={isCheckingIn}
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
                            disabled={isCheckingIn}
                        >
                            Check in without linking to an appointment
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            
            {/* Dealership Check-out Modal */}
            <Dialog
                open={showCheckOutModal}
                onOpenChange={(open) => {
                    setShowCheckOutModal(open)
                    if (!open) {
                        setCheckOutRescheduleDate(undefined)
                        setCheckOutRescheduleTime("")
                    }
                }}
            >
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

                    <div className="space-y-4">
                        {lead && (
                            <div className="bg-muted/50 rounded-lg p-4 flex items-center gap-4">
                                <UserAvatar 
                                    firstName={lead.customer?.first_name || ""}
                                    lastName={lead.customer?.last_name ?? undefined}
                                    size="md"
                                />
                                <div className="flex-1">
                                    <div className="font-medium">{getLeadFullName(lead)}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {getLeadPhone(lead) || getLeadEmail(lead)}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Visit Outcome</Label>
                            <Select value={checkOutOutcome} onValueChange={(v) => setCheckOutOutcome(v as ShowroomOutcome)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="sold">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4 text-emerald-600" />
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
                                            <CalendarClock className="h-4 w-4 text-purple-600" />
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
                                            <User className="h-4 w-4 text-yellow-600" />
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

                        {checkOutOutcome === "reschedule" && currentVisit?.appointment_id && (
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
                                                <CalendarPicker
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

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCheckOutModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCheckOut}
                            disabled={
                                isCheckingOut ||
                                !!(checkOutOutcome === "reschedule" &&
                                    currentVisit?.appointment_id &&
                                    (!checkOutRescheduleDate || !checkOutRescheduleTime))
                            }
                        >
                            {isCheckingOut ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Checking Out...
                                </>
                            ) : (
                                "Check Out"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Credit app outcome: Completed or Abandoned — no required identifiers */}
            <Dialog open={showCreditAppOutcomeModal} onOpenChange={setShowCreditAppOutcomeModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Credit Application Outcome
                        </DialogTitle>
                        <DialogDescription>
                            Was the credit application completed or abandoned?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 pt-2">
                        <Button
                            disabled={creditAppOutcomeSubmitting !== null}
                            onClick={async () => {
                                if (!leadId) return
                                setCreditAppOutcomeSubmitting("complete")
                                try {
                                    await LeadService.creditAppComplete(leadId, {})
                                    setShowCreditAppOutcomeModal(false)
                                    fetchLead()
                                    fetchActivities()
                                } catch (e: unknown) {
                                    alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to save")
                                } finally {
                                    setCreditAppOutcomeSubmitting(null)
                                }
                            }}
                        >
                            {creditAppOutcomeSubmitting === "complete" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                            Completed
                        </Button>
                        <Button
                            variant="outline"
                            disabled={creditAppOutcomeSubmitting !== null}
                            onClick={async () => {
                                if (!leadId) return
                                setCreditAppOutcomeSubmitting("abandon")
                                try {
                                    await LeadService.creditAppAbandon(leadId, {})
                                    setShowCreditAppOutcomeModal(false)
                                    fetchLead()
                                    fetchActivities()
                                } catch (e: unknown) {
                                    alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to save")
                                } finally {
                                    setCreditAppOutcomeSubmitting(null)
                                }
                            }}
                        >
                            {creditAppOutcomeSubmitting === "abandon" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                            Abandoned
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowCreditAppOutcomeModal(false)}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Complete Appointment Modal (from lead Appointments tab) */}
            {appointmentCompleteModal && (
                <Dialog open={!!appointmentCompleteModal} onOpenChange={(open) => !open && setAppointmentCompleteModal(null)}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Complete Appointment</DialogTitle>
                            <DialogDescription>{appointmentCompleteModal.title}</DialogDescription>
                        </DialogHeader>
                        <LeadAppointmentCompleteForm
                            appointment={appointmentCompleteModal}
                            onSuccess={() => {
                                setAppointmentCompleteModal(null)
                                refreshAppointments()
                            }}
                            onClose={() => setAppointmentCompleteModal(null)}
                        />
                    </DialogContent>
                </Dialog>
            )}

            {/* Reschedule Appointment Modal (from lead Appointments tab) */}
            {appointmentRescheduleModal && (
                <Dialog open={!!appointmentRescheduleModal} onOpenChange={(open) => !open && setAppointmentRescheduleModal(null)}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Reschedule Appointment</DialogTitle>
                            <DialogDescription>{appointmentRescheduleModal.title}</DialogDescription>
                        </DialogHeader>
                        <LeadAppointmentRescheduleForm
                            appointment={appointmentRescheduleModal}
                            timeSlots={RESCHEDULE_TIME_SLOTS}
                            onSuccess={() => {
                                setAppointmentRescheduleModal(null)
                                refreshAppointments()
                            }}
                            onClose={() => setAppointmentRescheduleModal(null)}
                        />
                    </DialogContent>
                </Dialog>
            )}
            
            {/* Call / Text Coming Soon Dialog */}
            {lead?.customer?.phone && (
                <Dialog open={showCallTextComingSoon} onOpenChange={setShowCallTextComingSoon}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Phone className="h-5 w-5 text-primary" />
                                Call &amp; Text Coming Soon
                            </DialogTitle>
                            <DialogDescription>
                                In-app calling and SMS are being set up. You can still contact this lead using your own phone.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <p className="text-sm text-muted-foreground">
                                Use the number below to call or text manually:
                            </p>
                            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3">
                                <span className="font-mono font-medium">{getLeadPhone(lead)}</span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            navigator.clipboard.writeText(getLeadPhone(lead) || "")
                                        }}
                                        title="Copy number"
                                    >
                                        <Copy className="h-4 w-4 mr-1" />
                                        Copy
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                        title="Call with your phone"
                                    >
                                        <a href={`tel:${getLeadPhone(lead)}`}>
                                            <Phone className="h-4 w-4 mr-1" />
                                            Call
                                        </a>
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={() => setShowCallTextComingSoon(false)}>Got it</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            
            {/* Delete Confirmation Dialog */}
            {lead && (
                <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{getLeadFullName(lead)}</strong>? 
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
                                    <span className="inline-flex items-center">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Deleting...
                                    </span>
                                ) : (
                                    "Delete Lead"
                                )}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            {/* Remove secondary customer confirmation */}
            <AlertDialog open={showRemoveSecondaryConfirm} onOpenChange={setShowRemoveSecondaryConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove secondary customer</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the secondary customer from this lead. Are you sure you want to remove?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                if (!lead) return
                                try {
                                    await LeadService.updateLead(lead.id, { secondary_customer_id: null })
                                    setShowRemoveSecondaryConfirm(false)
                                    fetchLead()
                                } catch (e) {
                                    console.error(e)
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Confirm
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
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
                                <span className="inline-flex items-center">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </span>
                            ) : (
                                "Mark as Lost"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Optional notes when setting terminal stage (e.g. Qualified / Not qualified) */}
            <Dialog open={showStageNotesModal} onOpenChange={(open) => { if (!open) { setShowStageNotesModal(false); setPendingStageForNotes(null); setStageNotes("") } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add notes (optional)</DialogTitle>
                        <DialogDescription>
                            Add notes for this status change. The assigned salesperson will see them if you are closing this lead.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <Textarea
                            placeholder="e.g. Reason for decision, follow-up instructions..."
                            value={stageNotes}
                            onChange={(e) => setStageNotes(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowStageNotesModal(false); setPendingStageForNotes(null); setStageNotes("") }}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirmStageNotes} disabled={isUpdatingStatus}>
                            {isUpdatingStatus ? (
                                <span className="inline-flex items-center">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Updating...
                                </span>
                            ) : (
                                "Confirm"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
