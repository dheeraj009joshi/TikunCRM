"use client"

import * as React from "react"
import { Mail, AlertCircle, X } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

interface EmailConfigReminderModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function EmailConfigReminderModal({
    open,
    onOpenChange
}: EmailConfigReminderModalProps) {
    const router = useRouter()
    
    const handleGoToSettings = () => {
        onOpenChange(false)
        router.push("/settings/email-config")
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                        </div>
                        <DialogTitle className="text-xl">Email Configuration Required</DialogTitle>
                    </div>
                    <DialogDescription className="text-base pt-2">
                        To send and receive emails in the CRM, you need to configure your email settings.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                    <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <Mail className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-blue-900 dark:text-blue-100">
                            <p className="font-medium mb-1">What you need to do:</p>
                            <ol className="list-decimal list-inside space-y-1 text-blue-800 dark:text-blue-200">
                                <li>Go to Email Settings</li>
                                <li>Enter your Hostinger email and password</li>
                                <li>Test your configuration</li>
                            </ol>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="flex-1"
                    >
                        Remind Me Later
                    </Button>
                    <Button
                        onClick={handleGoToSettings}
                        className="flex-1"
                    >
                        Configure Email
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
