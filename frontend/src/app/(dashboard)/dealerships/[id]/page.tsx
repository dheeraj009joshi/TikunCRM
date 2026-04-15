"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import {
    ArrowLeft,
    Building2,
    Settings,
    MessageSquare,
    Users,
    Loader2,
    MapPin,
    Phone,
    Mail,
    Globe,
    Calendar,
    CheckCircle,
    XCircle,
    Pencil,
    Save,
    X,
    Clock,
    GitBranch,
    FolderOpen,
    Tag,
    Send,
    Smartphone,
    PhoneCall,
    Eye,
    EyeOff,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
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
import { DealershipService, Dealership, UpdateDealershipData, DealershipTwilioConfig, DealershipTwilioConfigUpdate } from "@/services/dealership-service"
import { DealershipEmailService, EmailConfigStatus, DealershipEmailConfigCreate } from "@/services/dealership-email-service"
import { TeamService, UserWithStats, CreateUserData, UpdateUserData } from "@/services/team-service"
import { LeadStageService, LeadStage } from "@/services/lead-stage-service"
import { useRole } from "@/hooks/use-role"
import { UserRole } from "@/stores/auth-store"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { ConfigUnlockModal } from "@/components/security/config-unlock-modal"
import { getConfigAccessStatus } from "@/services/config-access-service"
import { getConfigUnlockToken } from "@/lib/config-unlock"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const COMMON_TIMEZONES = [
    { value: "America/New_York", label: "Eastern Time (US)" },
    { value: "America/Chicago", label: "Central Time (US)" },
    { value: "America/Denver", label: "Mountain Time (US)" },
    { value: "America/Los_Angeles", label: "Pacific Time (US)" },
    { value: "America/Phoenix", label: "Arizona (No DST)" },
    { value: "America/Anchorage", label: "Alaska Time" },
    { value: "Pacific/Honolulu", label: "Hawaii Time" },
    { value: "UTC", label: "UTC" },
    { value: "Europe/London", label: "London (GMT/BST)" },
    { value: "Europe/Paris", label: "Central European Time" },
    { value: "Asia/Dubai", label: "Dubai (GST)" },
    { value: "Asia/Kolkata", label: "India (IST)" },
    { value: "Asia/Singapore", label: "Singapore (SGT)" },
    { value: "Asia/Tokyo", label: "Japan (JST)" },
    { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
]

export default function DealershipDetailPage() {
    const params = useParams()
    const router = useRouter()
    const { toast } = useToast()
    const dealershipId = params.id as string
    const { isSuperAdmin } = useRole()

    const [dealership, setDealership] = React.useState<Dealership | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [activeTab, setActiveTab] = React.useState("overview")

    // Overview state
    const [isEditing, setIsEditing] = React.useState(false)
    const [editForm, setEditForm] = React.useState<UpdateDealershipData>({})
    const [isSaving, setIsSaving] = React.useState(false)
    const [showStatusDialog, setShowStatusDialog] = React.useState(false)

    // Communication state
    const [twilioConfig, setTwilioConfig] = React.useState<DealershipTwilioConfig | null>(null)
    const [twilioForm, setTwilioForm] = React.useState<DealershipTwilioConfigUpdate>({})
    const [isLoadingTwilio, setIsLoadingTwilio] = React.useState(false)
    const [isSavingTwilio, setIsSavingTwilio] = React.useState(false)
    const [emailStatus, setEmailStatus] = React.useState<EmailConfigStatus | null>(null)
    const [isLoadingEmail, setIsLoadingEmail] = React.useState(false)
    const [configAccessStatus, setConfigAccessStatus] = React.useState<{
        eligible: boolean
        config_access_password_set: boolean
    } | null>(null)
    const [showConfigUnlockModal, setShowConfigUnlockModal] = React.useState(false)
    const [showTwilioAuthToken, setShowTwilioAuthToken] = React.useState(false)
    const [showTwilioApiKeySecret, setShowTwilioApiKeySecret] = React.useState(false)
    /** User may load Twilio API (eligible + password set + unlock token, or not eligible for gate) */
    const [allowTwilioIntegration, setAllowTwilioIntegration] = React.useState(false)

    // Team state
    const [teamMembers, setTeamMembers] = React.useState<UserWithStats[]>([])
    const [isLoadingTeam, setIsLoadingTeam] = React.useState(false)
    const [showCreateUser, setShowCreateUser] = React.useState(false)
    const [newUserForm, setNewUserForm] = React.useState<CreateUserData>({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "salesperson" as UserRole,
        dealership_id: dealershipId,
    })
    const [isCreatingUser, setIsCreatingUser] = React.useState(false)

    // Settings state
    const [stages, setStages] = React.useState<LeadStage[]>([])
    const [isLoadingStages, setIsLoadingStages] = React.useState(false)
    const [laAutoAssign, setLaAutoAssign] = React.useState(false)
    const [laRoundRobin, setLaRoundRobin] = React.useState(true)
    const [laMaxLeads, setLaMaxLeads] = React.useState(50)
    const [isSavingLeadRules, setIsSavingLeadRules] = React.useState(false)

    // Load dealership data
    const loadDealership = React.useCallback(async () => {
        if (!dealershipId) return
        try {
            const data = await DealershipService.getDealership(dealershipId)
            setDealership(data)
            setEditForm({
                name: data.name,
                address: data.address || "",
                city: data.city || "",
                state: data.state || "",
                postal_code: data.postal_code || "",
                phone: data.phone || "",
                email: data.email || "",
                website: data.website || "",
                timezone: data.timezone,
            })
        } catch (error) {
            console.error("Failed to load dealership:", error)
        } finally {
            setIsLoading(false)
        }
    }, [dealershipId])

    React.useEffect(() => {
        loadDealership()
    }, [loadDealership])

    React.useEffect(() => {
        if (!dealership?.lead_assignment_rules || Object.keys(dealership.lead_assignment_rules).length === 0) {
            setLaAutoAssign(false)
            setLaRoundRobin(true)
            setLaMaxLeads(50)
            return
        }
        const r = dealership.lead_assignment_rules as Record<string, unknown>
        setLaAutoAssign(Boolean(r.auto_assign))
        setLaRoundRobin(r.round_robin !== false)
        const max = r.max_leads_per_salesperson
        setLaMaxLeads(typeof max === "number" && !Number.isNaN(max) ? max : 50)
    }, [dealership])

    const applyTwilioFromServer = React.useCallback((config: DealershipTwilioConfig) => {
        setTwilioConfig(config)
        setTwilioForm({
            account_sid: config.account_sid || "",
            auth_token: config.auth_token || "",
            sms_enabled: config.sms_enabled,
            sms_from_number: config.sms_from_number || "",
            whatsapp_enabled: config.whatsapp_enabled,
            whatsapp_from_number: config.whatsapp_from_number || "",
            voice_enabled: config.voice_enabled,
            twilio_twiml_app_sid: config.twilio_twiml_app_sid || "",
            twilio_api_key_sid: config.twilio_api_key_sid || "",
            twilio_api_key_secret: config.twilio_api_key_secret || "",
            voice_caller_id_number: config.voice_caller_id_number || "",
        })
    }, [])

    // Load Twilio config when Communication tab is active
    const loadTwilioConfig = React.useCallback(async () => {
        if (!dealershipId) return
        setIsLoadingTwilio(true)
        try {
            const config = await DealershipService.getTwilioConfig(dealershipId)
            applyTwilioFromServer(config)
        } catch (error) {
            console.error("Failed to load Twilio config:", error)
            toast({
                title: "Could not load Twilio settings",
                description: "Check your permissions and try again.",
                variant: "destructive",
            })
        } finally {
            setIsLoadingTwilio(false)
        }
    }, [dealershipId, applyTwilioFromServer, toast])

    // Load email status
    const loadEmailStatus = React.useCallback(async () => {
        if (!dealershipId) return
        setIsLoadingEmail(true)
        try {
            const status = await DealershipEmailService.getStatus(dealershipId)
            setEmailStatus(status)
        } catch (error) {
            console.error("Failed to load email status:", error)
        } finally {
            setIsLoadingEmail(false)
        }
    }, [dealershipId])

    // Load team members
    const loadTeam = React.useCallback(async () => {
        if (!dealershipId) return
        setIsLoadingTeam(true)
        try {
            const data = await TeamService.getTeamWithStats(dealershipId)
            setTeamMembers(data.items)
        } catch (error) {
            console.error("Failed to load team:", error)
        } finally {
            setIsLoadingTeam(false)
        }
    }, [dealershipId])

    // Load stages for this dealership (super admin must pass id or API falls back to global stages)
    const loadStages = React.useCallback(async () => {
        if (!dealershipId) return
        setIsLoadingStages(true)
        try {
            const data = await LeadStageService.list(dealershipId)
            setStages(data)
        } catch (error) {
            console.error("Failed to load stages:", error)
        } finally {
            setIsLoadingStages(false)
        }
    }, [dealershipId])

    // Handle tab changes (Twilio requires configuration-access password + unlock token)
    React.useEffect(() => {
        if (activeTab === "communication") {
            loadEmailStatus()
            getConfigAccessStatus()
                .then((s) => {
                    setConfigAccessStatus(s)
                    if (!s.eligible) {
                        setAllowTwilioIntegration(true)
                        loadTwilioConfig()
                        return
                    }
                    if (!s.config_access_password_set) {
                        setAllowTwilioIntegration(false)
                        return
                    }
                    if (!getConfigUnlockToken()) {
                        setAllowTwilioIntegration(false)
                        setShowConfigUnlockModal(true)
                        return
                    }
                    setAllowTwilioIntegration(true)
                    loadTwilioConfig()
                })
                .catch(() => {
                    setAllowTwilioIntegration(true)
                    loadTwilioConfig()
                })
        } else if (activeTab === "team") {
            loadTeam()
        } else if (activeTab === "settings") {
            loadStages()
        }
    }, [activeTab, loadTwilioConfig, loadEmailStatus, loadTeam, loadStages])

    // Save dealership info
    const handleSaveDealership = async () => {
        if (!dealership) return
        setIsSaving(true)
        try {
            const updated = await DealershipService.updateDealership(dealership.id, editForm)
            setDealership(updated)
            setIsEditing(false)
        } catch (error) {
            console.error("Failed to update dealership:", error)
        } finally {
            setIsSaving(false)
        }
    }

    // Toggle dealership status
    const handleToggleStatus = async () => {
        if (!dealership) return
        setIsSaving(true)
        try {
            const updated = await DealershipService.toggleDealershipStatus(dealership.id, !dealership.is_active)
            setDealership(updated)
            setShowStatusDialog(false)
        } catch (error) {
            console.error("Failed to toggle status:", error)
        } finally {
            setIsSaving(false)
        }
    }

    // Save Twilio config (secrets sent only when non-empty; stored encrypted server-side)
    const handleSaveTwilio = async () => {
        if (!dealershipId || !allowTwilioIntegration) return
        setIsSavingTwilio(true)
        try {
            const payload: DealershipTwilioConfigUpdate = {
                account_sid: twilioForm.account_sid?.trim() || null,
                sms_enabled: twilioForm.sms_enabled ?? false,
                sms_from_number: twilioForm.sms_from_number?.trim() || null,
                whatsapp_enabled: twilioForm.whatsapp_enabled ?? false,
                whatsapp_from_number: twilioForm.whatsapp_from_number?.trim() || null,
                voice_enabled: twilioForm.voice_enabled ?? false,
                twilio_twiml_app_sid: twilioForm.twilio_twiml_app_sid?.trim() || null,
                twilio_api_key_sid: twilioForm.twilio_api_key_sid?.trim() || null,
                voice_caller_id_number: twilioForm.voice_caller_id_number?.trim() || null,
            }
            const t = twilioForm.auth_token?.trim()
            if (t) payload.auth_token = t
            const s = twilioForm.twilio_api_key_secret?.trim()
            if (s) payload.twilio_api_key_secret = s

            const updated = await DealershipService.patchTwilioConfig(dealershipId, payload)
            applyTwilioFromServer(updated)
            toast({ title: "Twilio settings saved" })
        } catch (error) {
            console.error("Failed to save Twilio config:", error)
            toast({
                title: "Could not save Twilio settings",
                description: "Check values and try again.",
                variant: "destructive",
            })
        } finally {
            setIsSavingTwilio(false)
        }
    }

    // Save timezone
    const handleSaveTimezone = async (timezone: string) => {
        if (!dealership) return
        setIsSaving(true)
        try {
            const updated = await DealershipService.updateDealership(dealership.id, { timezone })
            setDealership(updated)
        } catch (error) {
            console.error("Failed to update timezone:", error)
        } finally {
            setIsSaving(false)
        }
    }

    const handleSaveLeadAssignmentRules = async () => {
        if (!dealership) return
        setIsSavingLeadRules(true)
        try {
            const updated = await DealershipService.patchDealership(dealership.id, {
                lead_assignment_rules: {
                    auto_assign: laAutoAssign,
                    round_robin: laRoundRobin,
                    max_leads_per_salesperson: laMaxLeads,
                },
            })
            setDealership(updated)
            toast({ title: "Lead assignment rules saved" })
        } catch (error) {
            console.error("Failed to save lead assignment rules:", error)
            toast({
                title: "Could not save lead assignment rules",
                variant: "destructive",
            })
        } finally {
            setIsSavingLeadRules(false)
        }
    }

    // Create user
    const handleCreateUser = async () => {
        setIsCreatingUser(true)
        try {
            await TeamService.createUser({
                ...newUserForm,
                dealership_id: dealershipId,
            })
            setShowCreateUser(false)
            setNewUserForm({
                email: "",
                password: "",
                first_name: "",
                last_name: "",
                phone: "",
                role: "salesperson" as UserRole,
                dealership_id: dealershipId,
            })
            await loadTeam()
        } catch (error) {
            console.error("Failed to create user:", error)
        } finally {
            setIsCreatingUser(false)
        }
    }

    const [togglingTeamUserId, setTogglingTeamUserId] = React.useState<string | null>(null)

    // Toggle user status
    const handleToggleUserStatus = async (userId: string, isActive: boolean) => {
        setTogglingTeamUserId(userId)
        try {
            await TeamService.toggleUserStatus(userId, isActive)
            await loadTeam()
            toast({
                title: isActive ? "Team member activated" : "Team member deactivated",
                description: isActive
                    ? "They can sign in and receive assignments again."
                    : "They can no longer sign in until reactivated.",
            })
        } catch (error) {
            console.error("Failed to toggle user status:", error)
            toast({
                variant: "destructive",
                title: "Could not update status",
                description: "Please try again or check your connection.",
            })
        } finally {
            setTogglingTeamUserId(null)
        }
    }

    if (!isSuperAdmin) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="max-w-md">
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>Only Super Admins can access dealership management.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!dealership) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="max-w-md">
                    <CardHeader>
                        <CardTitle>Dealership Not Found</CardTitle>
                        <CardDescription>The requested dealership could not be found.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={() => router.push("/dealerships")}>
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Dealerships
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/dealerships")}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary font-bold text-white text-lg">
                            {dealership.name[0]}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">{dealership.name}</h1>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-3.5 w-3.5" />
                                {dealership.city || "N/A"}, {dealership.state || "N/A"}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge
                        variant={dealership.is_active ? "default" : "destructive"}
                        className="cursor-pointer"
                        onClick={() => setShowStatusDialog(true)}
                    >
                        {dealership.is_active ? (
                            <>
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Active
                            </>
                        ) : (
                            <>
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Inactive
                            </>
                        )}
                    </Badge>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview" className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Overview
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-2">
                        <Settings className="h-4 w-4" />
                        Settings
                    </TabsTrigger>
                    <TabsTrigger value="communication" className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Communication
                    </TabsTrigger>
                    <TabsTrigger value="team" className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Team
                    </TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Dealership Info Card */}
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle>Dealership Information</CardTitle>
                                    <CardDescription>Basic details and contact information</CardDescription>
                                </div>
                                {!isEditing ? (
                                    <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit
                                    </Button>
                                ) : (
                                    <div className="flex gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                                            <X className="h-4 w-4 mr-2" />
                                            Cancel
                                        </Button>
                                        <Button size="sm" onClick={handleSaveDealership} disabled={isSaving}>
                                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                            Save
                                        </Button>
                                    </div>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isEditing ? (
                                    <>
                                        <div className="space-y-2">
                                            <Label>Name</Label>
                                            <Input
                                                value={editForm.name || ""}
                                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>City</Label>
                                                <Input
                                                    value={editForm.city || ""}
                                                    onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>State</Label>
                                                <Input
                                                    value={editForm.state || ""}
                                                    onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Address</Label>
                                            <Input
                                                value={editForm.address || ""}
                                                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Postal Code</Label>
                                            <Input
                                                value={editForm.postal_code || ""}
                                                onChange={(e) => setEditForm({ ...editForm, postal_code: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Phone</Label>
                                            <Input
                                                value={editForm.phone || ""}
                                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Email</Label>
                                            <Input
                                                type="email"
                                                value={editForm.email || ""}
                                                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Website</Label>
                                            <Input
                                                value={editForm.website || ""}
                                                onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3 text-sm">
                                            <MapPin className="h-4 w-4 text-muted-foreground" />
                                            <span>{dealership.address || "No address"}, {dealership.city || ""}, {dealership.state || ""} {dealership.postal_code || ""}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            <Phone className="h-4 w-4 text-muted-foreground" />
                                            <span>{dealership.phone || "No phone"}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            <Mail className="h-4 w-4 text-muted-foreground" />
                                            <span>{dealership.email || "No email"}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-sm">
                                            <Globe className="h-4 w-4 text-muted-foreground" />
                                            <span>{dealership.website || "No website"}</span>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Stats Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Statistics</CardTitle>
                                <CardDescription>Overview of dealership activity</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between py-2 border-b">
                                    <span className="text-sm text-muted-foreground">Team Members</span>
                                    <span className="font-semibold">{teamMembers.length}</span>
                                </div>
                                <div className="flex items-center justify-between py-2 border-b">
                                    <span className="text-sm text-muted-foreground">Timezone</span>
                                    <span className="font-semibold">{dealership.timezone}</span>
                                </div>
                                <div className="flex items-center justify-between py-2 border-b">
                                    <span className="text-sm text-muted-foreground">Created</span>
                                    <span className="font-semibold">{new Date(dealership.created_at).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center justify-between py-2">
                                    <span className="text-sm text-muted-foreground">Last Updated</span>
                                    <span className="font-semibold">{new Date(dealership.updated_at).toLocaleDateString()}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings" className="space-y-6">
                    {/* Timezone */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Clock className="h-5 w-5 text-primary" />
                                <CardTitle>Timezone</CardTitle>
                            </div>
                            <CardDescription>
                                Set the timezone for this dealership for notifications, follow-ups, and appointments.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Select
                                value={dealership.timezone}
                                onValueChange={handleSaveTimezone}
                                disabled={isSaving}
                            >
                                <SelectTrigger className="w-full md:w-[300px]">
                                    <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent>
                                    {COMMON_TIMEZONES.map((tz) => (
                                        <SelectItem key={tz.value} value={tz.value}>
                                            {tz.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>

                    {/* Lead Stages */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <GitBranch className="h-5 w-5 text-primary" />
                                <CardTitle>Lead Stages</CardTitle>
                            </div>
                            <CardDescription className="space-y-2">
                                <p>Pipeline stages for this dealership (including any custom stages).</p>
                                <Link
                                    href={`/settings/lead-stages?dealership_id=${dealershipId}`}
                                    className="inline-block text-sm font-medium text-primary underline"
                                >
                                    Manage stages in Lead Stages settings
                                </Link>
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoadingStages ? (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {stages.map((stage) => (
                                        <Badge
                                            key={stage.id}
                                            style={{ backgroundColor: stage.color, color: "#fff" }}
                                        >
                                            {stage.display_name}
                                            {stage.is_terminal && " (Terminal)"}
                                        </Badge>
                                    ))}
                                    {stages.length === 0 && (
                                        <p className="text-sm text-muted-foreground">No stages configured</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Lead assignment rules */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-primary" />
                                <CardTitle>Lead assignment</CardTitle>
                            </div>
                            <CardDescription>
                                Rules used when assigning leads to salespeople for this dealership.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="la-auto">Auto-assign leads</Label>
                                <Switch
                                    id="la-auto"
                                    checked={laAutoAssign}
                                    onCheckedChange={setLaAutoAssign}
                                    disabled={isSavingLeadRules}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="la-rr">Round robin among salespeople</Label>
                                <Switch
                                    id="la-rr"
                                    checked={laRoundRobin}
                                    onCheckedChange={setLaRoundRobin}
                                    disabled={isSavingLeadRules}
                                />
                            </div>
                            <div className="space-y-2 max-w-xs">
                                <Label htmlFor="la-max">Max leads per salesperson</Label>
                                <Input
                                    id="la-max"
                                    type="number"
                                    min={1}
                                    max={500}
                                    value={laMaxLeads}
                                    onChange={(e) => setLaMaxLeads(Number(e.target.value) || 50)}
                                    disabled={isSavingLeadRules}
                                />
                            </div>
                            <Button onClick={handleSaveLeadAssignmentRules} disabled={isSavingLeadRules}>
                                {isSavingLeadRules ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Save className="h-4 w-4 mr-2" />
                                )}
                                Save assignment rules
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Working hours (read-only summary from backend JSON) */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Clock className="h-5 w-5 text-primary" />
                                <CardTitle>Working hours</CardTitle>
                            </div>
                            <CardDescription>
                                Stored on the dealership record. Edit via API or future scheduling UI; shown here for
                                reference.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {dealership.working_hours &&
                            typeof dealership.working_hours === "object" &&
                            Object.keys(dealership.working_hours).length > 0 ? (
                                <ul className="space-y-2 text-sm">
                                    {(
                                        [
                                            "monday",
                                            "tuesday",
                                            "wednesday",
                                            "thursday",
                                            "friday",
                                            "saturday",
                                            "sunday",
                                        ] as const
                                    ).map((day) => {
                                        const entry = (dealership.working_hours as Record<string, unknown>)[day] as
                                            | { start?: string; end?: string; is_open?: boolean }
                                            | undefined
                                        if (!entry) return null
                                        const open = entry.is_open !== false
                                        return (
                                            <li key={day} className="flex justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
                                                <span className="capitalize text-muted-foreground">{day}</span>
                                                <span className="font-medium">
                                                    {open && entry.start && entry.end
                                                        ? `${entry.start} – ${entry.end}`
                                                        : "Closed"}
                                                </span>
                                            </li>
                                        )
                                    })}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">No working hours configured.</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Communication Tab */}
                <TabsContent value="communication" className="space-y-6">
                    {configAccessStatus?.eligible && !configAccessStatus.config_access_password_set && (
                        <Alert>
                            <AlertTitle>Configuration password required</AlertTitle>
                            <AlertDescription className="flex flex-wrap items-center gap-2">
                                Set a separate password (not your login password) under{" "}
                                <Link href="/settings/security" className="font-medium text-primary underline">
                                    Security
                                </Link>{" "}
                                before you can view or edit Twilio integration settings.
                            </AlertDescription>
                        </Alert>
                    )}
                    {/* Twilio Configuration */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Smartphone className="h-5 w-5 text-primary" />
                                        <CardTitle>Twilio Configuration</CardTitle>
                                    </div>
                                    <CardDescription>
                                        Configure SMS, WhatsApp, and Voice calling via Twilio. Values are encrypted in the
                                        database; after you unlock with your configuration password, stored secrets load here
                                        so you can review them. Enter a new value only when rotating credentials.
                                    </CardDescription>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {configAccessStatus?.eligible &&
                                        configAccessStatus.config_access_password_set &&
                                        !allowTwilioIntegration && (
                                            <Button type="button" variant="outline" onClick={() => setShowConfigUnlockModal(true)}>
                                                Unlock
                                            </Button>
                                        )}
                                    <Button
                                        onClick={handleSaveTwilio}
                                        disabled={isSavingTwilio || isLoadingTwilio || !allowTwilioIntegration}
                                    >
                                        {isSavingTwilio ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                        Save Changes
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6 relative min-h-[120px]">
                            {isLoadingTwilio && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/60">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                            )}
                            {configAccessStatus?.eligible && !allowTwilioIntegration && (
                                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/85 p-4 text-center">
                                    {!configAccessStatus.config_access_password_set ? (
                                        <>
                                            <p className="text-sm text-muted-foreground max-w-sm">
                                                Create a configuration-access password in Security settings to continue.
                                            </p>
                                            <Button asChild>
                                                <Link href="/settings/security">Open Security</Link>
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm text-muted-foreground max-w-sm">
                                                Enter your configuration password to load and edit these settings (separate from
                                                your CRM login).
                                            </p>
                                            <Button type="button" onClick={() => setShowConfigUnlockModal(true)}>
                                                Enter configuration password
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}
                            {/* Account Credentials */}
                            <div className="space-y-4">
                                <h4 className="font-medium">Account Credentials</h4>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Account SID</Label>
                                        <Input
                                            value={twilioForm.account_sid || ""}
                                            onChange={(e) => setTwilioForm({ ...twilioForm, account_sid: e.target.value })}
                                            placeholder="ACxxxxxxxxxx"
                                            disabled={isLoadingTwilio || !allowTwilioIntegration}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Auth Token</Label>
                                        <div className="relative">
                                            <Input
                                                type={showTwilioAuthToken ? "text" : "password"}
                                                autoComplete="off"
                                                value={twilioForm.auth_token || ""}
                                                onChange={(e) => setTwilioForm({ ...twilioForm, auth_token: e.target.value })}
                                                placeholder={twilioConfig?.auth_token_set ? "••••••••••••" : "Enter auth token"}
                                                disabled={isLoadingTwilio || !allowTwilioIntegration}
                                                className="pr-10"
                                            />
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                aria-label={showTwilioAuthToken ? "Hide auth token" : "Show auth token"}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                                disabled={isLoadingTwilio || !allowTwilioIntegration}
                                                onClick={() => setShowTwilioAuthToken((v) => !v)}
                                            >
                                                {showTwilioAuthToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                        {twilioConfig?.auth_token_set && (
                                            <p className="text-xs text-muted-foreground">
                                                Stored encrypted. Leave blank to keep; enter a new value only to rotate.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* SMS */}
                            <div className="space-y-4 pt-4 border-t">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4" />
                                        <h4 className="font-medium">SMS</h4>
                                    </div>
                                    <Switch
                                        checked={twilioForm.sms_enabled ?? false}
                                        onCheckedChange={(checked) => setTwilioForm({ ...twilioForm, sms_enabled: checked })}
                                        disabled={isLoadingTwilio || !allowTwilioIntegration}
                                    />
                                </div>
                                {twilioForm.sms_enabled && (
                                    <div className="space-y-2">
                                        <Label>SMS From Number</Label>
                                        <Input
                                            value={twilioForm.sms_from_number || ""}
                                            onChange={(e) => setTwilioForm({ ...twilioForm, sms_from_number: e.target.value })}
                                            placeholder="+1234567890"
                                            disabled={isLoadingTwilio || !allowTwilioIntegration}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* WhatsApp */}
                            <div className="space-y-4 pt-4 border-t">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Send className="h-4 w-4" />
                                        <h4 className="font-medium">WhatsApp</h4>
                                    </div>
                                    <Switch
                                        checked={twilioForm.whatsapp_enabled ?? false}
                                        onCheckedChange={(checked) => setTwilioForm({ ...twilioForm, whatsapp_enabled: checked })}
                                        disabled={isLoadingTwilio || !allowTwilioIntegration}
                                    />
                                </div>
                                {twilioForm.whatsapp_enabled && (
                                    <div className="space-y-2">
                                        <Label>WhatsApp From Number</Label>
                                        <Input
                                            value={twilioForm.whatsapp_from_number || ""}
                                            onChange={(e) => setTwilioForm({ ...twilioForm, whatsapp_from_number: e.target.value })}
                                            placeholder="whatsapp:+1234567890"
                                            disabled={isLoadingTwilio || !allowTwilioIntegration}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Voice */}
                            <div className="space-y-4 pt-4 border-t">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <PhoneCall className="h-4 w-4" />
                                        <h4 className="font-medium">Voice (WebRTC)</h4>
                                    </div>
                                    <Switch
                                        checked={twilioForm.voice_enabled ?? false}
                                        onCheckedChange={(checked) => setTwilioForm({ ...twilioForm, voice_enabled: checked })}
                                        disabled={isLoadingTwilio || !allowTwilioIntegration}
                                    />
                                </div>
                                {twilioForm.voice_enabled && (
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>TwiML App SID</Label>
                                            <Input
                                                value={twilioForm.twilio_twiml_app_sid || ""}
                                                onChange={(e) => setTwilioForm({ ...twilioForm, twilio_twiml_app_sid: e.target.value })}
                                                placeholder="APxxxxxxxxxx"
                                                disabled={isLoadingTwilio || !allowTwilioIntegration}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>API Key SID</Label>
                                            <Input
                                                value={twilioForm.twilio_api_key_sid || ""}
                                                onChange={(e) => setTwilioForm({ ...twilioForm, twilio_api_key_sid: e.target.value })}
                                                placeholder="SKxxxxxxxxxx"
                                                disabled={isLoadingTwilio || !allowTwilioIntegration}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>API Key Secret</Label>
                                            <div className="relative">
                                                <Input
                                                    type={showTwilioApiKeySecret ? "text" : "password"}
                                                    autoComplete="off"
                                                    value={twilioForm.twilio_api_key_secret || ""}
                                                    onChange={(e) =>
                                                        setTwilioForm({ ...twilioForm, twilio_api_key_secret: e.target.value })
                                                    }
                                                    placeholder={twilioConfig?.api_key_secret_set ? "••••••••••••" : "Enter secret"}
                                                    disabled={isLoadingTwilio || !allowTwilioIntegration}
                                                    className="pr-10"
                                                />
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    aria-label={showTwilioApiKeySecret ? "Hide API key secret" : "Show API key secret"}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                                    disabled={isLoadingTwilio || !allowTwilioIntegration}
                                                    onClick={() => setShowTwilioApiKeySecret((v) => !v)}
                                                >
                                                    {showTwilioApiKeySecret ? (
                                                        <EyeOff className="h-4 w-4" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>
                                            {twilioConfig?.api_key_secret_set && (
                                                <p className="text-xs text-muted-foreground">
                                                    Stored encrypted. Leave blank to keep; enter a new value only to rotate.
                                                </p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Caller ID Number</Label>
                                            <Input
                                                value={twilioForm.voice_caller_id_number || ""}
                                                onChange={(e) => setTwilioForm({ ...twilioForm, voice_caller_id_number: e.target.value })}
                                                placeholder="+1234567890"
                                                disabled={isLoadingTwilio || !allowTwilioIntegration}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Email Configuration */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Mail className="h-5 w-5 text-primary" />
                                <CardTitle>Email Configuration</CardTitle>
                            </div>
                            <CardDescription>
                                SMTP/IMAP configuration for sending and receiving emails. Mailbox passwords are stored
                                encrypted in the database and are not returned by the API after save.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoadingEmail ? (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : emailStatus?.has_config ? (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <Badge variant={emailStatus.is_verified ? "default" : "secondary"}>
                                            {emailStatus.is_verified ? "Verified" : "Not Verified"}
                                        </Badge>
                                        <Badge variant={emailStatus.is_active ? "default" : "destructive"}>
                                            {emailStatus.is_active ? "Active" : "Inactive"}
                                        </Badge>
                                    </div>
                                    {emailStatus.smtp_host && (
                                        <p className="text-sm text-muted-foreground">
                                            SMTP Host: {emailStatus.smtp_host}
                                        </p>
                                    )}
                                    <Button
                                        variant="outline"
                                        onClick={() => router.push(`/settings/dealership-email?dealership_id=${dealershipId}`)}
                                    >
                                        Manage Email Settings
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <Mail className="h-12 w-12 mx-auto text-muted-foreground/20" />
                                    <p className="mt-2 text-sm text-muted-foreground">No email configuration</p>
                                    <Button
                                        variant="outline"
                                        className="mt-4"
                                        onClick={() => router.push(`/settings/dealership-email?dealership_id=${dealershipId}`)}
                                    >
                                        Configure Email
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Team Tab */}
                <TabsContent value="team" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Team Members</CardTitle>
                                <CardDescription>Manage users assigned to this dealership</CardDescription>
                            </div>
                            <Button onClick={() => setShowCreateUser(true)}>
                                <Users className="h-4 w-4 mr-2" />
                                Add Team Member
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {isLoadingTeam ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                            ) : teamMembers.length === 0 ? (
                                <div className="text-center py-8">
                                    <Users className="h-12 w-12 mx-auto text-muted-foreground/20" />
                                    <p className="mt-2 text-sm text-muted-foreground">No team members yet</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {teamMembers.map((member) => (
                                        <div
                                            key={member.id}
                                            className={cn(
                                                "flex items-center justify-between p-4 rounded-lg border",
                                                !member.is_active && "opacity-60"
                                            )}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                    <span className="text-sm font-medium text-primary">
                                                        {member.first_name[0]}{member.last_name[0]}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="font-medium">
                                                        {member.first_name} {member.last_name}
                                                    </p>
                                                    <p className="text-sm text-muted-foreground">{member.email}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <Badge variant="outline">{member.role}</Badge>
                                                <div className="text-right text-sm">
                                                    <p className="font-medium">{member.active_leads} active leads</p>
                                                    <p className="text-muted-foreground">{member.conversion_rate}% conversion</p>
                                                </div>
                                                {togglingTeamUserId === member.id ? (
                                                    <div className="flex h-9 w-11 items-center justify-center">
                                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                                                        <span className="sr-only">Updating status…</span>
                                                    </div>
                                                ) : (
                                                    <Switch
                                                        checked={member.is_active}
                                                        disabled={togglingTeamUserId === member.id}
                                                        onCheckedChange={(checked) =>
                                                            handleToggleUserStatus(member.id, checked)
                                                        }
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Status Toggle Dialog */}
            <AlertDialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {dealership.is_active ? "Deactivate Dealership" : "Activate Dealership"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {dealership.is_active
                                ? "This will deactivate the dealership. Users will not be able to access the CRM until reactivated."
                                : "This will activate the dealership. Users will be able to access the CRM."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleToggleStatus} disabled={isSaving}>
                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            {dealership.is_active ? "Deactivate" : "Activate"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Create User Dialog */}
            <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Team Member</DialogTitle>
                        <DialogDescription>
                            Create a new user for this dealership. They will receive an email to set up their account.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>First Name</Label>
                                <Input
                                    value={newUserForm.first_name}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, first_name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Last Name</Label>
                                <Input
                                    value={newUserForm.last_name}
                                    onChange={(e) => setNewUserForm({ ...newUserForm, last_name: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                type="email"
                                value={newUserForm.email}
                                onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input
                                value={newUserForm.phone || ""}
                                onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input
                                type="password"
                                value={newUserForm.password}
                                onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select
                                value={newUserForm.role}
                                onValueChange={(value) => setNewUserForm({ ...newUserForm, role: value as UserRole })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="salesperson">Salesperson</SelectItem>
                                    <SelectItem value="dealership_admin">Dealership Admin</SelectItem>
                                    <SelectItem value="dealership_owner">Dealership Owner</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateUser(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateUser} disabled={isCreatingUser}>
                            {isCreatingUser ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Create User
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfigUnlockModal
                open={showConfigUnlockModal}
                onOpenChange={setShowConfigUnlockModal}
                needsSetup={false}
                onUnlocked={() => {
                    setAllowTwilioIntegration(true)
                    loadTwilioConfig()
                }}
            />
        </div>
    )
}
