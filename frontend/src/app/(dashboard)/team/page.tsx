"use client"

import * as React from "react"
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
import { useRole, getRoleDisplayName } from "@/hooks/use-role"
import { cn } from "@/lib/utils"
import { BarChart } from "@tremor/react"
import { SalespersonPendingTasksModal } from "@/components/team/salesperson-pending-tasks-modal"
import { NotifySalespersonDialog } from "@/components/team/notify-salesperson-dialog"

export default function TeamPage() {
    const { isSuperAdmin, isDealershipOwner, isDealershipAdmin, isDealershipLevel, user } = useRole()
    const [team, setTeam] = React.useState<UserWithStats[]>([])
    const [dealershipName, setDealershipName] = React.useState<string | null>(null)
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

    const fetchTeam = React.useCallback(async () => {
        try {
            const data = await TeamService.getTeamWithStats()
            setTeam(data.items)
            setDealershipName(data.dealership_name || null)
        } catch (error) {
            console.error("Failed to fetch team:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchTeam()
    }, [fetchTeam])

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

    const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
        try {
            await TeamService.toggleUserStatus(userId, !currentStatus)
            fetchTeam()
        } catch (error) {
            console.error("Failed to toggle status:", error)
        }
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
                                        <Badge variant={member.is_active ? "interested" : "not_interested"}>
                                            {member.is_active ? "Active" : "Inactive"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon">
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
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem 
                                                    onClick={() => handleToggleStatus(member.id, member.is_active)}
                                                    className={member.is_active ? "text-rose-600" : "text-emerald-600"}
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
        </div>
    )
}
