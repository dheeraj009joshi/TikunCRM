"use client"

import * as React from "react"
import Link from "next/link"
import {
    Pencil,
    Loader2,
    AlertCircle,
    Save,
    Tag,
    Building2,
    MessageSquare,
    Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useRole } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import {
    DealershipCampaignMappingResponse,
    getDealershipCampaignMappings,
    updateCampaignMappingDisplayName,
    updateCampaignWhatsAppTemplate,
} from "@/services/sync-source-service"
import { whatsappService, WhatsAppTemplateItem } from "@/services/whatsapp-service"

/** Radix Select rejects empty string as SelectItem value — use this sentinel for "no template". */
const NO_WHATSAPP_TEMPLATE = "__none__"

export default function CampaignMappingsPage() {
    const [mappings, setMappings] = React.useState<DealershipCampaignMappingResponse[]>([])
    const [templates, setTemplates] = React.useState<WhatsAppTemplateItem[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)

    // Edit display + targeting dialog
    const [editDialogOpen, setEditDialogOpen] = React.useState(false)
    const [editingMapping, setEditingMapping] = React.useState<DealershipCampaignMappingResponse | null>(null)
    const [editDisplayName, setEditDisplayName] = React.useState("")
    const [editTargetingMessage, setEditTargetingMessage] = React.useState("")

    // WhatsApp template dialog state
    const [whatsappDialogOpen, setWhatsappDialogOpen] = React.useState(false)
    const [selectedMapping, setSelectedMapping] = React.useState<DealershipCampaignMappingResponse | null>(null)
    const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("")
    const [autoSendEnabled, setAutoSendEnabled] = React.useState(false)
    const [isSavingWhatsApp, setIsSavingWhatsApp] = React.useState(false)
    const [templatesLoadError, setTemplatesLoadError] = React.useState<string | null>(null)

    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner, isBdc } = useRole()
    const canEdit = isSuperAdmin || isDealershipAdmin || isDealershipOwner || isBdc
    const { toast } = useToast()

    const loadMappings = React.useCallback(async () => {
        try {
            const data = await getDealershipCampaignMappings()
            setMappings(data)
        } catch (error) {
            console.error("Failed to load campaign mappings:", error)
            toast({
                title: "Error",
                description: "Failed to load campaign mappings",
                variant: "destructive",
            })
        } finally {
            setIsLoading(false)
        }
    }, [toast])

    const loadTemplates = React.useCallback(async () => {
        setTemplatesLoadError(null)
        try {
            const data = await whatsappService.listTemplates()
            setTemplates(data)
        } catch (error: unknown) {
            console.error("Failed to load WhatsApp templates:", error)
            const msg =
                error && typeof error === "object" && "response" in error
                    ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail)
                    : ""
            setTemplatesLoadError(msg || "Could not load templates from the server.")
            setTemplates([])
        }
    }, [])

    React.useEffect(() => {
        if (canEdit) {
            loadMappings()
            loadTemplates()
        } else {
            setIsLoading(false)
        }
    }, [loadMappings, loadTemplates, canEdit])

    const openEditDialog = (mapping: DealershipCampaignMappingResponse) => {
        setEditingMapping(mapping)
        setEditDisplayName(mapping.display_name)
        setEditTargetingMessage(mapping.targeting_message ?? "")
        setEditDialogOpen(true)
    }

    const closeEditDialog = () => {
        setEditDialogOpen(false)
        setEditingMapping(null)
        setEditDisplayName("")
        setEditTargetingMessage("")
    }

    const saveEdit = async () => {
        if (!editingMapping || !editDisplayName.trim()) return

        setIsSaving(true)
        try {
            await updateCampaignMappingDisplayName(
                editingMapping.id,
                editDisplayName.trim(),
                editTargetingMessage.trim() || null
            )
            toast({
                title: "Success",
                description: "Display name and targeting message updated",
            })
            closeEditDialog()
            await loadMappings()
        } catch (error: any) {
            console.error("Failed to update campaign mapping:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to update campaign mapping",
                variant: "destructive",
            })
        } finally {
            setIsSaving(false)
        }
    }

    const openWhatsAppDialog = (mapping: DealershipCampaignMappingResponse) => {
        setSelectedMapping(mapping)
        setSelectedTemplateId(mapping.whatsapp_template_id ?? "")
        setAutoSendEnabled(Boolean(mapping.whatsapp_auto_send))
        setWhatsappDialogOpen(true)
    }

    const closeWhatsAppDialog = () => {
        setWhatsappDialogOpen(false)
        setSelectedMapping(null)
        setSelectedTemplateId("")
        setAutoSendEnabled(false)
    }

    const saveWhatsAppSettings = async () => {
        if (!selectedMapping) return

        setIsSavingWhatsApp(true)
        try {
            const templateId =
                selectedTemplateId && selectedTemplateId !== NO_WHATSAPP_TEMPLATE
                    ? selectedTemplateId
                    : null
            await updateCampaignWhatsAppTemplate(selectedMapping.id, {
                whatsapp_template_id: templateId,
                whatsapp_auto_send: autoSendEnabled,
            })
            toast({
                title: "Success",
                description: "WhatsApp settings updated successfully",
            })
            closeWhatsAppDialog()
            await loadMappings()
        } catch (error: any) {
            console.error("Failed to update WhatsApp settings:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to update WhatsApp settings",
                variant: "destructive",
            })
        } finally {
            setIsSavingWhatsApp(false)
        }
    }

    if (!canEdit) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-lg font-semibold">Access Denied</h2>
                    <p className="text-muted-foreground">
                        Only Managers, BDC agents, or Super Admins can edit campaign mappings.
                    </p>
                </div>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Group mappings by sync source
    const groupedMappings = mappings.reduce((acc, mapping) => {
        const sourceId = mapping.sync_source_id
        const sourceName = mapping.sync_source_name || "Unknown Source"

        if (!acc[sourceId]) {
            acc[sourceId] = {
                name: sourceName,
                mappings: [],
            }
        }
        acc[sourceId].mappings.push(mapping)
        return acc
    }, {} as Record<string, { name: string; mappings: DealershipCampaignMappingResponse[] }>)

    return (
        <div className="space-y-6 max-w-3xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Campaign mappings</h1>
                <p className="text-muted-foreground">
                    Edit the display name and targeting message for each sheet campaign.
                    Both appear on lead detail. Assign WhatsApp templates with the green icon.
                </p>
            </div>

            {mappings.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold">No Campaign Mappings</h3>
                            <p className="text-muted-foreground">
                                There are no campaign mappings configured for your dealership yet.
                            </p>
                            {isSuperAdmin && (
                                <p className="text-sm text-muted-foreground mt-2">
                                    Go to Settings → Sync Sources to create campaign mappings.
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedMappings).map(([sourceId, group]) => (
                        <Card key={sourceId}>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                    {group.name}
                                </CardTitle>
                                <CardDescription>
                                    {group.mappings.length} campaign{group.mappings.length !== 1 ? "s" : ""}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <div className="space-y-3">
                                    {group.mappings.map((mapping) => (
                                        <div
                                            key={mapping.id}
                                            className="flex items-start justify-between gap-3 p-3 bg-muted/30 rounded-lg"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span className="text-xs text-muted-foreground">
                                                        Pattern:
                                                    </span>
                                                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                                        {mapping.match_pattern}
                                                    </code>
                                                    <Badge variant="secondary" className="text-[10px]">
                                                        {mapping.match_type}
                                                    </Badge>
                                                </div>

                                                <div className="mt-1">
                                                    <span className="text-xs text-muted-foreground">Display: </span>
                                                    <span className="text-sm font-medium">{mapping.display_name}</span>
                                                </div>

                                                <div className="mt-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
                                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                                                        Targeting message
                                                    </p>
                                                    {mapping.targeting_message?.trim() ? (
                                                        <p className="text-sm whitespace-pre-wrap">
                                                            {mapping.targeting_message.trim()}
                                                        </p>
                                                    ) : (
                                                        <p className="text-sm text-muted-foreground italic">
                                                            No targeting message set — click edit to add one
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                                    <span>
                                                        {mapping.leads_matched} leads matched
                                                    </span>
                                                    {!mapping.is_active && (
                                                        <Badge variant="secondary" className="text-[10px]">
                                                            Inactive
                                                        </Badge>
                                                    )}
                                                </div>

                                                {/* WhatsApp Template Info */}
                                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                                                    <MessageSquare className="h-3.5 w-3.5 text-green-600" />
                                                    {mapping.whatsapp_template ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs">
                                                                Template: <span className="font-medium">{mapping.whatsapp_template.name}</span>
                                                            </span>
                                                            {Boolean(mapping.whatsapp_auto_send) && (
                                                                <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                                                                    <Zap className="h-2.5 w-2.5 mr-0.5" />
                                                                    Auto-send
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">
                                                            No WhatsApp template assigned
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-1 shrink-0">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => openEditDialog(mapping)}
                                                    title="Edit display name & targeting message"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => openWhatsAppDialog(mapping)}
                                                    title="Configure WhatsApp"
                                                >
                                                    <MessageSquare className="h-3.5 w-3.5 text-green-600" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Card className="bg-muted/30">
                <CardContent className="py-4">
                    <p className="text-sm text-muted-foreground">
                        <strong>Note:</strong> The display name is the green source tag on leads.
                        The targeting message appears next to it so agents know the campaign audience / pitch.
                        WhatsApp templates can auto-send when new leads match the campaign.
                        {isSuperAdmin && (
                            <span className="block mt-1">
                                As a Super Admin, you can also manage mappings in{" "}
                                <a href="/settings/sync-sources" className="text-primary underline">
                                    Sync Sources
                                </a>.
                            </span>
                        )}
                    </p>
                </CardContent>
            </Card>

            {/* Edit display name + targeting message */}
            <Dialog open={editDialogOpen} onOpenChange={(open) => !open && closeEditDialog()}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit campaign mapping</DialogTitle>
                        <DialogDescription>
                            Pattern: <code className="text-xs">{editingMapping?.match_pattern}</code>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="display-name">Display name</Label>
                            <Input
                                id="display-name"
                                value={editDisplayName}
                                onChange={(e) => setEditDisplayName(e.target.value)}
                                placeholder="e.g. Spanish Broad Targeting"
                            />
                            <p className="text-xs text-muted-foreground">
                                Shown as the source badge on lead detail.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="targeting-message">Targeting message</Label>
                            <Textarea
                                id="targeting-message"
                                value={editTargetingMessage}
                                onChange={(e) => setEditTargetingMessage(e.target.value)}
                                placeholder="Audience notes, offer, language, vehicle focus…"
                                rows={4}
                                className="resize-y"
                            />
                            <p className="text-xs text-muted-foreground">
                                Visible under the source badge on every matching lead.
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeEditDialog}>
                            Cancel
                        </Button>
                        <Button
                            onClick={saveEdit}
                            disabled={isSaving || !editDisplayName.trim()}
                        >
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* WhatsApp Template Dialog */}
            <Dialog open={whatsappDialogOpen} onOpenChange={setWhatsappDialogOpen}>
                <DialogContent className="sm:max-w-md w-[min(100%,calc(100vw-2rem))] max-h-[min(90vh,840px)] overflow-y-auto overflow-x-hidden gap-4 p-6 pr-12 sm:pr-14">
                    <DialogHeader className="pr-2 shrink-0">
                        <DialogTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-green-600" />
                            WhatsApp Template Settings
                        </DialogTitle>
                        <DialogDescription>
                            Configure WhatsApp template for campaign: <strong>{selectedMapping?.display_name}</strong>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2 min-w-0">
                        <div className="space-y-2 min-w-0">
                            <Label htmlFor="template">WhatsApp Template</Label>
                            <Select
                                value={selectedTemplateId ? selectedTemplateId : NO_WHATSAPP_TEMPLATE}
                                onValueChange={(v) =>
                                    setSelectedTemplateId(v === NO_WHATSAPP_TEMPLATE ? "" : v)
                                }
                            >
                                <SelectTrigger id="template" className="w-full max-w-full min-w-0">
                                    <SelectValue placeholder="Select a template..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_WHATSAPP_TEMPLATE}>No template</SelectItem>
                                    {templates.map((template) => (
                                        <SelectItem key={template.id} value={template.id}>
                                            {template.name}
                                            <span className="text-muted-foreground ml-2 text-xs">
                                                ({template.content_sid})
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Select a pre-approved WhatsApp template to use for this campaign.
                            </p>
                            {templatesLoadError && (
                                <p className="text-xs text-destructive flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3 shrink-0" />
                                    {templatesLoadError}
                                </p>
                            )}
                            {!templatesLoadError && templates.length === 0 && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                                    <p className="font-medium">No templates in the database yet</p>
                                    <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                                        Templates must be created in the CRM (they mirror your Twilio Content
                                        SIDs). Add one under{" "}
                                        <Link
                                            href="/settings/whatsapp-templates"
                                            className="underline font-medium text-amber-950 dark:text-amber-50"
                                            onClick={() => setWhatsappDialogOpen(false)}
                                        >
                                            Settings → WhatsApp Templates
                                        </Link>
                                        , or ask a Super Admin to add a global template.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-border bg-muted/20 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                <div className="space-y-0.5 min-w-0 flex-1">
                                    <Label htmlFor="auto-send" className="flex items-center gap-2">
                                        <Zap className="h-4 w-4 shrink-0 text-yellow-500" />
                                        Auto-send on new leads
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Automatically send the template when a new lead matches this campaign.
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center sm:pl-2">
                                    <Switch
                                        id="auto-send"
                                        checked={autoSendEnabled}
                                        onCheckedChange={setAutoSendEnabled}
                                        disabled={
                                            !selectedTemplateId ||
                                            selectedTemplateId === NO_WHATSAPP_TEMPLATE
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        {autoSendEnabled &&
                            (!selectedTemplateId || selectedTemplateId === NO_WHATSAPP_TEMPLATE) && (
                            <p className="text-xs text-orange-600 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                Select a template to enable auto-send.
                            </p>
                        )}
                    </div>

                    <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2 shrink-0 sm:space-x-0">
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto shrink-0"
                            onClick={closeWhatsAppDialog}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={saveWhatsAppSettings}
                            disabled={isSavingWhatsApp}
                            className="w-full sm:w-auto shrink-0 bg-green-600 hover:bg-green-700"
                        >
                            {isSavingWhatsApp ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
