"use client"

import * as React from "react"
import { Loader2, Building2, Mail, Phone, MapPin, Globe, User, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import { DealershipService } from "@/services/dealership-service"

interface CreateDealershipModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
}

export function CreateDealershipModal({ isOpen, onClose, onSuccess }: CreateDealershipModalProps) {
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    
    const [formData, setFormData] = React.useState({
        name: "",
        email: "",
        phone: "",
        address: "",
        city: "",
        state: "",
        country: "",
        postal_code: "",
        website: "",
    })

    const [ownerData, setOwnerData] = React.useState({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        password: "",
    })

    const resetForm = () => {
        setFormData({
            name: "",
            email: "",
            phone: "",
            address: "",
            city: "",
            state: "",
            country: "",
            postal_code: "",
            website: "",
        })
        setOwnerData({
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            password: "",
        })
        setError("")
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        
        if (!formData.name.trim()) {
            setError("Dealership name is required")
            return
        }

        // Validate owner data
        if (!ownerData.first_name.trim() || !ownerData.last_name.trim()) {
            setError("Owner first name and last name are required")
            return
        }
        if (!ownerData.email.trim()) {
            setError("Owner email is required")
            return
        }
        if (!ownerData.password || ownerData.password.length < 6) {
            setError("Owner password must be at least 6 characters")
            return
        }

        setIsLoading(true)
        setError("")

        try {
            const payload = {
                ...formData,
                owner: ownerData
            }
            await DealershipService.createDealership(payload)
            resetForm()
            onSuccess?.()
            onClose()
        } catch (err: any) {
            console.error("Failed to create dealership:", err)
            setError(err?.response?.data?.detail || "Failed to create dealership. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        Register New Dealership
                    </DialogTitle>
                    <DialogDescription>
                        Create a new dealership and assign an owner who will manage the team.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Owner Section */}
                    <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                        <h3 className="font-semibold flex items-center gap-2">
                            <User className="h-4 w-4" />
                            Dealership Owner *
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            The owner will have full control over the dealership and can add admins and salespersons.
                        </p>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="owner_first_name">First Name *</Label>
                                <Input
                                    id="owner_first_name"
                                    placeholder="John"
                                    value={ownerData.first_name}
                                    onChange={(e) => setOwnerData(prev => ({ ...prev, first_name: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="owner_last_name">Last Name *</Label>
                                <Input
                                    id="owner_last_name"
                                    placeholder="Doe"
                                    value={ownerData.last_name}
                                    onChange={(e) => setOwnerData(prev => ({ ...prev, last_name: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="owner_email">Email *</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="owner_email"
                                        type="email"
                                        placeholder="owner@dealership.com"
                                        className="pl-9"
                                        value={ownerData.email}
                                        onChange={(e) => setOwnerData(prev => ({ ...prev, email: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="owner_phone">Phone</Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="owner_phone"
                                        placeholder="+1 234 567 8900"
                                        className="pl-9"
                                        value={ownerData.phone}
                                        onChange={(e) => setOwnerData(prev => ({ ...prev, phone: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="owner_password">Password *</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="owner_password"
                                    type="password"
                                    placeholder="Minimum 6 characters"
                                    className="pl-9"
                                    value={ownerData.password}
                                    onChange={(e) => setOwnerData(prev => ({ ...prev, password: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Dealership Info Section */}
                    <div className="space-y-4">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            Dealership Information
                        </h3>

                        {/* Name */}
                        <div className="space-y-2">
                            <Label htmlFor="name">Dealership Name *</Label>
                            <Input
                                id="name"
                                placeholder="Premium Auto Sales"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Contact Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="contact@dealership.com"
                                    className="pl-9"
                                    value={formData.email}
                                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                        </div>
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
                    </div>

                    {/* Address */}
                    <div className="space-y-2">
                        <Label htmlFor="address">Street Address</Label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="address"
                                placeholder="123 Main Street"
                                className="pl-9"
                                value={formData.address}
                                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* City, State */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input
                                id="city"
                                placeholder="Los Angeles"
                                value={formData.city}
                                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="state">State/Province</Label>
                            <Input
                                id="state"
                                placeholder="California"
                                value={formData.state}
                                onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Country, Postal */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="country">Country</Label>
                            <Input
                                id="country"
                                placeholder="United States"
                                value={formData.country}
                                onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="postal_code">Postal Code</Label>
                            <Input
                                id="postal_code"
                                placeholder="90001"
                                value={formData.postal_code}
                                onChange={(e) => setFormData(prev => ({ ...prev, postal_code: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Website */}
                    <div className="space-y-2">
                        <Label htmlFor="website">Website</Label>
                        <div className="relative">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="website"
                                placeholder="https://www.dealership.com"
                                className="pl-9"
                                value={formData.website}
                                onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                            />
                        </div>
                    </div>

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
                            Create Dealership
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
