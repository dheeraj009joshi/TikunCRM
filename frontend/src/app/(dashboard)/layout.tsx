"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { BottomNav } from "@/components/layout/bottom-nav"
import { ErrorBoundary } from "@/components/ui/error-state"
import { EmailConfigReminderModal } from "@/components/email-config-reminder-modal"
import { SkateAlertDialog } from "@/components/skate-alert-dialog"
import { SkateConfirmDialog } from "@/components/skate-confirm-dialog"
import { WebSocketProvider } from "@/components/providers/websocket-provider"
import { SidebarProvider, useSidebarOptional } from "@/contexts/sidebar-context"
import { BdcDealershipProvider } from "@/contexts/bdc-dealership-context"
import { CallLeadProvider, useCallLeadOptional } from "@/contexts/call-lead-context"
import { Softphone } from "@/components/softphone"
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
        // Email config reminder disabled - uncomment to re-enable
        // if (user && !user.email_config_verified) {
        //     const reminderDismissed = sessionStorage.getItem('email_config_reminder_dismissed')
        //     if (!reminderDismissed && !hasShownReminder) {
        //         const timer = setTimeout(() => {
        //             setShowReminder(true)
        //             setHasShownReminder(true)
        //         }, 1000)
        //         return () => clearTimeout(timer)
        //     }
        // }
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
        <WebSocketProvider>
            <CallLeadProvider>
                <SidebarProvider>
                    <BdcDealershipProvider>
                        <DashboardContent
                            showReminder={showReminder}
                            onReminderClose={handleReminderClose}
                        >
                            {children}
                        </DashboardContent>
                    </BdcDealershipProvider>
                </SidebarProvider>
            </CallLeadProvider>
        </WebSocketProvider>
    )
}

function DashboardContent({
    children,
    showReminder,
    onReminderClose,
}: {
    children: React.ReactNode
    showReminder: boolean
    onReminderClose: (open: boolean) => void
}) {
    const sidebar = useSidebarOptional()
    const collapsed = sidebar?.collapsed ?? false
    const callLead = useCallLeadOptional()?.callLead ?? null

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            <Sidebar />
            <div className={collapsed ? "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 md:pl-16" : "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 md:pl-64"}>
                <Header />
                <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 pb-20 sm:p-6 md:pb-6">
                    <ErrorBoundary>{children}</ErrorBoundary>
                </main>
            </div>
            <BottomNav />
            <EmailConfigReminderModal open={showReminder} onOpenChange={onReminderClose} />
            <SkateAlertDialog />
            <SkateConfirmDialog />
            <Softphone
                leadPhone={callLead?.phone}
                leadId={callLead?.leadId}
                leadName={callLead?.leadName}
            />
        </div>
    )
}
