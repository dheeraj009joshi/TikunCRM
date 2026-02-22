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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useRole } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import {
    CampaignMapping,
    getDealershipCampaignMappings,
    updateCampaignMappingDisplayName,
} from "@/services/sync-source-service"

export default function CampaignMappingsPage() {
    const [mappings, setMappings] = React.useState<CampaignMapping[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [editingId, setEditingId] = React.useState<string | null>(null)
    const [editValue, setEditValue] = React.useState("")
    const [isSaving, setIsSaving] = React.useState(false)
    
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

    React.useEffect(() => {
        if (canEdit) {
            loadMappings()
        } else {
            setIsLoading(false)
        }
    }, [loadMappings, canEdit])

    const startEdit = (mapping: CampaignMapping) => {
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
        const sourceName = mapping.sync_source?.display_name || mapping.sync_source?.name || "Unknown Source"
        
        if (!acc[sourceId]) {
            acc[sourceId] = {
                name: sourceName,
                mappings: [],
            }
        }
        acc[sourceId].mappings.push(mapping)
        return acc
    }, {} as Record<string, { name: string; mappings: CampaignMapping[] }>)

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
                                                    {mapping.dealership && (
                                                        <span>
                                                            Dealership: {mapping.dealership.name}
                                                        </span>
                                                    )}
                                                    <span>
                                                        {mapping.leads_matched} leads matched
                                                    </span>
                                                    {!mapping.is_active && (
                                                        <Badge variant="secondary" className="text-[10px]">
                                                            Inactive
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {editingId !== mapping.id && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0"
                                                    onClick={() => startEdit(mapping)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
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
                        <strong>Note:</strong> You can only edit the display name for campaigns. 
                        The display name is what your team sees when viewing leads. 
                        Changes apply globally to the campaign mapping.
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
        </div>
    )
}
