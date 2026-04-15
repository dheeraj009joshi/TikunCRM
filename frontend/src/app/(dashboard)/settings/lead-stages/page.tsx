"use client"

import * as React from "react"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
    GripVertical,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    CheckCircle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { LeadStageService, LeadStage } from "@/services/lead-stage-service"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import { Alert, AlertDescription } from "@/components/ui/alert"

function LeadStagesSettingsInner() {
    const searchParams = useSearchParams()
    const { user } = useAuthStore()
    const [stages, setStages] = React.useState<LeadStage[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [editStage, setEditStage] = React.useState<LeadStage | null>(null)
    const [showCreate, setShowCreate] = React.useState(false)
    const [formName, setFormName] = React.useState("")
    const [formDisplayName, setFormDisplayName] = React.useState("")
    const [formColor, setFormColor] = React.useState("#3B82F6")
    const [formIsTerminal, setFormIsTerminal] = React.useState(false)
    const [isSaving, setIsSaving] = React.useState(false)
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canManage = isSuperAdmin || isDealershipAdmin || isDealershipOwner

    const dealershipIdFromQuery = searchParams.get("dealership_id")

    /** Super Admin + ?dealership_id=… → that dealership; otherwise logged-in user’s dealership; Super Admin without query → global default stages */
    const contextDealershipId = React.useMemo(() => {
        if (isSuperAdmin && dealershipIdFromQuery) return dealershipIdFromQuery
        if (user?.dealership_id) return user.dealership_id
        return undefined
    }, [isSuperAdmin, dealershipIdFromQuery, user?.dealership_id])

    const loadStages = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const data = await LeadStageService.list(contextDealershipId)
            setStages(data)
        } catch (error) {
            console.error("Failed to load stages:", error)
        } finally {
            setIsLoading(false)
        }
    }, [contextDealershipId])

    React.useEffect(() => {
        void loadStages()
    }, [loadStages])

    const handleSave = async () => {
        if (!formName || !formDisplayName) return
        setIsSaving(true)
        try {
            if (editStage) {
                await LeadStageService.update(editStage.id, {
                    display_name: formDisplayName,
                    color: formColor,
                    is_terminal: formIsTerminal,
                })
            } else {
                await LeadStageService.create({
                    name: formName.toLowerCase().replace(/\s+/g, "_"),
                    display_name: formDisplayName,
                    color: formColor,
                    is_terminal: formIsTerminal,
                    order: stages.length + 1,
                    dealership_id: contextDealershipId,
                })
            }
            setEditStage(null)
            setShowCreate(false)
            resetForm()
            await loadStages()
        } catch (error) {
            console.error("Failed to save stage:", error)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (stage: LeadStage) => {
        if (!confirm(`Deactivate "${stage.display_name}"? Existing leads in this stage will remain.`)) return
        try {
            await LeadStageService.delete(stage.id)
            await loadStages()
        } catch (error) {
            console.error("Failed to delete stage:", error)
        }
    }

    const openEdit = (stage: LeadStage) => {
        setEditStage(stage)
        setFormName(stage.name)
        setFormDisplayName(stage.display_name)
        setFormColor(stage.color || "#3B82F6")
        setFormIsTerminal(stage.is_terminal)
        setShowCreate(true)
    }

    const openCreate = () => {
        resetForm()
        setEditStage(null)
        setShowCreate(true)
    }

    const resetForm = () => {
        setFormName("")
        setFormDisplayName("")
        setFormColor("#3B82F6")
        setFormIsTerminal(false)
    }

    if (isLoading) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            {isSuperAdmin && dealershipIdFromQuery && (
                <Alert>
                    <AlertDescription>
                        Editing pipeline stages for dealership ID{" "}
                        <span className="font-mono text-xs">{dealershipIdFromQuery}</span>. Open this page from a
                        dealership&apos;s Settings tab to jump here with the correct scope.
                    </AlertDescription>
                </Alert>
            )}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Pipeline Stages</h1>
                    <p className="text-muted-foreground">Configure the stages leads move through in your pipeline.</p>
                    {!isSuperAdmin && contextDealershipId && (
                        <p className="text-xs text-muted-foreground mt-1">Scoped to your dealership.</p>
                    )}
                    {isSuperAdmin && !dealershipIdFromQuery && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                            No dealership selected — showing global default stages. Add{" "}
                            <code className="text-[10px] bg-muted px-1 rounded">?dealership_id=…</code> to edit a specific
                            dealership.
                        </p>
                    )}
                </div>
                {canManage && (
                    <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        Add Stage
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {stages.map((stage) => (
                            <div
                                key={stage.id}
                                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30"
                            >
                                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div
                                    className="h-4 w-4 rounded-full shrink-0"
                                    style={{ backgroundColor: stage.color || "#6B7280" }}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm">{stage.display_name}</p>
                                    <p className="text-xs text-muted-foreground">{stage.name}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {stage.is_terminal && (
                                        <Badge variant="secondary" className="text-[10px]">
                                            <CheckCircle className="h-3 w-3 mr-1" />
                                            Terminal
                                        </Badge>
                                    )}
                                    <span className="text-xs text-muted-foreground">#{stage.order}</span>
                                    {canManage && (
                                        <>
                                            <Button variant="ghost" size="icon" onClick={() => openEdit(stage)}>
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleDelete(stage)}>
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Create / Edit Modal */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editStage ? "Edit Stage" : "New Stage"}</DialogTitle>
                        <DialogDescription>
                            {editStage ? "Update this pipeline stage." : "Add a new stage to your pipeline."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {!editStage && (
                            <div className="space-y-2">
                                <Label>Internal Name</Label>
                                <Input
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="e.g. negotiation"
                                />
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>Display Name</Label>
                            <Input
                                value={formDisplayName}
                                onChange={(e) => setFormDisplayName(e.target.value)}
                                placeholder="e.g. Negotiation"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Color</Label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={formColor}
                                    onChange={(e) => setFormColor(e.target.value)}
                                    className="h-9 w-14 rounded border cursor-pointer"
                                />
                                <Input value={formColor} onChange={(e) => setFormColor(e.target.value)} className="flex-1" />
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label>Terminal stage (closes the lead)</Label>
                            <Switch checked={formIsTerminal} onCheckedChange={setFormIsTerminal} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || !formDisplayName}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {editStage ? "Save Changes" : "Create Stage"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function LeadStagesSettingsPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-[40vh] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            }
        >
            <LeadStagesSettingsInner />
        </Suspense>
    )
}
