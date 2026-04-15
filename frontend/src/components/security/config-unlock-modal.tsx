"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { verifyAndStoreConfigUnlock } from "@/services/config-access-service"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

interface ConfigUnlockModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onUnlocked: () => void
    /** When user has not set a configuration password yet */
    needsSetup?: boolean
}

export function ConfigUnlockModal({
    open,
    onOpenChange,
    onUnlocked,
    needsSetup = false,
}: ConfigUnlockModalProps) {
    const { toast } = useToast()
    const [password, setPassword] = React.useState("")
    const [loading, setLoading] = React.useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (needsSetup) return
        setLoading(true)
        try {
            await verifyAndStoreConfigUnlock(password)
            setPassword("")
            onUnlocked()
            onOpenChange(false)
            toast({ title: "Unlocked", description: "You can manage integration settings for this session." })
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast({
                title: "Could not verify",
                description: typeof detail === "string" ? detail : "Check your configuration password.",
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }

    if (needsSetup) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Set configuration password</DialogTitle>
                        <DialogDescription>
                            Create a separate password (not your login password) under Security settings to view and edit
                            Twilio and dealership email credentials.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Close
                        </Button>
                        <Button asChild>
                            <Link href="/settings/security">Open Security</Link>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Configuration password</DialogTitle>
                        <DialogDescription>
                            Enter your configuration-access password (not your CRM login password). This unlocks sensitive
                            integration settings for a short time in this browser tab.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-4">
                        <Label htmlFor="config-unlock-pw">Configuration password</Label>
                        <Input
                            id="config-unlock-pw"
                            type="password"
                            autoComplete="off"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading || !password.trim()}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
