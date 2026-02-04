"use client"

import * as React from "react"
import { Bell, Loader2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ReportsService } from "@/services/reports-service"
import { useToast } from "@/hooks/use-toast"

interface NotifySalespersonDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    userId: string
    userName: string
}

export function NotifySalespersonDialog({
    open,
    onOpenChange,
    userId,
    userName
}: NotifySalespersonDialogProps) {
    const [customMessage, setCustomMessage] = React.useState("")
    const [includePendingTasks, setIncludePendingTasks] = React.useState(true)
    const [isSending, setIsSending] = React.useState(false)
    const { toast } = useToast()

    const handleSend = async () => {
        setIsSending(true)
        try {
            const response = await ReportsService.notifySalesperson(userId, {
                custom_message: customMessage || undefined,
                include_pending_tasks: includePendingTasks
            })

            toast({
                title: "Notification Sent",
                description: response.message,
            })

            // Reset and close
            setCustomMessage("")
            setIncludePendingTasks(true)
            onOpenChange(false)
        } catch (error: any) {
            console.error("Failed to send notification:", error)
            toast({
                title: "Failed to Send",
                description: error.response?.data?.detail || "Failed to send notification",
                variant: "destructive",
            })
        } finally {
            setIsSending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Send Notification to {userName}</DialogTitle>
                    <DialogDescription>
                        Send a multi-channel notification (push, email, SMS) with optional custom message
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Include pending tasks checkbox */}
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="include-tasks"
                            checked={includePendingTasks}
                            onCheckedChange={(checked) => setIncludePendingTasks(checked as boolean)}
                        />
                        <Label
                            htmlFor="include-tasks"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                            Include pending task list in notification
                        </Label>
                    </div>

                    {/* Custom message */}
                    <div className="space-y-2">
                        <Label htmlFor="message">Custom Message (optional)</Label>
                        <Textarea
                            id="message"
                            placeholder="Add a custom message to the notification..."
                            value={customMessage}
                            onChange={(e) => setCustomMessage(e.target.value)}
                            rows={4}
                        />
                    </div>

                    {/* Notification channels info */}
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <div className="text-sm font-medium mb-2">Notification Channels</div>
                        <div className="text-xs text-muted-foreground space-y-1">
                            <div>✓ Push notification (in-app)</div>
                            <div>✓ Email notification</div>
                            <div>✓ SMS notification</div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSending}
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleSend} disabled={isSending}>
                        {isSending ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Bell className="mr-2 h-4 w-4" />
                                Send Notification
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
