"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Bell, Smartphone, Mail, MessageSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { PushNotificationToggle } from "@/components/pwa/push-notification-toggle"

export default function NotificationSettingsPage() {
    const router = useRouter()
    
    const [emailNotifications, setEmailNotifications] = React.useState(true)
    const [leadAssigned, setLeadAssigned] = React.useState(true)
    const [newEmail, setNewEmail] = React.useState(true)
    const [followUpReminder, setFollowUpReminder] = React.useState(true)
    const [appointmentReminder, setAppointmentReminder] = React.useState(true)

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
                <div>
                    <h1 className="text-2xl font-bold">Notification Settings</h1>
                    <p className="text-muted-foreground">
                        Configure how you receive notifications
                    </p>
                </div>
            </div>
            
            {/* Push Notifications */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Smartphone className="h-5 w-5" />
                        Push Notifications
                    </CardTitle>
                    <CardDescription>
                        Receive instant notifications on your device even when the browser is closed
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded-lg p-4 text-sm">
                        <p className="font-medium mb-1">How it works</p>
                        <ul className="list-disc list-inside space-y-1 text-blue-600 dark:text-blue-400">
                            <li>Enable push notifications to get instant alerts</li>
                            <li>Works even when the browser tab is closed</li>
                            <li>Click notifications to open the relevant page</li>
                            <li>You can disable anytime from here or browser settings</li>
                        </ul>
                    </div>
                    
                    <PushNotificationToggle />
                </CardContent>
            </Card>
            
            {/* Notification Types */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell className="h-5 w-5" />
                        Notification Types
                    </CardTitle>
                    <CardDescription>
                        Choose which notifications you want to receive
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="lead-assigned">Lead Assigned</Label>
                            <p className="text-sm text-muted-foreground">
                                When a new lead is assigned to you
                            </p>
                        </div>
                        <Switch 
                            id="lead-assigned"
                            checked={leadAssigned}
                            onCheckedChange={setLeadAssigned}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="new-email">New Email Reply</Label>
                            <p className="text-sm text-muted-foreground">
                                When a lead replies to your email
                            </p>
                        </div>
                        <Switch 
                            id="new-email"
                            checked={newEmail}
                            onCheckedChange={setNewEmail}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="follow-up">Follow-up Reminders</Label>
                            <p className="text-sm text-muted-foreground">
                                When a follow-up is due or overdue
                            </p>
                        </div>
                        <Switch 
                            id="follow-up"
                            checked={followUpReminder}
                            onCheckedChange={setFollowUpReminder}
                        />
                    </div>
                    
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="appointment">Appointment Reminders</Label>
                            <p className="text-sm text-muted-foreground">
                                Reminders before scheduled appointments
                            </p>
                        </div>
                        <Switch 
                            id="appointment"
                            checked={appointmentReminder}
                            onCheckedChange={setAppointmentReminder}
                        />
                    </div>
                </CardContent>
            </Card>
            
            {/* Email Notifications */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5" />
                        Email Notifications
                    </CardTitle>
                    <CardDescription>
                        Receive notifications via email
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="email-notifications">Enable Email Notifications</Label>
                            <p className="text-sm text-muted-foreground">
                                Get important updates via email
                            </p>
                        </div>
                        <Switch 
                            id="email-notifications"
                            checked={emailNotifications}
                            onCheckedChange={setEmailNotifications}
                        />
                    </div>
                    
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                        Email notifications are sent to your login email address. 
                        Daily digest emails will be sent for any notifications you missed.
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
