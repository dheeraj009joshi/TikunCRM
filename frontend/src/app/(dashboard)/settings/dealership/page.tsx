"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft,
    Building2,
    Loader2,
    CheckCircle2,
    Globe,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { DealershipService, Dealership } from "@/services/dealership-service"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { COMMON_TIMEZONES } from "@/utils/timezone"

export default function DealershipSettingsPage() {
    const router = useRouter()
    const { user } = useAuthStore()
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)
    const [dealership, setDealership] = React.useState<Dealership | null>(null)
    const [timezone, setTimezone] = React.useState<string>("UTC")
    const [error, setError] = React.useState<string | null>(null)
    const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
    
    // Load dealership settings
    React.useEffect(() => {
        const loadDealership = async () => {
            if (!user?.dealership_id) {
                setIsLoading(false)
                return
            }
            
            setIsLoading(true)
            try {
                const data = await DealershipService.getDealership(user.dealership_id)
                setDealership(data)
                setTimezone(data.timezone || "UTC")
            } catch (err: any) {
                console.error("Failed to load dealership:", err)
                setError(err?.response?.data?.detail || "Failed to load dealership settings")
            } finally {
                setIsLoading(false)
            }
        }
        
        loadDealership()
    }, [user?.dealership_id])
    
    const handleSave = async () => {
        if (!dealership || !user?.dealership_id) return
        
        setIsSaving(true)
        setError(null)
        setSuccessMessage(null)
        
        try {
            const updated = await DealershipService.updateDealership(dealership.id, {
                timezone,
            })
            setDealership(updated)
            setSuccessMessage("Dealership settings saved successfully!")
        } catch (err: any) {
            setError(err?.response?.data?.detail || "Failed to save settings")
        } finally {
            setIsSaving(false)
        }
    }
    
    if (!isDealershipAdmin && !isDealershipOwner && !isSuperAdmin) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <p className="text-muted-foreground">You don't have permission to access this page.</p>
                </div>
            </div>
        )
    }
    
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }
    
    if (!dealership) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <p className="text-muted-foreground">Dealership not found.</p>
                </div>
            </div>
        )
    }
    
    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push("/settings")}
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">Dealership Settings</h1>
                    <p className="text-muted-foreground">
                        Configure timezone and other dealership-wide settings
                    </p>
                </div>
            </div>
            
            {/* Messages */}
            {error && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="py-3 flex items-center gap-2 text-red-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {error}
                    </CardContent>
                </Card>
            )}
            
            {successMessage && (
                <Card className="border-green-200 bg-green-50">
                    <CardContent className="py-3 flex items-center gap-2 text-green-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {successMessage}
                    </CardContent>
                </Card>
            )}
            
            {/* Timezone Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Timezone Configuration
                    </CardTitle>
                    <CardDescription>
                        Set the timezone for your dealership. All timestamps and notifications will be displayed in this timezone for all users in your dealership.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="timezone">Dealership Timezone</Label>
                        <Select value={timezone} onValueChange={setTimezone}>
                            <SelectTrigger id="timezone">
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
                        <p className="text-xs text-muted-foreground">
                            This timezone will be used for all date and time displays across the CRM for users in this dealership.
                        </p>
                    </div>
                    
                    <div className="flex items-center justify-between pt-4 border-t">
                        <div className="text-sm text-muted-foreground">
                            <p className="font-medium">Current Dealership:</p>
                            <p className="mt-1">{dealership.name}</p>
                        </div>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Settings"
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
            
            {/* Info Card */}
            <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="pt-6">
                    <div className="flex gap-3">
                        <Building2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-900">
                            <p className="font-medium mb-2">How timezone affects your CRM:</p>
                            <ul className="list-disc list-inside space-y-1 text-blue-800">
                                <li>All notification timestamps will show in your dealership timezone</li>
                                <li>Lead creation dates and activity logs use this timezone</li>
                                <li>Follow-up reminders and schedules are based on this timezone</li>
                                <li>All salespersons in your dealership will see times in this timezone</li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
