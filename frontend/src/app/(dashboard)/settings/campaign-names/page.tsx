"use client"

import * as React from "react"
import {
    Pencil,
    Loader2,
    Save,
    X,
    Tag,
    AlertCircle,
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

export default function CampaignNamesSettingsPage() {
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
            setMappings(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error("Failed to load campaign mappings:", error)
            setMappings([])
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
        loadMappings()
    }, [loadMappings])

    const startEdit = (mapping: CampaignMapping) => {
        setEditingId(mapping.id)
        setEditValue(mapping.display_name)
    }

    const cancelEdit = () => {
        setEditingId(null)
        setEditValue("")
    }

    const saveEdit = async (mappingId: string) => {
        if (!editValue.trim()) {
            toast({
                title: "Validation Error",
                description: "Display name cannot be empty",
                variant: "destructive",
            })
            return
        }
        
        setIsSaving(true)
        try {
            await updateCampaignMappingDisplayName(mappingId, editValue.trim())
            toast({ title: "Success", description: "Campaign name updated" })
            setEditingId(null)
            setEditValue("")
            await loadMappings()
        } catch (error: any) {
            console.error("Failed to update campaign name:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to update campaign name",
                variant: "destructive",
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent, mappingId: string) => {
        if (e.key === "Enter") {
            saveEdit(mappingId)
        } else if (e.key === "Escape") {
            cancelEdit()
        }
    }

    if (isLoading) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!canEdit) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-lg font-semibold">Access Denied</h2>
                    <p className="text-muted-foreground">
                        Only Dealership Admins and Owners can edit campaign names.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Campaign Names</h1>
                <p className="text-muted-foreground">
                    Customize how campaign sources are displayed for leads in your dealership.
                </p>
            </div>

            {mappings.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <Tag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold">No Campaign Mappings</h3>
                            <p className="text-muted-foreground">
                                No campaign mappings are configured for your dealership yet.
                                Contact a Super Admin to set up lead sync sources.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Your Campaign Mappings</CardTitle>
                        <CardDescription>
                            Click the edit icon to change how a campaign is displayed in the frontend.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {mappings.map((mapping) => (
                                <div
                                    key={mapping.id}
                                    className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30"
                                >
                                    <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                                    
                                    <div className="flex-1 min-w-0">
                                        {editingId === mapping.id ? (
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onKeyDown={(e) => handleKeyDown(e, mapping.id)}
                                                    className="h-8"
                                                    autoFocus
                                                    disabled={isSaving}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => saveEdit(mapping.id)}
                                                    disabled={isSaving}
                                                >
                                                    {isSaving ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Save className="h-4 w-4 text-green-600" />
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={cancelEdit}
                                                    disabled={isSaving}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="font-medium text-sm">
                                                    {mapping.display_name}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    Pattern: <code className="bg-muted px-1 rounded">{mapping.match_pattern}</code>
                                                    {mapping.sync_source && (
                                                        <span className="ml-2">
                                                            Source: {mapping.sync_source.display_name}
                                                        </span>
                                                    )}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                    
                                    <div className="flex items-center gap-2">
                                        {!mapping.is_active && (
                                            <Badge variant="secondary" className="text-[10px]">
                                                Inactive
                                            </Badge>
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                            {mapping.leads_matched} leads
                                        </span>
                                        {editingId !== mapping.id && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => startEdit(mapping)}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
            
            <p className="text-xs text-muted-foreground">
                Note: Changes to display names affect how campaigns appear across all leads in your dealership.
                The original campaign pattern cannot be modified — only the display name.
            </p>
        </div>
    )
}
