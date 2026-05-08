"use client"

import * as React from "react"
import Link from "next/link"
import { subDays, startOfDay, endOfDay } from "date-fns"
import {
    Users,
    UserPlus,
    Search,
    Mail,
    Shield,
    MoreVertical,
    Loader2,
    Building2,
    Phone,
    TrendingUp,
    Inbox,
    CheckCircle,
    XCircle,
    Eye,
    EyeOff,
    Bell,
    ClipboardList,
    Target,
    Percent,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { UserAvatar } from "@/components/ui/avatar"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
    TableLoading
} from "@/components/ui/table"
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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TeamService, UserWithStats, CreateUserData } from "@/services/team-service"
import {
    ReportsService,
    type TeamTouchSalesMetricsResponse,
} from "@/services/reports-service"
import { useRole, getRoleDisplayName } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { BarChart } from "@tremor/react"
import { SalespersonPendingTasksModal } from "@/components/team/salesperson-pending-tasks-modal"
import { NotifySalespersonDialog } from "@/components/team/notify-salesperson-dialog"

export default function TeamPage() {
    const { toast } = useToast()
    const { isSuperAdmin, isDealershipOwner, isDealershipAdmin, isDealershipLevel, user } = useRole()
    const [team, setTeam] = React.useState<UserWithStats[]>([])
    const [dealershipName, setDealershipName] = React.useState<string | null>(null)
    const [teamDealershipId, setTeamDealershipId] = React.useState<string | null>(null)
    const [touchMetrics, setTouchMetrics] = React.useState<TeamTouchSalesMetricsResponse | null>(null)
    const [touchMetricsLoading, setTouchMetricsLoading] = React.useState(false)
    const [isLoading, setIsLoading] = React.useState(true)
    const [search, setSearch] = React.useState("")
    
    // Add member modal
    const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
    const [newMember, setNewMember] = React.useState<Partial<CreateUserData>>({
        role: "salesperson"
    })
    const [showPassword, setShowPassword] = React.useState(false)
    
    // Pending tasks and notify modals
    const [pendingTasksOpen, setPendingTasksOpen] = React.useState(false)
    const [notifyDialogOpen, setNotifyDialogOpen] = React.useState(false)
    const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)
    const [selectedUserName, setSelectedUserName] = React.useState<string>("")
    // Deactivate/activate confirmation (only admin or owner can deactivate)
    const [toggleStatusConfirm, setToggleStatusConfirm] = React.useState<{
        userId: string
        userName: string
        isActive: boolean
    } | null>(null)
    const [isTogglingStatus, setIsTogglingStatus] = React.useState(false)
    const [togglingUserId, setTogglingUserId] = React.useState<string | null>(null)

    const fetchTeam = React.useCallback(async () => {
        try {
            const data = await TeamService.getTeamWithStats()
            setTeam(data.items)
            setDealershipName(data.dealership_name || null)
            setTeamDealershipId(data.dealership_id ? String(data.dealership_id) : null)
        } catch (error) {
            console.error("Failed to fetch team:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchTeam()
    }, [fetchTeam])

    React.useEffect(() => {
        const dealershipKey = teamDealershipId ?? user?.dealership_id
        if (!dealershipKey) {
            setTouchMetrics(null)
            return
        }
        let cancelled = false
        setTouchMetricsLoading(true)
        ;(async () => {
            try {
                const from = startOfDay(subDays(new Date(), 29))
                const to = endOfDay(new Date())
                const res = await ReportsService.getTeamTouchSalesMetrics({
                    date_from: from.toISOString(),
                    date_to: to.toISOString(),
                    ...(isSuperAdmin ? { dealership_id: dealershipKey } : {}),
                })
                if (!cancelled) setTouchMetrics(res)
            } catch (e) {
                console.error("Failed to load touch metrics:", e)
                if (!cancelled) setTouchMetrics(null)
            } finally {
                if (!cancelled) setTouchMetricsLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [teamDealershipId, user?.dealership_id, isSuperAdmin])

    const filteredTeam = team.filter(member =>
        member.first_name.toLowerCase().includes(search.toLowerCase()) ||
        member.last_name.toLowerCase().includes(search.toLowerCase()) ||
        member.email.toLowerCase().includes(search.toLowerCase())
    )

    const handleAddMember = async () => {
        setAddMemberError(null)
        
        if (!newMember.email || !newMember.first_name || !newMember.last_name || !newMember.password) {
            setAddMemberError("Please fill in all required fields")
            return
        }
        
        if (newMember.password.length < 6) {
            setAddMemberError("Password must be at least 6 characters")
            return
        }
        
        setIsSubmitting(true)
        try {
            await TeamService.createUser(newMember as CreateUserData)
            setIsAddModalOpen(false)
            setNewMember({ role: "salesperson" })
            setAddMemberError(null)
            fetchTeam()
        } catch (error: any) {
            console.error("Failed to add member:", error)
            const detail = error?.response?.data?.detail
            if (typeof detail === "string") {
                setAddMemberError(detail)
            } else if (Array.isArray(detail)) {
                // Pydantic validation errors
                setAddMemberError(detail.map((d: any) => d.msg).join(", "))
            } else {
                setAddMemberError("Failed to add team member. Please try again.")
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleToggleStatusClick = (member: UserWithStats) => {
        if (member.is_active) {
            setToggleStatusConfirm({
                userId: member.id,
                userName: `${member.first_name} ${member.last_name}`,
                isActive: true,
            })
        } else {
            handleToggleStatus(member.id, member.is_active)
        }
    }

    const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
        const member = team.find((m) => m.id === userId)
        const name = member ? `${member.first_name} ${member.last_name}`.trim() : "Team member"
        try {
            setIsTogglingStatus(true)
            setTogglingUserId(userId)
            await TeamService.toggleUserStatus(userId, !currentStatus)
            setToggleStatusConfirm(null)
            await fetchTeam()
            const nowActive = !currentStatus
            toast({
                title: nowActive ? "Member activated" : "Member deactivated",
                description: nowActive
                    ? `${name} can sign in again.`
                    : `${name} can no longer sign in until reactivated.`,
            })
        } catch (error) {
            console.error("Failed to toggle status:", error)
            toast({
                variant: "destructive",
                title: "Could not update status",
                description: "Please try again or check your connection.",
            })
        } finally {
            setIsTogglingStatus(false)
            setTogglingUserId(null)
        }
    }

    const handleConfirmDeactivate = () => {
        if (!toggleStatusConfirm) return
        handleToggleStatus(toggleStatusConfirm.userId, toggleStatusConfirm.isActive)
    }

    // Calculate team stats
    const totalLeads = team.reduce((sum, m) => sum + m.total_leads, 0)
    const totalConverted = team.reduce((sum, m) => sum + m.converted_leads, 0)
    const avgConversionRate = team.length > 0 
        ? (team.reduce((sum, m) => sum + m.conversion_rate, 0) / team.length).toFixed(1)
        : "0"

    // Chart data
    const chartData = filteredTeam.slice(0, 8).map(m => ({
        name: `${m.first_name} ${m.last_name.charAt(0)}.`,
        "Active": m.active_leads,
        "Converted": m.converted_leads
    }))

    // Access check - Super Admin, Dealership Owner, or Dealership Admin
    if (!isSuperAdmin && !isDealershipLevel) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Card className="max-w-md">
                    <CardContent className="p-6 text-center">
                        <Users className="mx-auto h-12 w-12 text-muted-foreground/20" />
                        <h2 className="mt-4 text-lg font-semibold">Access Restricted</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Team management is only available to Dealership Owners, Admins, and Super Admins.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Team Management</h1>
                    <p className="text-muted-foreground">
                        {dealershipName 
                            ? `Manage your team at ${dealershipName}`
                            : "Manage your dealership staff and permissions."
                        }
                    </p>
                </div>
                <Button onClick={() => { setAddMemberError(null); setIsAddModalOpen(true); }} leftIcon={<UserPlus className="h-4 w-4" />}>
                    Add Team Member
                </Button>
            </div>

            {/* Stats Row */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-blue-500/10 p-2">
                                <Users className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{team.length}</p>
                                <p className="text-xs text-muted-foreground">Team Members</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-purple-500/10 p-2">
                                <Inbox className="h-5 w-5 text-purple-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalLeads}</p>
                                <p className="text-xs text-muted-foreground">Total Leads</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-emerald-500/10 p-2">
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalConverted}</p>
                                <p className="text-xs text-muted-foreground">Converted</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-amber-500/10 p-2">
                                <TrendingUp className="h-5 w-5 text-amber-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{avgConversionRate}%</p>
                                <p className="text-xs text-muted-foreground">Avg. Conversion</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {(touchMetricsLoading || touchMetrics) && (
                <Card>
                    <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
                        <div>
                            <CardTitle className="text-base">
                                Sales team touch & close (last 30 days)
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                Each lead counts once (note or call in the period). Active
                                salespeople only; your activity excluded. Sold dates match Reports →
                                Sold Cars.
                            </p>
                        </div>
                        <Button variant="outline" size="sm" asChild className="shrink-0">
                            <Link href="/reports/team-sales-touch">Open in Reports</Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {touchMetricsLoading && !touchMetrics ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : touchMetrics ? (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                                    <div className="rounded-lg bg-violet-500/10 p-2">
                                        <Target className="h-5 w-5 text-violet-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {touchMetrics.unique_leads_touched.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-muted-foreground">Unique leads (notes/calls)</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                                    <div className="rounded-lg bg-blue-500/10 p-2">
                                        <Users className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {touchMetrics.avg_leads_touched_per_salesperson}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Avg per salesperson ({touchMetrics.salespeople_count} reps)
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                                    <div className="rounded-lg bg-emerald-500/10 p-2">
                                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {touchMetrics.sold_among_touched.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-muted-foreground">Sold (among touched)</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
                                    <div className="rounded-lg bg-amber-500/10 p-2">
                                        <Percent className="h-5 w-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{touchMetrics.closing_percentage}%</p>
                                        <p className="text-xs text-muted-foreground">Closing rate</p>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            )}

            {/* Performance Chart */}
            {team.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Team Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <BarChart
                            data={chartData}
                            index="name"
                            categories={["Active", "Converted"]}
                            colors={["blue", "emerald"]}
                            className="h-48"
                            stack
                        />
                    </CardContent>
                </Card>
            )}

            {/* Search */}
            <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="max-w-sm"
            />

            {/* Team Table */}
            <Card>
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>Team Member</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="text-right">Active Leads</TableHead>
                            <TableHead className="text-right">Converted</TableHead>
                            <TableHead className="text-right">Conversion Rate</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableLoading columns={7} rows={5} />
                        ) : filteredTeam.length === 0 ? (
                            <TableEmpty
                                icon={<Users className="h-10 w-10" />}
                                title={search ? "No members found" : "No team members yet"}
                                description={search ? "Try adjusting your search" : "Add your first team member to get started"}
                                action={
                                    !search && (
                                        <Button size="sm" onClick={() => { setAddMemberError(null); setIsAddModalOpen(true); }}>
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            Add Member
                                        </Button>
                                    )
                                }
                            />
                        ) : (
                            filteredTeam.map((member) => (
                                <TableRow key={member.id} className="hover:bg-muted/30">
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <UserAvatar user={member} size="md" />
                                            <div>
                                                <p className="font-semibold">
                                                    {member.first_name} {member.last_name}
                                                </p>
                                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <Mail className="h-3 w-3" />
                                                    {member.email}
                                                </p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={getRoleVariant(member.role)}>
                                            {getRoleDisplayName(member.role)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {member.active_leads}
                                    </TableCell>
                                    <TableCell className="text-right text-emerald-600 font-medium">
                                        {member.converted_leads}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={cn(
                                            "font-bold",
                                            member.conversion_rate >= 20 ? "text-emerald-600" :
                                            member.conversion_rate >= 10 ? "text-amber-600" : "text-muted-foreground"
                                        )}>
                                            {member.conversion_rate}%
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        {togglingUserId === member.id ? (
                                            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Updating...
                                            </span>
                                        ) : (
                                            <Badge variant={member.is_active ? "interested" : "not_interested"}>
                                                {member.is_active ? "Active" : "Inactive"}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" disabled={togglingUserId === member.id}>
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {/* Show pending tasks for salespersons */}
                                                {member.role === "salesperson" && (isDealershipOwner || isDealershipAdmin) && (
                                                    <>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedUserId(member.id)
                                                                setSelectedUserName(`${member.first_name} ${member.last_name}`)
                                                                setPendingTasksOpen(true)
                                                            }}
                                                        >
                                                            <ClipboardList className="mr-2 h-4 w-4" />
                                                            View Pending Tasks
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelectedUserId(member.id)
                                                                setSelectedUserName(`${member.first_name} ${member.last_name}`)
                                                                setNotifyDialogOpen(true)
                                                            }}
                                                        >
                                                            <Bell className="mr-2 h-4 w-4" />
                                                            Send Notification
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                    </>
                                                )}
                                                <DropdownMenuItem>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    View Profile
                                                </DropdownMenuItem>
                                                <DropdownMenuItem>
                                                    <Mail className="mr-2 h-4 w-4" />
                                                    Send Email
                                                </DropdownMenuItem>
                                                {/* Only dealership admin or owner can deactivate/activate team members; cannot deactivate yourself */}
                                                {(isSuperAdmin || isDealershipAdmin || isDealershipOwner) && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem 
                                                            onClick={() => user?.id !== member.id && handleToggleStatusClick(member)}
                                                            disabled={user?.id === member.id}
                                                            className={cn(
                                                                member.is_active ? "text-rose-600" : "text-emerald-600",
                                                                user?.id === member.id && "opacity-50 cursor-not-allowed"
                                                            )}
                                                        >
                                                            {member.is_active ? (
                                                                <>
                                                                    <XCircle className="mr-2 h-4 w-4" />
                                                                    Deactivate
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <CheckCircle className="mr-2 h-4 w-4" />
                                                                    Activate
                                                                </>
                                                            )}
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>

            {/* Add Member Modal */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-primary" />
                            Add Team Member
                        </DialogTitle>
                        <DialogDescription>
                            Add a new salesperson or admin to your team.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-2 block">First Name</label>
                                <Input
                                    value={newMember.first_name || ""}
                                    onChange={(e) => setNewMember({ ...newMember, first_name: e.target.value })}
                                    placeholder="John"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Last Name</label>
                                <Input
                                    value={newMember.last_name || ""}
                                    onChange={(e) => setNewMember({ ...newMember, last_name: e.target.value })}
                                    placeholder="Doe"
                                />
                            </div>
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium mb-2 block">Email</label>
                            <Input
                                type="email"
                                value={newMember.email || ""}
                                onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                                placeholder="john@example.com"
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-2 block">Phone (Optional)</label>
                            <Input
                                type="tel"
                                value={newMember.phone || ""}
                                onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                                placeholder="+1 234 567 8900"
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-2 block">Password</label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={newMember.password || ""}
                                    onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                                    placeholder="Minimum 6 characters"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-2 block">Role</label>
                            <Select 
                                value={newMember.role} 
                                onValueChange={(value) => setNewMember({ ...newMember, role: value as any })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="salesperson">Salesperson</SelectItem>
                                    {/* Dealership Owner can add Admins, Dealership Admin cannot */}
                                    {(isSuperAdmin || isDealershipOwner) && (
                                        <SelectItem value="dealership_admin">Dealership Admin</SelectItem>
                                    )}
                                    {isSuperAdmin && (
                                        <>
                                            <SelectItem value="dealership_owner">Dealership Owner</SelectItem>
                                            <SelectItem value="super_admin">Super Admin</SelectItem>
                                        </>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        {addMemberError && (
                            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
                                {addMemberError}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddModalOpen(false)} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleAddMember}
                            disabled={!newMember.email || !newMember.first_name || !newMember.last_name || !newMember.password || isSubmitting}
                            loading={isSubmitting}
                            loadingText="Adding..."
                        >
                            Add Member
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Pending Tasks Modal */}
            {selectedUserId && (
                <SalespersonPendingTasksModal
                    open={pendingTasksOpen}
                    onOpenChange={setPendingTasksOpen}
                    userId={selectedUserId}
                    userName={selectedUserName}
                    onNotifyClick={() => {
                        setPendingTasksOpen(false)
                        setNotifyDialogOpen(true)
                    }}
                />
            )}

            {/* Notify Salesperson Dialog */}
            {selectedUserId && (
                <NotifySalespersonDialog
                    open={notifyDialogOpen}
                    onOpenChange={setNotifyDialogOpen}
                    userId={selectedUserId}
                    userName={selectedUserName}
                />
            )}

            {/* Deactivate team member confirmation (admin/owner only) */}
            <AlertDialog open={!!toggleStatusConfirm} onOpenChange={(open) => !open && setToggleStatusConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate team member?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {toggleStatusConfirm && (
                                <>
                                    <strong>{toggleStatusConfirm.userName}</strong> will be deactivated and will no longer be able to sign in. They will see a message to contact an administrator or owner to reactivate their account. You can reactivate them anytime from this page.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isTogglingStatus}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDeactivate}
                            disabled={isTogglingStatus}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isTogglingStatus ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Deactivating...
                                </>
                            ) : (
                                "Deactivate"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
