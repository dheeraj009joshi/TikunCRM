"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { EmailConfigReminderModal } from "@/components/email-config-reminder-modal"
import { useAuthStore } from "@/stores/auth-store"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user } = useAuthStore()
    const [showReminder, setShowReminder] = React.useState(false)
    const [hasShownReminder, setHasShownReminder] = React.useState(false)

    React.useEffect(() => {
        // Check if user is logged in and email is not verified
        if (user && !user.email_config_verified) {
            // Check if we've already shown the reminder in this session
            const reminderDismissed = sessionStorage.getItem('email_config_reminder_dismissed')
            
            if (!reminderDismissed && !hasShownReminder) {
                // Show reminder after a short delay to let the page load
                const timer = setTimeout(() => {
                    setShowReminder(true)
                    setHasShownReminder(true)
                }, 1000)
                return () => clearTimeout(timer)
            }
        }
    }, [user, hasShownReminder])

    // Reset reminder flag when user logs out or email gets verified
    React.useEffect(() => {
        if (!user) {
            setHasShownReminder(false)
            sessionStorage.removeItem('email_config_reminder_dismissed')
        } else if (user.email_config_verified) {
            setHasShownReminder(false)
            setShowReminder(false)
            sessionStorage.removeItem('email_config_reminder_dismissed')
        }
    }, [user])

    const handleReminderClose = (open: boolean) => {
        setShowReminder(open)
        if (!open) {
            // Mark as dismissed for this session
            sessionStorage.setItem('email_config_reminder_dismissed', 'true')
        }
    }

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            <Sidebar />
            <div className="flex flex-1 flex-col pl-64">
                <Header />
                <main className="flex-1 p-6 overflow-y-auto">
                    {children}
                </main>
            </div>
            <EmailConfigReminderModal 
                open={showReminder} 
                onOpenChange={handleReminderClose}
            />
        </div>
    )
}
