"use client"

import * as React from "react"
import { Loader2, UserPlus, Mail, Phone, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { UserService } from "@/services/user-service"
import { DealershipService } from "@/services/dealership-service"
import { useRole } from "@/hooks/use-role"

interface CreateUserModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    defaultDealershipId?: string
}

const ROLE_OPTIONS = [
    { value: "salesperson", label: "Salesperson" },
    { value: "dealership_admin", label: "Dealership Admin" },
    { value: "dealership_manager", label: "Dealership Manager" },
]

const SUPER_ADMIN_ROLE_OPTIONS = [
    ...ROLE_OPTIONS,
    { value: "super_admin", label: "Super Admin" },
]

export function CreateUserModal({ isOpen, onClose, onSuccess, defaultDealershipId }: CreateUserModalProps) {
    const { isSuperAdmin } = useRole()
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const [dealerships, setDealerships] = React.useState<any[]>([])
    
    const [formData, setFormData] = React.useState({
        email: "",
        password: "",
        first_name: "",
        last_name: "",
        phone: "",
        role: "salesperson",
        dealership_id: defaultDealershipId || "",
    })

    React.useEffect(() => {
        if (isOpen && isSuperAdmin) {
            loadDealerships()
        }
    }, [isOpen, isSuperAdmin])

    React.useEffect(() => {
        if (defaultDealershipId) {
            setFormData(prev => ({ ...prev, dealership_id: defaultDealershipId }))
        }
    }, [defaultDealershipId])

    const loadDealerships = async () => {
        try {
            const data = await DealershipService.listDealerships()
            setDealerships(data)
        } catch (err) {
            console.error("Failed to load dealerships:", err)
        }
    }

    const resetForm = () => {
        setFormData({
            email: "",
            password: "",
            first_name: "",
            last_name: "",
            phone: "",
            role: "salesperson",
            dealership_id: defaultDealershipId || "",
        })
        setError("")
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        
        if (!formData.email.trim()) {
            setError("Email is required")
            return
        }
        
        if (!formData.password || formData.password.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }
        
        if (!formData.first_name.trim()) {
            setError("First name is required")
            return
        }

        if (formData.role !== "super_admin" && !formData.dealership_id) {
            setError("Please select a dealership")
            return
        }

        setIsLoading(true)
        setError("")

        try {
            const payload = {
                ...formData,
                dealership_id: formData.role === "super_admin" ? null : formData.dealership_id,
            }
            await UserService.createUser(payload)
            resetForm()
            onSuccess?.()
            onClose()
        } catch (err: any) {
            console.error("Failed to create user:", err)
            setError(err?.response?.data?.detail || "Failed to create user. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    const roleOptions = isSuperAdmin ? SUPER_ADMIN_ROLE_OPTIONS : ROLE_OPTIONS

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserPlus className="h-5 w-5" />
                        Add Team Member
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Name Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="first_name">First Name *</Label>
                            <Input
                                id="first_name"
                                placeholder="John"
                                value={formData.first_name}
                                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="last_name">Last Name</Label>
                            <Input
                                id="last_name"
                                placeholder="Doe"
                                value={formData.last_name}
                                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Email */}
                    <div className="space-y-2">
                        <Label htmlFor="email">Email *</Label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="email"
                                type="email"
                                placeholder="john@dealership.com"
                                className="pl-9"
                                value={formData.email}
                                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-2">
                        <Label htmlFor="password">Password *</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="Min 6 characters"
                            value={formData.password}
                            onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                        />
                    </div>

                    {/* Phone */}
                    <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="phone"
                                placeholder="+1 234 567 8900"
                                className="pl-9"
                                value={formData.phone}
                                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Role */}
                    <div className="space-y-2">
                        <Label htmlFor="role">Role *</Label>
                        <div className="relative">
                            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                            <Select 
                                value={formData.role} 
                                onValueChange={(v) => setFormData(prev => ({ ...prev, role: v }))}
                            >
                                <SelectTrigger className="pl-9">
                                    <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roleOptions.map((role) => (
                                        <SelectItem key={role.value} value={role.value}>
                                            {role.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Dealership - show for super admin or if not selecting super_admin role */}
                    {formData.role !== "super_admin" && (
                        <div className="space-y-2">
                            <Label htmlFor="dealership">Dealership *</Label>
                            {isSuperAdmin ? (
                                <Select 
                                    value={formData.dealership_id} 
                                    onValueChange={(v) => setFormData(prev => ({ ...prev, dealership_id: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select dealership" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {dealerships.map((d) => (
                                            <SelectItem key={d.id} value={d.id}>
                                                {d.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    disabled
                                    value="Current Dealership"
                                    className="bg-muted"
                                />
                            )}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={handleClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Create User
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
