"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft,
    User,
    Mail,
    Phone,
    Building2,
    Loader2,
    CheckCircle2,
    XCircle,
    Bell,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PushNotificationToggle } from "@/components/pwa/push-notification-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

import { useAuthStore } from "@/stores/auth-store"
import apiClient from "@/lib/api-client"

interface UserProfile {
    id: string
    email: string
    first_name: string
    last_name: string
    phone: string | null
    dealership_email: string | null
    role: string
    dealership_id: string | null
    is_active: boolean
}

export default function ProfileSettingsPage() {
    const router = useRouter()
    const { user, updateUser } = useAuthStore()
    
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [success, setSuccess] = React.useState<string | null>(null)
    
    const [formData, setFormData] = React.useState({
        first_name: "",
        last_name: "",
        phone: "",
        dealership_email: "",
    })
    
    // Load current user data
    React.useEffect(() => {
        const loadProfile = async () => {
            setIsLoading(true)
            try {
                const response = await apiClient.get<UserProfile>("/auth/me")
                const profile = response.data
                setFormData({
                    first_name: profile.first_name || "",
                    last_name: profile.last_name || "",
                    phone: profile.phone || "",
                    dealership_email: profile.dealership_email || "",
                })
            } catch (err) {
                console.error("Failed to load profile:", err)
            } finally {
                setIsLoading(false)
            }
        }
        
        loadProfile()
    }, [])
    
    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        setError(null)
        setSuccess(null)
    }
    
    const handleSave = async () => {
        setError(null)
        setSuccess(null)
        
        if (!formData.first_name || !formData.last_name) {
            setError("First name and last name are required")
            return
        }
        
        setIsSaving(true)
        try {
            const response = await apiClient.patch<UserProfile>("/users/me", {
                first_name: formData.first_name,
                last_name: formData.last_name,
                phone: formData.phone || null,
                dealership_email: formData.dealership_email || null,
            })
            
            // Update the auth store with new user data
            if (user) {
                updateUser({
                    first_name: response.data.first_name,
                    last_name: response.data.last_name,
                })
            }
            
            setSuccess("Profile updated successfully!")
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to update profile")
        } finally {
            setIsSaving(false)
        }
    }
    
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }
    
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push("/settings")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Profile Settings</h1>
                    <p className="text-muted-foreground">
                        Manage your personal information and email settings
                    </p>
                </div>
            </div>
            
            {/* Status messages */}
            {error && (
                <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-4 flex items-center gap-2">
                    <XCircle className="h-5 w-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            
            {success && (
                <div className="bg-green-500/10 text-green-600 border border-green-500/20 rounded-lg p-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                    <span>{success}</span>
                </div>
            )}
            
            {/* Personal Information */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        Personal Information
                    </CardTitle>
                    <CardDescription>
                        Update your name and contact details
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="first_name">First Name *</Label>
                            <Input
                                id="first_name"
                                value={formData.first_name}
                                onChange={(e) => handleInputChange("first_name", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="last_name">Last Name *</Label>
                            <Input
                                id="last_name"
                                value={formData.last_name}
                                onChange={(e) => handleInputChange("last_name", e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label htmlFor="phone">Phone Number</Label>
                        <Input
                            id="phone"
                            type="tel"
                            placeholder="+1 (555) 123-4567"
                            value={formData.phone}
                            onChange={(e) => handleInputChange("phone", e.target.value)}
                        />
                    </div>
                    
                    <div className="space-y-2">
                        <Label className="text-muted-foreground">Login Email</Label>
                        <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{user?.email}</span>
                            <Badge variant="secondary" className="text-xs">Cannot be changed</Badge>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Dealership Email */}
            {user?.dealership_id && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5" />
                            Dealership Email
                        </CardTitle>
                        <CardDescription>
                            Set your dealership email address for sending emails to leads
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="bg-blue-50 text-blue-700 rounded-lg p-4 text-sm">
                            <p className="font-medium mb-1">How it works:</p>
                            <ul className="list-disc list-inside space-y-1 text-blue-600">
                                <li>This email will be used when you send emails to leads</li>
                                <li>Replies from leads will come to this address</li>
                                <li>Must be on your dealership&apos;s email domain</li>
                            </ul>
                        </div>
                        
                        <div className="space-y-2">
                            <Label htmlFor="dealership_email">Your Dealership Email</Label>
                            <Input
                                id="dealership_email"
                                type="email"
                                placeholder="yourname@dealership.com"
                                value={formData.dealership_email}
                                onChange={(e) => handleInputChange("dealership_email", e.target.value)}
                            />
                            <p className="text-sm text-muted-foreground">
                                Example: john@premiumcars.com
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}
            
            {/* Notification Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell className="h-5 w-5" />
                        Notification Settings
                    </CardTitle>
                    <CardDescription>
                        Configure how you want to receive notifications
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-blue-50 text-blue-700 rounded-lg p-4 text-sm">
                        <p className="font-medium mb-1">Push Notifications</p>
                        <p className="text-blue-600">
                            Enable push notifications to receive instant alerts about new leads, 
                            appointments, and follow-ups even when the browser is closed.
                        </p>
                    </div>
                    
                    <PushNotificationToggle />
                </CardContent>
            </Card>
            
            {/* Save Button */}
            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>
        </div>
    )
}
