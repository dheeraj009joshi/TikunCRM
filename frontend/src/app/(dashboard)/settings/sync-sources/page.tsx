"use client"

import * as React from "react"
import {
    Plus,
    Pencil,
    Trash2,
    Loader2,
    RefreshCw,
    ExternalLink,
    AlertCircle,
    CheckCircle,
    Clock,
    Database,
    Settings2,
    ChevronDown,
    ChevronRight,
    FileSpreadsheet,
    ArrowLeft,
    Search,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { useRole } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import {
    LeadSyncSource,
    CampaignMapping,
    MatchType,
    getSyncSources,
    updateSyncSource,
    deleteSyncSource,
    triggerSyncSource,
    createCampaignMapping,
    updateCampaignMapping,
    deleteCampaignMapping,
    previewSheetByUrl,
    createSyncSourceWithMappings,
    SheetPreviewByUrl,
    CampaignMappingInput,
} from "@/services/sync-source-service"
import { DealershipService, Dealership } from "@/services/dealership-service"
import { formatDistanceToNow } from "date-fns"

const MATCH_TYPE_OPTIONS: { value: MatchType; label: string }[] = [
    { value: "exact", label: "Exact Match" },
    { value: "contains", label: "Contains" },
    { value: "starts_with", label: "Starts With" },
    { value: "ends_with", label: "Ends With" },
    { value: "regex", label: "Regex" },
]

interface CampaignMappingEntry {
    rawName: string
    displayName: string
    dealershipId: string
    matchType: MatchType
}

export default function SyncSourcesSettingsPage() {
    const [sources, setSources] = React.useState<LeadSyncSource[]>([])
    const [dealerships, setDealerships] = React.useState<Dealership[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [expandedSource, setExpandedSource] = React.useState<string | null>(null)
    
    // Wizard state
    const [showWizard, setShowWizard] = React.useState(false)
    const [wizardStep, setWizardStep] = React.useState<"url" | "configure">("url")
    const [sheetUrl, setSheetUrl] = React.useState("")
    const [sheetGid, setSheetGid] = React.useState("0")
    const [isFetchingPreview, setIsFetchingPreview] = React.useState(false)
    const [previewData, setPreviewData] = React.useState<SheetPreviewByUrl | null>(null)
    
    // Source form state (step 2)
    const [sourceForm, setSourceForm] = React.useState({
        name: "",
        display_name: "",
        default_dealership_id: "none",
        sync_interval_minutes: 5,
        is_active: true,
    })
    const [campaignMappings, setCampaignMappings] = React.useState<CampaignMappingEntry[]>([])
    const [isSaving, setIsSaving] = React.useState(false)
    
    // Edit source dialog (for existing sources)
    const [showEditDialog, setShowEditDialog] = React.useState(false)
    const [editSource, setEditSource] = React.useState<LeadSyncSource | null>(null)
    const [editForm, setEditForm] = React.useState({
        name: "",
        display_name: "",
        default_dealership_id: "none",
        sync_interval_minutes: 5,
        is_active: true,
    })
    const [isSavingEdit, setIsSavingEdit] = React.useState(false)
    
    // Add mapping dialog (for existing sources)
    const [showMappingDialog, setShowMappingDialog] = React.useState(false)
    const [mappingSourceId, setMappingSourceId] = React.useState<string | null>(null)
    const [mappingForm, setMappingForm] = React.useState({
        match_pattern: "",
        match_type: "contains" as MatchType,
        display_name: "",
        dealership_id: "none",
        priority: 100,
        is_active: true,
    })
    const [editMapping, setEditMapping] = React.useState<CampaignMapping | null>(null)
    const [isSavingMapping, setIsSavingMapping] = React.useState(false)
    
    // Sync state
    const [syncingSourceId, setSyncingSourceId] = React.useState<string | null>(null)
    
    const { isSuperAdmin } = useRole()
    const { toast } = useToast()

    const loadData = React.useCallback(async () => {
        try {
            const [sourcesData, dealershipsData] = await Promise.all([
                getSyncSources(),
                DealershipService.listDealerships(),
            ])
            setSources(Array.isArray(sourcesData) ? sourcesData : [])
            setDealerships(Array.isArray(dealershipsData) ? dealershipsData : [])
        } catch (error) {
            console.error("Failed to load sync sources:", error)
            setSources([])
            setDealerships([])
            toast({
                title: "Error",
                description: "Failed to load sync sources",
                variant: "destructive",
            })
        } finally {
            setIsLoading(false)
        }
    }, [toast])

    React.useEffect(() => {
        if (isSuperAdmin) {
            loadData()
        } else {
            setIsLoading(false)
        }
    }, [loadData, isSuperAdmin])

    // ==================== WIZARD FUNCTIONS ====================
    
    const openWizard = () => {
        setShowWizard(true)
        setWizardStep("url")
        setSheetUrl("")
        setSheetGid("0")
        setPreviewData(null)
        setSourceForm({
            name: "",
            display_name: "",
            default_dealership_id: "none",
            sync_interval_minutes: 5,
            is_active: true,
        })
        setCampaignMappings([])
    }
    
    const closeWizard = () => {
        setShowWizard(false)
        setWizardStep("url")
        setPreviewData(null)
    }
    
    const handleFetchSheet = async () => {
        if (!sheetUrl.trim()) {
            toast({
                title: "Error",
                description: "Please enter a Google Sheet URL",
                variant: "destructive",
            })
            return
        }
        
        setIsFetchingPreview(true)
        try {
            const preview = await previewSheetByUrl(sheetUrl, sheetGid)
            setPreviewData(preview)
            
            // Initialize campaign mappings from unique campaigns
            const mappings: CampaignMappingEntry[] = preview.unique_campaigns.map((campaign) => ({
                rawName: campaign,
                displayName: "",
                dealershipId: "default",
                matchType: "contains" as MatchType,
            }))
            setCampaignMappings(mappings)
            
            // Auto-generate source name from URL
            const suggestedName = sheetUrl
                .replace(/.*\/d\//, "")
                .replace(/\/.*/, "")
                .slice(0, 20)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "_")
            
            setSourceForm((prev) => ({
                ...prev,
                name: prev.name || `sheet_${suggestedName}`,
                display_name: prev.display_name || "New Lead Source",
            }))
            
            setWizardStep("configure")
            
            toast({
                title: "Sheet Loaded",
                description: `Found ${preview.total_rows} rows and ${preview.unique_campaigns.length} unique campaigns`,
            })
        } catch (error: any) {
            console.error("Failed to fetch sheet:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to fetch sheet. Make sure it's publicly accessible.",
                variant: "destructive",
            })
        } finally {
            setIsFetchingPreview(false)
        }
    }
    
    const handleCampaignMappingChange = (index: number, field: keyof CampaignMappingEntry, value: string) => {
        setCampaignMappings((prev) => {
            const updated = [...prev]
            updated[index] = { ...updated[index], [field]: value }
            return updated
        })
    }
    
    const allCampaignsMapped = React.useMemo(() => {
        return campaignMappings.every((m) => m.displayName.trim().length > 0)
    }, [campaignMappings])
    
    const handleCreateSource = async () => {
        if (!sourceForm.name || !sourceForm.display_name) {
            toast({
                title: "Error",
                description: "Source name and display name are required",
                variant: "destructive",
            })
            return
        }
        
        if (!allCampaignsMapped) {
            toast({
                title: "Error",
                description: "All campaigns must have display names",
                variant: "destructive",
            })
            return
        }
        
        setIsSaving(true)
        try {
            const mappingsData: CampaignMappingInput[] = campaignMappings.map((m, idx) => ({
                match_pattern: m.rawName,
                match_type: m.matchType,
                display_name: m.displayName,
                dealership_id: m.dealershipId === "default" || m.dealershipId === "none" ? null : m.dealershipId,
                priority: idx * 10,
                is_active: true,
            }))
            
            await createSyncSourceWithMappings({
                source: {
                    name: sourceForm.name,
                    display_name: sourceForm.display_name,
                    sheet_id: previewData!.sheet_id,
                    sheet_gid: previewData!.sheet_gid,
                    default_dealership_id: sourceForm.default_dealership_id === "none" ? null : sourceForm.default_dealership_id,
                    sync_interval_minutes: sourceForm.sync_interval_minutes,
                    is_active: sourceForm.is_active,
                },
                campaign_mappings: mappingsData,
            })
            
            toast({
                title: "Success",
                description: `Created sync source with ${mappingsData.length} campaign mappings`,
            })
            
            closeWizard()
            await loadData()
        } catch (error: any) {
            console.error("Failed to create sync source:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to create sync source",
                variant: "destructive",
            })
        } finally {
            setIsSaving(false)
        }
    }

    // ==================== EDIT SOURCE FUNCTIONS ====================
    
    const openEditSource = (source: LeadSyncSource) => {
        setEditSource(source)
        setEditForm({
            name: source.name,
            display_name: source.display_name,
            default_dealership_id: source.default_dealership_id || "none",
            sync_interval_minutes: source.sync_interval_minutes,
            is_active: source.is_active,
        })
        setShowEditDialog(true)
    }
    
    const handleUpdateSource = async () => {
        if (!editSource) return
        
        setIsSavingEdit(true)
        try {
            await updateSyncSource(editSource.id, {
                name: editForm.name,
                display_name: editForm.display_name,
                default_dealership_id: editForm.default_dealership_id === "none" ? null : editForm.default_dealership_id,
                sync_interval_minutes: editForm.sync_interval_minutes,
                is_active: editForm.is_active,
            })
            
            toast({ title: "Success", description: "Sync source updated" })
            setShowEditDialog(false)
            setEditSource(null)
            await loadData()
        } catch (error: any) {
            console.error("Failed to update sync source:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to update sync source",
                variant: "destructive",
            })
        } finally {
            setIsSavingEdit(false)
        }
    }

    const handleDeleteSource = async (source: LeadSyncSource) => {
        if (!confirm(`Delete "${source.display_name}"? This will remove all campaign mappings.`)) return
        
        try {
            await deleteSyncSource(source.id)
            toast({ title: "Success", description: "Sync source deleted" })
            await loadData()
        } catch (error: any) {
            console.error("Failed to delete sync source:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to delete sync source",
                variant: "destructive",
            })
        }
    }

    const handleTriggerSync = async (source: LeadSyncSource) => {
        setSyncingSourceId(source.id)
        try {
            const result = await triggerSyncSource(source.id)
            toast({
                title: "Sync Complete",
                description: `${result.leads_synced || 0} new leads, ${result.leads_updated || 0} updated, ${result.leads_skipped || 0} skipped`,
            })
            await loadData()
        } catch (error: any) {
            console.error("Failed to trigger sync:", error)
            toast({
                title: "Sync Failed",
                description: error.response?.data?.detail || "Failed to sync",
                variant: "destructive",
            })
        } finally {
            setSyncingSourceId(null)
        }
    }

    // ==================== MAPPING FUNCTIONS (for existing sources) ====================
    
    const openCreateMapping = (sourceId: string) => {
        setEditMapping(null)
        setMappingSourceId(sourceId)
        setMappingForm({
            match_pattern: "",
            match_type: "contains",
            display_name: "",
            dealership_id: "none",
            priority: 100,
            is_active: true,
        })
        setShowMappingDialog(true)
    }

    const openEditMapping = (sourceId: string, mapping: CampaignMapping) => {
        setEditMapping(mapping)
        setMappingSourceId(sourceId)
        setMappingForm({
            match_pattern: mapping.match_pattern,
            match_type: mapping.match_type,
            display_name: mapping.display_name,
            dealership_id: mapping.dealership_id || "none",
            priority: mapping.priority,
            is_active: mapping.is_active,
        })
        setShowMappingDialog(true)
    }

    const handleSaveMapping = async () => {
        if (!mappingForm.match_pattern || !mappingForm.display_name || !mappingSourceId) {
            toast({
                title: "Error",
                description: "Pattern and display name are required",
                variant: "destructive",
            })
            return
        }
        
        setIsSavingMapping(true)
        try {
            const payload = {
                ...mappingForm,
                dealership_id: mappingForm.dealership_id === "none" ? null : mappingForm.dealership_id,
            }
            
            if (editMapping) {
                await updateCampaignMapping(mappingSourceId, editMapping.id, payload)
                toast({ title: "Success", description: "Campaign mapping updated" })
            } else {
                await createCampaignMapping(mappingSourceId, payload)
                toast({ title: "Success", description: "Campaign mapping created" })
            }
            
            setShowMappingDialog(false)
            setEditMapping(null)
            setMappingSourceId(null)
            await loadData()
        } catch (error: any) {
            console.error("Failed to save mapping:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to save mapping",
                variant: "destructive",
            })
        } finally {
            setIsSavingMapping(false)
        }
    }

    const handleDeleteMapping = async (sourceId: string, mapping: CampaignMapping) => {
        if (!confirm(`Delete mapping "${mapping.display_name}"?`)) return
        
        try {
            await deleteCampaignMapping(sourceId, mapping.id)
            toast({ title: "Success", description: "Mapping deleted" })
            await loadData()
        } catch (error: any) {
            console.error("Failed to delete mapping:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to delete mapping",
                variant: "destructive",
            })
        }
    }

    // ==================== RENDER ====================

    if (!isSuperAdmin) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-lg font-semibold">Access Denied</h2>
                    <p className="text-muted-foreground">Only Super Admins can manage sync sources.</p>
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

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Lead Sync Sources</h1>
                    <p className="text-muted-foreground">
                        Configure Google Sheets and other sources for automatic lead import.
                    </p>
                </div>
                <Button onClick={openWizard}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Source
                </Button>
            </div>

            {sources.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold">No Sync Sources</h3>
                            <p className="text-muted-foreground mb-4">
                                Add a Google Sheet to start importing leads automatically.
                            </p>
                            <Button onClick={openWizard}>
                                <Plus className="h-4 w-4 mr-2" />
                                Add First Source
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {sources.map((source) => (
                        <Card key={source.id}>
                            <Collapsible
                                open={expandedSource === source.id}
                                onOpenChange={(open) => setExpandedSource(open ? source.id : null)}
                            >
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <CollapsibleTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                                    {expandedSource === source.id ? (
                                                        <ChevronDown className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </CollapsibleTrigger>
                                            <FileSpreadsheet className="h-5 w-5 text-green-600" />
                                            <div>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    {source.display_name}
                                                    {!source.is_active && (
                                                        <Badge variant="secondary">Inactive</Badge>
                                                    )}
                                                </CardTitle>
                                                <CardDescription className="text-xs">
                                                    {source.name} · Sheet ID: {source.sheet_id.slice(0, 20)}...
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleTriggerSync(source)}
                                                disabled={syncingSourceId === source.id}
                                            >
                                                {syncingSourceId === source.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                                                )}
                                                Sync Now
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEditSource(source)}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDeleteSource(source)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <Clock className="h-3.5 w-3.5" />
                                            Every {source.sync_interval_minutes} min
                                        </div>
                                        {source.last_synced_at && (
                                            <div className="flex items-center gap-1">
                                                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                                                Last sync: {formatDistanceToNow(new Date(source.last_synced_at), { addSuffix: true })}
                                                {source.last_sync_lead_count > 0 && (
                                                    <span>({source.last_sync_lead_count} leads)</span>
                                                )}
                                            </div>
                                        )}
                                        {source.last_sync_error && (
                                            <div className="flex items-center gap-1 text-destructive">
                                                <AlertCircle className="h-3.5 w-3.5" />
                                                Error: {source.last_sync_error.slice(0, 50)}
                                            </div>
                                        )}
                                        <div>
                                            Total: {source.total_leads_synced} leads
                                        </div>
                                        {source.default_dealership && (
                                            <div>
                                                Default: {source.default_dealership.name}
                                            </div>
                                        )}
                                    </div>
                                </CardHeader>
                                
                                <CollapsibleContent>
                                    <CardContent className="pt-0">
                                        <div className="border-t pt-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="text-sm font-medium flex items-center gap-2">
                                                    <Settings2 className="h-4 w-4" />
                                                    Campaign Mappings
                                                </h4>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => openCreateMapping(source.id)}
                                                >
                                                    <Plus className="h-3.5 w-3.5 mr-1" />
                                                    Add Mapping
                                                </Button>
                                            </div>
                                            
                                            {source.campaign_mappings && source.campaign_mappings.length > 0 ? (
                                                <div className="space-y-2">
                                                    {source.campaign_mappings.map((mapping) => (
                                                        <div
                                                            key={mapping.id}
                                                            className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                                                        >
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-medium text-sm">
                                                                        {mapping.display_name}
                                                                    </span>
                                                                    {!mapping.is_active && (
                                                                        <Badge variant="secondary" className="text-[10px]">
                                                                            Inactive
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                                    <code className="bg-muted px-1 rounded">
                                                                        {mapping.match_type}
                                                                    </code>
                                                                    {" "}&quot;{mapping.match_pattern}&quot;
                                                                    {mapping.dealership && (
                                                                        <span className="ml-2">
                                                                            → {mapping.dealership.name}
                                                                        </span>
                                                                    )}
                                                                    <span className="ml-2">
                                                                        ({mapping.leads_matched} matched)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7"
                                                                    onClick={() => openEditMapping(source.id, mapping)}
                                                                >
                                                                    <Pencil className="h-3 w-3" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7"
                                                                    onClick={() => handleDeleteMapping(source.id, mapping)}
                                                                >
                                                                    <Trash2 className="h-3 w-3 text-destructive" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground text-center py-4">
                                                    No campaign mappings configured. Add mappings to customize how campaigns are displayed.
                                                </p>
                                            )}
                                        </div>
                                    </CardContent>
                                </CollapsibleContent>
                            </Collapsible>
                        </Card>
                    ))}
                </div>
            )}

            {/* ==================== WIZARD DIALOG ==================== */}
            <Dialog open={showWizard} onOpenChange={setShowWizard}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {wizardStep === "url" ? "Add Sync Source" : "Configure Source & Map Campaigns"}
                        </DialogTitle>
                        <DialogDescription>
                            {wizardStep === "url"
                                ? "Paste a Google Sheet URL to preview the data and campaigns."
                                : `Found ${previewData?.total_rows || 0} rows and ${previewData?.unique_campaigns.length || 0} campaigns. Configure the source and map all campaigns.`}
                        </DialogDescription>
                    </DialogHeader>
                    
                    {wizardStep === "url" ? (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Google Sheet URL *</Label>
                                <Input
                                    value={sheetUrl}
                                    onChange={(e) => setSheetUrl(e.target.value)}
                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    The sheet must be publicly accessible (Anyone with the link can view).
                                </p>
                            </div>
                            
                            <div className="space-y-2">
                                <Label>Sheet Tab (GID)</Label>
                                <Input
                                    value={sheetGid}
                                    onChange={(e) => setSheetGid(e.target.value)}
                                    placeholder="0"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Default is 0 for the first tab. Find GID in the sheet URL after #gid=
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 py-4">
                            {/* Source Details */}
                            <div className="space-y-4">
                                <h4 className="font-medium text-sm">Source Details</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Internal Name *</Label>
                                        <Input
                                            value={sourceForm.name}
                                            onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                                            placeholder="e.g. facebook_leads"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Display Name *</Label>
                                        <Input
                                            value={sourceForm.display_name}
                                            onChange={(e) => setSourceForm({ ...sourceForm, display_name: e.target.value })}
                                            placeholder="e.g. Facebook Leads"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Default Dealership</Label>
                                        <Select
                                            value={sourceForm.default_dealership_id}
                                            onValueChange={(value) => setSourceForm({ ...sourceForm, default_dealership_id: value })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">None</SelectItem>
                                                {dealerships.map((d) => (
                                                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Sync Interval (minutes)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={sourceForm.sync_interval_minutes}
                                            onChange={(e) => setSourceForm({ ...sourceForm, sync_interval_minutes: parseInt(e.target.value) || 5 })}
                                        />
                                    </div>
                                </div>
                            </div>
                            
                            {/* Campaign Mappings Table */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-sm">Campaign Mappings</h4>
                                    {!allCampaignsMapped && (
                                        <Badge variant="destructive" className="text-xs">
                                            All campaigns must have display names
                                        </Badge>
                                    )}
                                </div>
                                
                                {campaignMappings.length > 0 ? (
                                    <div className="border rounded-lg overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[30%]">Campaign Name (Raw)</TableHead>
                                                    <TableHead className="w-[35%]">Display Name *</TableHead>
                                                    <TableHead className="w-[35%]">Dealership</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {campaignMappings.map((mapping, idx) => (
                                                    <TableRow key={idx}>
                                                        <TableCell className="font-mono text-xs">
                                                            {mapping.rawName}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input
                                                                value={mapping.displayName}
                                                                onChange={(e) => handleCampaignMappingChange(idx, "displayName", e.target.value)}
                                                                placeholder="Enter display name..."
                                                                className={!mapping.displayName ? "border-destructive" : ""}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Select
                                                                value={mapping.dealershipId}
                                                                onValueChange={(value) => handleCampaignMappingChange(idx, "dealershipId", value)}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="default">Use Default</SelectItem>
                                                                    {dealerships.map((d) => (
                                                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                                        No campaigns found in the sheet.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    
                    <DialogFooter>
                        {wizardStep === "url" ? (
                            <>
                                <Button variant="outline" onClick={closeWizard}>
                                    Cancel
                                </Button>
                                <Button onClick={handleFetchSheet} disabled={isFetchingPreview || !sheetUrl.trim()}>
                                    {isFetchingPreview ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4 mr-2" />
                                    )}
                                    Fetch Sheet
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button variant="outline" onClick={() => setWizardStep("url")}>
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Back
                                </Button>
                                <Button
                                    onClick={handleCreateSource}
                                    disabled={isSaving || !sourceForm.name || !sourceForm.display_name || !allCampaignsMapped}
                                >
                                    {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Create Source
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ==================== EDIT SOURCE DIALOG ==================== */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Sync Source</DialogTitle>
                        <DialogDescription>Update the sync source configuration.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Internal Name</Label>
                                <Input
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Display Name</Label>
                                <Input
                                    value={editForm.display_name}
                                    onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Default Dealership</Label>
                                <Select
                                    value={editForm.default_dealership_id}
                                    onValueChange={(value) => setEditForm({ ...editForm, default_dealership_id: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {dealerships.map((d) => (
                                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Sync Interval (minutes)</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={editForm.sync_interval_minutes}
                                    onChange={(e) => setEditForm({ ...editForm, sync_interval_minutes: parseInt(e.target.value) || 5 })}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label>Active</Label>
                            <Switch
                                checked={editForm.is_active}
                                onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleUpdateSource} disabled={isSavingEdit}>
                            {isSavingEdit && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ==================== MAPPING DIALOG ==================== */}
            <Dialog open={showMappingDialog} onOpenChange={setShowMappingDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editMapping ? "Edit Campaign Mapping" : "Add Campaign Mapping"}
                        </DialogTitle>
                        <DialogDescription>
                            Map campaign names to custom display names and dealership assignments.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Match Pattern *</Label>
                            <Input
                                value={mappingForm.match_pattern}
                                onChange={(e) => setMappingForm({ ...mappingForm, match_pattern: e.target.value })}
                                placeholder="e.g. facebook_campaign_2024"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Match Type</Label>
                            <Select
                                value={mappingForm.match_type}
                                onValueChange={(value) => setMappingForm({ ...mappingForm, match_type: value as MatchType })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MATCH_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Display Name *</Label>
                            <Input
                                value={mappingForm.display_name}
                                onChange={(e) => setMappingForm({ ...mappingForm, display_name: e.target.value })}
                                placeholder="e.g. Facebook Summer Campaign"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Dealership</Label>
                            <Select
                                value={mappingForm.dealership_id}
                                onValueChange={(value) => setMappingForm({ ...mappingForm, dealership_id: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Use source default..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Use Source Default</SelectItem>
                                    {dealerships.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        
                        <div className="flex items-center justify-between">
                            <Label>Active</Label>
                            <Switch
                                checked={mappingForm.is_active}
                                onCheckedChange={(checked) => setMappingForm({ ...mappingForm, is_active: checked })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowMappingDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveMapping} disabled={isSavingMapping || !mappingForm.match_pattern || !mappingForm.display_name}>
                            {isSavingMapping && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editMapping ? "Save Changes" : "Create Mapping"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
