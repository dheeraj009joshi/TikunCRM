"use client"

import * as React from "react"
import {
    Pencil,
    Loader2,
    AlertCircle,
    Save,
    X,
    Tag,
    Building2,
    MessageSquare,
    Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export default function CampaignMappingsPage() {
    const [mappings, setMappings] = React.useState<DealershipCampaignMappingResponse[]>([])
    const [templates, setTemplates] = React.useState<WhatsAppTemplateItem[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [editValue, setEditValue] = React.useState("")
    const [isSaving, setIsSaving] = React.useState(false)
    
    // WhatsApp template dialog state
    const [whatsappDialogOpen, setWhatsappDialogOpen] = React.useState(false)
    const [selectedMapping, setSelectedMapping] = React.useState<DealershipCampaignMappingResponse | null>(null)
    const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("")
    const [autoSendEnabled, setAutoSendEnabled] = React.useState(false)
    const [isSavingWhatsApp, setIsSavingWhatsApp] = React.useState(false)
    
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canEdit = isSuperAdmin || isDealershipAdmin || isDealershipOwner
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
        try {
            const data = await whatsappService.listTemplates()
            setTemplates(data)
        } catch (error) {
            console.error("Failed to load WhatsApp templates:", error)
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

    const startEdit = (mapping: DealershipCampaignMappingResponse) => {
        setEditingId(mapping.id)
        setEditValue(mapping.display_name)
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditValue("")
    }

    const saveEdit = async () => {
        if (!editingId || !editValue.trim()) return
        
        setIsSaving(true)
        try {
            await updateCampaignMappingDisplayName(editingId, editValue.trim())
            toast({
                title: "Success",
                description: "Display name updated successfully",
            })
            setEditingId(null)
            setEditValue("")
            await loadMappings()
        } catch (error: any) {
            console.error("Failed to update display name:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to update display name",
                variant: "destructive",
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            saveEdit()
        } else if (e.key === "Escape") {
            cancelEdit()
        }
    }

    const openWhatsAppDialog = (mapping: DealershipCampaignMappingResponse) => {
        setSelectedMapping(mapping)
        setSelectedTemplateId(mapping.whatsapp_template_id || "")
        setAutoSendEnabled(mapping.whatsapp_auto_send || false)
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
            await updateCampaignWhatsAppTemplate(selectedMapping.id, {
                whatsapp_template_id: selectedTemplateId || null,
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
                        Only Dealership Admins, Owners, or Super Admins can edit campaign mappings.
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
                <h1 className="text-2xl font-bold tracking-tight">Campaign Display Names</h1>
                <p className="text-muted-foreground">
                    Customize how campaign names appear in the frontend for your dealership&apos;s leads.
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
                                            className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                                        >
                                            <div className="flex-1 min-w-0 mr-4">
                                                <div className="flex items-center gap-2 mb-1">
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
                                                
                                                {editingId === mapping.id ? (
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <Input
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            onKeyDown={handleKeyDown}
                                                            className="h-8"
                                                            placeholder="Display name..."
                                                            autoFocus
                                                        />
                                                        <Button
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={saveEdit}
                                                            disabled={isSaving || !editValue.trim()}
                                                        >
                                                            {isSaving ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <Save className="h-3.5 w-3.5" />
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8"
                                                            onClick={cancelEdit}
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-muted-foreground">
                                                            Display:
                                                        </span>
                                                        <span className="font-medium">
                                                            {mapping.display_name}
                                                        </span>
                                                    </div>
                                                )}
                                                
                                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
                                                            {mapping.whatsapp_auto_send && (
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
                                                {editingId !== mapping.id && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => startEdit(mapping)}
                                                        title="Edit display name"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
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
                        <strong>Note:</strong> You can edit the display name and configure WhatsApp templates for campaigns. 
                        The display name is what your team sees when viewing leads. 
                        WhatsApp templates can be set to auto-send when new leads match the campaign.
                        {isSuperAdmin && (
                            <span className="block mt-1">
                                As a Super Admin, you can manage all mapping settings in{" "}
                                <a href="/settings/sync-sources" className="text-primary underline">
                                    Sync Sources
                                </a>.
                            </span>
                        )}
                    </p>
                </CardContent>
            </Card>

            {/* WhatsApp Template Dialog */}
            <Dialog open={whatsappDialogOpen} onOpenChange={setWhatsappDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-green-600" />
                            WhatsApp Template Settings
                        </DialogTitle>
                        <DialogDescription>
                            Configure WhatsApp template for campaign: <strong>{selectedMapping?.display_name}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="template">WhatsApp Template</Label>
                            <Select
                                value={selectedTemplateId}
                                onValueChange={setSelectedTemplateId}
                            >
                                <SelectTrigger id="template">
                                    <SelectValue placeholder="Select a template..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="">No template</SelectItem>
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
                        </div>

                        <div className="flex items-center justify-between space-x-2 pt-2 border-t">
                            <div className="space-y-0.5">
                                <Label htmlFor="auto-send" className="flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-yellow-500" />
                                    Auto-send on new leads
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Automatically send the template when a new lead matches this campaign.
                                </p>
                            </div>
                            <Switch
                                id="auto-send"
                                checked={autoSendEnabled}
                                onCheckedChange={setAutoSendEnabled}
                                disabled={!selectedTemplateId}
                            />
                        </div>

                        {autoSendEnabled && !selectedTemplateId && (
                            <p className="text-xs text-orange-600 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                Select a template to enable auto-send.
                            </p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeWhatsAppDialog}>
                            Cancel
                        </Button>
                        <Button
                            onClick={saveWhatsAppSettings}
                            disabled={isSavingWhatsApp}
                            className="bg-green-600 hover:bg-green-700"
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
