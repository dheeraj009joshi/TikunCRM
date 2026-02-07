"use client"

import * as React from "react"
import { Building2, Loader2, Users, ArrowUpDown } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge, getRoleVariant } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { DealershipService, Dealership } from "@/services/dealership-service"
import { TeamService, UserBrief } from "@/services/team-service"
import { LeadService, Lead } from "@/services/lead-service"
import { useRole } from "@/hooks/use-role"

interface AssignToDealershipModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedLeads: Lead[]
    onSuccess: () => void
}

export function AssignToDealershipModal({
    open,
    onOpenChange,
    selectedLeads,
    onSuccess
}: AssignToDealershipModalProps) {
    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [selectedDealership, setSelectedDealership] = React.useState<string>("")
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    React.useEffect(() => {
        if (open) {
            setIsLoading(true)
            DealershipService.listDealerships({ is_active: true })
                .then(setDealerships)
                .catch(console.error)
                .finally(() => setIsLoading(false))
        }
    }, [open])

    const handleAssign = async () => {
        if (!selectedDealership || selectedLeads.length === 0) return

        setIsSubmitting(true)
        try {
            if (selectedLeads.length === 1) {
                await LeadService.assignToDealership(selectedLeads[0].id, selectedDealership)
            } else {
                await LeadService.bulkAssignToDealership(
                    selectedLeads.map(l => l.id),
                    selectedDealership
                )
            }
            onSuccess()
            onOpenChange(false)
            setSelectedDealership("")
        } catch (error) {
            console.error("Failed to assign leads:", error)
        } finally {
            setIsSubmitting(false)
        }
    }

    const selectedDealershipName = dealerships.find(d => d.id === selectedDealership)?.name

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-primary" />
                        Assign to Dealership
                    </DialogTitle>
                    <DialogDescription>
                        {selectedLeads.length === 1 
                            ? `Assign "${selectedLeads[0].first_name} ${selectedLeads[0].last_name || ''}" to a dealership.`
                            : `Assign ${selectedLeads.length} selected leads to a dealership.`
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <label className="text-sm font-medium mb-2 block">
                        Select Dealership
                    </label>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-10">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Select value={selectedDealership} onValueChange={setSelectedDealership}>
                            <SelectTrigger>
                                <SelectValue placeholder="Choose a dealership..." />
                            </SelectTrigger>
                            <SelectContent>
                                {dealerships.map((dealership) => (
                                    <SelectItem key={dealership.id} value={dealership.id}>
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary text-xs font-bold">
                                                {dealership.name.charAt(0)}
                                            </div>
                                            {dealership.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <DialogFooter>
                    <Button 
                        variant="outline" 
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleAssign}
                        disabled={!selectedDealership || isSubmitting}
                        loading={isSubmitting}
                        loadingText="Assigning..."
                    >
                        Assign {selectedLeads.length > 1 ? `${selectedLeads.length} Leads` : "Lead"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


interface AssignToSalespersonModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    lead: Lead | null
    onSuccess: () => void
}

export function AssignToSalespersonModal({
    open,
    onOpenChange,
    lead,
    onSuccess
}: AssignToSalespersonModalProps) {
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    const isAdmin = isDealershipAdmin || isDealershipOwner || isSuperAdmin
    
    const [teamMembers, setTeamMembers] = React.useState<UserBrief[]>([])
    const [selectedSalesperson, setSelectedSalesperson] = React.useState<string>("")
    const [selectedSecondary, setSelectedSecondary] = React.useState<string>("none")
    const [isLoading, setIsLoading] = React.useState(false)
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [isSwapping, setIsSwapping] = React.useState(false)

    const isReassigning = lead?.assigned_to !== undefined && lead?.assigned_to !== null
    const hasBothAssigned = lead?.assigned_to && lead?.secondary_salesperson_id

    React.useEffect(() => {
        if (open && lead?.dealership_id) {
            setIsLoading(true)
            TeamService.getSalespersons(lead.dealership_id)
                .then((members) => {
                    setTeamMembers(members)
                    // Pre-select currently assigned users
                    if (lead.assigned_to) {
                        setSelectedSalesperson(lead.assigned_to)
                    } else {
                        setSelectedSalesperson("")
                    }
                    if (lead.secondary_salesperson_id) {
                        setSelectedSecondary(lead.secondary_salesperson_id)
                    } else {
                        setSelectedSecondary("none")
                    }
                })
                .catch(console.error)
                .finally(() => setIsLoading(false))
        } else if (open) {
            setSelectedSalesperson("")
            setSelectedSecondary("none")
        }
    }, [open, lead?.dealership_id, lead?.assigned_to, lead?.secondary_salesperson_id])

    const handleAssign = async () => {
        if (!selectedSalesperson || !lead) return

        setIsSubmitting(true)
        try {
            // Assign primary
            await LeadService.assignToSalesperson(lead.id, selectedSalesperson)
            
            // If admin and secondary is different from current, update it
            if (isAdmin) {
                const newSecondary = selectedSecondary === "none" ? null : selectedSecondary
                const currentSecondary = lead.secondary_salesperson_id || null
                if (newSecondary !== currentSecondary && newSecondary !== selectedSalesperson) {
                    await LeadService.assignSecondarySalesperson(lead.id, newSecondary)
                }
            }
            
            onSuccess()
            onOpenChange(false)
            setSelectedSalesperson("")
            setSelectedSecondary("none")
        } catch (error) {
            console.error("Failed to assign lead:", error)
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSwap = async () => {
        if (!lead || !hasBothAssigned) return
        
        setIsSwapping(true)
        try {
            await LeadService.swapSalespersons(lead.id)
            onSuccess()
            onOpenChange(false)
        } catch (error) {
            console.error("Failed to swap salespersons:", error)
        } finally {
            setIsSwapping(false)
        }
    }

    if (!lead) return null

    const getRoleDisplayName = (role: string) => {
        switch (role) {
            case 'dealership_owner':
                return 'Owner'
            case 'dealership_admin':
                return 'Admin'
            case 'salesperson':
                return 'Sales'
            default:
                return role
        }
    }

    // Filter out selected primary from secondary options
    const secondaryOptions = teamMembers.filter(m => m.id !== selectedSalesperson)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        {isReassigning ? 'Reassign Lead' : 'Assign to Team Member'}
                    </DialogTitle>
                    <DialogDescription>
                        {isReassigning 
                            ? `Reassign "${lead.first_name} ${lead.last_name || ''}" to a different team member.`
                            : `Assign "${lead.first_name} ${lead.last_name || ''}" to a team member.`
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Salesperson</Label>
                        {isLoading ? (
                            <div className="flex items-center justify-center h-10">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : teamMembers.length === 0 ? (
                            <div className="text-center py-4 text-sm text-muted-foreground">
                                No team members available in this dealership.
                            </div>
                        ) : (
                            <Select value={selectedSalesperson} onValueChange={setSelectedSalesperson}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose primary salesperson..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {teamMembers.map((person) => (
                                        <SelectItem key={person.id} value={person.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-purple-500 text-white text-xs font-bold">
                                                    {person.first_name.charAt(0)}{person.last_name.charAt(0)}
                                                </div>
                                                <span>{person.first_name} {person.last_name}</span>
                                                <Badge variant={getRoleVariant(person.role)} size="sm">
                                                    {getRoleDisplayName(person.role)}
                                                </Badge>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Secondary salesperson - Admin only */}
                    {isAdmin && teamMembers.length > 1 && (
                        <div className="space-y-2">
                            <Label>Secondary Salesperson (Optional)</Label>
                            <Select value={selectedSecondary} onValueChange={setSelectedSecondary}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No secondary salesperson" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">
                                        <span className="text-muted-foreground">No secondary salesperson</span>
                                    </SelectItem>
                                    {secondaryOptions.map((person) => (
                                        <SelectItem key={person.id} value={person.id}>
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 text-white text-xs font-bold">
                                                    {person.first_name.charAt(0)}{person.last_name.charAt(0)}
                                                </div>
                                                <span>{person.first_name} {person.last_name}</span>
                                                <Badge variant={getRoleVariant(person.role)} size="sm">
                                                    {getRoleDisplayName(person.role)}
                                                </Badge>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Secondary salesperson shares the deal (0.5 credit each in reports).
                            </p>
                        </div>
                    )}

                    {/* Swap button - only show if both are assigned */}
                    {isAdmin && hasBothAssigned && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSwap}
                            disabled={isSwapping}
                            className="w-full"
                        >
                            {isSwapping ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <ArrowUpDown className="h-4 w-4 mr-2" />
                            )}
                            Swap Primary & Secondary
                        </Button>
                    )}
                </div>

                <DialogFooter>
                    <Button 
                        variant="outline" 
                        onClick={() => {
                            onOpenChange(false)
                            setSelectedSalesperson("")
                            setSelectedSecondary("none")
                        }}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleAssign}
                        disabled={!selectedSalesperson || isSubmitting || (isReassigning && selectedSalesperson === lead.assigned_to && selectedSecondary === (lead.secondary_salesperson_id || "none"))}
                        loading={isSubmitting}
                        loadingText={isReassigning ? "Reassigning..." : "Assigning..."}
                    >
                        {isReassigning ? 'Reassign Lead' : 'Assign Lead'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
