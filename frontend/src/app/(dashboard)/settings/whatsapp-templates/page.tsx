"use client"

import * as React from "react"
import {
    Plus,
    Pencil,
    Trash2,
    Loader2,
    AlertCircle,
    MessageSquare,
    Save,
    X,
    Building2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useRole } from "@/hooks/use-role"
import { useToast } from "@/hooks/use-toast"
import {
    whatsappService,
    WhatsAppTemplateItem,
    CreateWhatsAppTemplateRequest,
} from "@/services/whatsapp-service"

export default function WhatsAppTemplatesPage() {
    const [templates, setTemplates] = React.useState<WhatsAppTemplateItem[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    
    // Dialog states
    const [isDialogOpen, setIsDialogOpen] = React.useState(false)
    const [isEditing, setIsEditing] = React.useState(false)
    const [selectedTemplate, setSelectedTemplate] = React.useState<WhatsAppTemplateItem | null>(null)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
    
    // Form states
    const [formData, setFormData] = React.useState({
        content_sid: "",
        name: "",
        variable_names: "",
    })
    const [isSaving, setIsSaving] = React.useState(false)
    
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canManage = isSuperAdmin || isDealershipAdmin || isDealershipOwner
    const { toast } = useToast()

    const loadTemplates = React.useCallback(async () => {
        try {
            const data = await whatsappService.listTemplates()
            setTemplates(data)
        } catch (error) {
            console.error("Failed to load WhatsApp templates:", error)
            toast({
                title: "Error",
                description: "Failed to load WhatsApp templates",
                variant: "destructive",
            })
        } finally {
            setIsLoading(false)
        }
    }, [toast])

    React.useEffect(() => {
        if (canManage) {
            loadTemplates()
        } else {
            setIsLoading(false)
        }
    }, [loadTemplates, canManage])

    const resetForm = () => {
        setFormData({
            content_sid: "",
            name: "",
            variable_names: "",
        })
        setSelectedTemplate(null)
        setIsEditing(false)
    }

    const openCreateDialog = () => {
        resetForm()
        setIsDialogOpen(true)
    }

    const openEditDialog = (template: WhatsAppTemplateItem) => {
        setSelectedTemplate(template)
        setFormData({
            content_sid: template.content_sid,
            name: template.name,
            variable_names: template.variable_names.join(", "),
        })
        setIsEditing(true)
        setIsDialogOpen(true)
    }

    const openDeleteDialog = (template: WhatsAppTemplateItem) => {
        setSelectedTemplate(template)
        setIsDeleteDialogOpen(true)
    }

    const closeDialog = () => {
        setIsDialogOpen(false)
        resetForm()
    }

    const handleSave = async () => {
        if (!formData.content_sid.trim() || !formData.name.trim()) {
            toast({
                title: "Validation Error",
                description: "Content SID and Name are required",
                variant: "destructive",
            })
            return
        }

        setIsSaving(true)
        try {
            const variableNames = formData.variable_names
                .split(",")
                .map(v => v.trim())
                .filter(v => v.length > 0)

            if (isEditing && selectedTemplate) {
                await whatsappService.updateTemplate(selectedTemplate.id, {
                    content_sid: formData.content_sid.trim(),
                    name: formData.name.trim(),
                    variable_names: variableNames,
                })
                toast({
                    title: "Success",
                    description: "Template updated successfully",
                })
            } else {
                await whatsappService.createTemplate({
                    content_sid: formData.content_sid.trim(),
                    name: formData.name.trim(),
                    variable_names: variableNames,
                })
                toast({
                    title: "Success",
                    description: "Template created successfully",
                })
            }
            closeDialog()
            await loadTemplates()
        } catch (error: any) {
            console.error("Failed to save template:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to save template",
                variant: "destructive",
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!selectedTemplate) return

        try {
            await whatsappService.deleteTemplate(selectedTemplate.id)
            toast({
                title: "Success",
                description: "Template deleted successfully",
            })
            setIsDeleteDialogOpen(false)
            setSelectedTemplate(null)
            await loadTemplates()
        } catch (error: any) {
            console.error("Failed to delete template:", error)
            toast({
                title: "Error",
                description: error.response?.data?.detail || "Failed to delete template",
                variant: "destructive",
            })
        }
    }

    if (!canManage) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-lg font-semibold">Access Denied</h2>
                    <p className="text-muted-foreground">
                        Only Dealership Admins, Owners, or Super Admins can manage WhatsApp templates.
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

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <MessageSquare className="h-6 w-6 text-green-600" />
                        WhatsApp Templates
                    </h1>
                    <p className="text-muted-foreground">
                        Register pre-approved Twilio Content Templates for use in campaigns.
                    </p>
                </div>
                <Button onClick={openCreateDialog} className="bg-green-600 hover:bg-green-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Template
                </Button>
            </div>

            {templates.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold">No Templates Yet</h3>
                            <p className="text-muted-foreground mb-4">
                                Register your Twilio Content Templates to use them in campaigns.
                            </p>
                            <Button onClick={openCreateDialog} variant="outline">
                                <Plus className="h-4 w-4 mr-2" />
                                Add Your First Template
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {templates.map((template) => (
                        <Card key={template.id}>
                            <CardContent className="py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-medium">{template.name}</h3>
                                            {template.dealership_id ? (
                                                <Badge variant="secondary" className="text-[10px]">
                                                    <Building2 className="h-2.5 w-2.5 mr-0.5" />
                                                    Dealership
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[10px]">
                                                    Global
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground font-mono">
                                            {template.content_sid}
                                        </p>
                                        {template.variable_names.length > 0 && (
                                            <div className="flex items-center gap-1 mt-2">
                                                <span className="text-xs text-muted-foreground">Variables:</span>
                                                {template.variable_names.map((v) => (
                                                    <Badge key={v} variant="secondary" className="text-[10px]">
                                                        {`{{${v}}}`}
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => openEditDialog(template)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                            onClick={() => openDeleteDialog(template)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Card className="bg-muted/30">
                <CardContent className="py-4">
                    <p className="text-sm text-muted-foreground">
                        <strong>Note:</strong> Templates must be approved in the{" "}
                        <a
                            href="https://console.twilio.com/us1/develop/sms/content-template-builder"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                        >
                            Twilio Content Template Builder
                        </a>{" "}
                        before registering them here. The Content SID starts with &quot;HX&quot;.
                    </p>
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-green-600" />
                            {isEditing ? "Edit Template" : "Add Template"}
                        </DialogTitle>
                        <DialogDescription>
                            {isEditing
                                ? "Update the template details."
                                : "Register a Twilio Content Template for WhatsApp messaging."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="content_sid">Content SID *</Label>
                            <Input
                                id="content_sid"
                                value={formData.content_sid}
                                onChange={(e) =>
                                    setFormData({ ...formData, content_sid: e.target.value })
                                }
                                placeholder="HX..."
                            />
                            <p className="text-xs text-muted-foreground">
                                The Twilio Content SID (starts with HX).
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="name">Name *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData({ ...formData, name: e.target.value })
                                }
                                placeholder="e.g., Initial Contact Spanish"
                            />
                            <p className="text-xs text-muted-foreground">
                                A friendly name to identify this template.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="variable_names">Variable Names</Label>
                            <Input
                                id="variable_names"
                                value={formData.variable_names}
                                onChange={(e) =>
                                    setFormData({ ...formData, variable_names: e.target.value })
                                }
                                placeholder="1, 2, first_name"
                            />
                            <p className="text-xs text-muted-foreground">
                                Comma-separated variable placeholders (e.g., 1, 2 for {`{{1}}, {{2}}`}).
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeDialog}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            {isEditing ? "Update" : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Template</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete the template &quot;{selectedTemplate?.name}&quot;?
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
