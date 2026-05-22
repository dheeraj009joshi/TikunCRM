"use client"

import * as React from "react"
import { Loader2, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { DealershipService } from "@/services/dealership-service"
import { TeamService, UserBrief } from "@/services/team-service"
import { getApiErrorMessage } from "@/lib/api-errors"

interface EditBdcDealershipsModalProps {
    user: UserBrief | null
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
}

export function EditBdcDealershipsModal({
    user,
    isOpen,
    onClose,
    onSuccess,
}: EditBdcDealershipsModalProps) {
    const [dealerships, setDealerships] = React.useState<{ id: string; name: string }[]>([])
    const [selectedIds, setSelectedIds] = React.useState<string[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState("")

    React.useEffect(() => {
        if (!isOpen || !user) return
        const load = async () => {
            setIsLoading(true)
            setError("")
            try {
                const [all, access] = await Promise.all([
                    DealershipService.listDealerships(),
                    TeamService.getUserDealershipAccess(user.id),
                ])
                setDealerships(all)
                setSelectedIds(access.dealerships.map((d) => d.id))
            } catch (err) {
                setError(getApiErrorMessage(err, "Failed to load dealerships"))
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [isOpen, user])

    const toggle = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        )
    }

    const handleSave = async () => {
        if (!user) return
        if (selectedIds.length === 0) {
            setError("Select at least one dealership")
            return
        }
        setIsLoading(true)
        setError("")
        try {
            await TeamService.setUserDealershipAccess(user.id, selectedIds)
            onSuccess?.()
            onClose()
        } catch (err) {
            setError(getApiErrorMessage(err, "Failed to save dealership access"))
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        BDC dealerships — {user?.first_name} {user?.last_name}
                    </DialogTitle>
                </DialogHeader>
                {isLoading && !dealerships.length ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Label>Assigned rooftops</Label>
                        <div className="max-h-48 overflow-y-auto rounded-md border p-3 space-y-2">
                            {dealerships.map((d) => (
                                <label
                                    key={d.id}
                                    className="flex items-center gap-2 text-sm cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(d.id)}
                                        onChange={() => toggle(d.id)}
                                    />
                                    {d.name}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                {error && (
                    <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                        {error}
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
