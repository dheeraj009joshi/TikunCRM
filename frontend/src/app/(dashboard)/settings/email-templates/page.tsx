"use client"

import * as React from "react"
import { 
    Plus, 
    Search, 
    Edit2, 
    Trash2, 
    FileText, 
    Loader2, 
    Copy,
    Eye,
    ArrowLeft,
    X,
    Mail,
    Sparkles,
} from "lucide-react"
import { useBrowserTimezone } from "@/hooks/use-browser-timezone"
import { formatDateInTimezone } from "@/utils/timezone"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { RichTextEditor } from "@/components/emails/rich-text-editor"
import { 
    EmailTemplateService, 
    EmailTemplate, 
    TEMPLATE_CATEGORIES,
    TemplateCategory 
} from "@/services/email-service"

export default function EmailTemplatesPage() {
    const [templates, setTemplates] = React.useState<EmailTemplate[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [search, setSearch] = React.useState("")
    const [categoryFilter, setCategoryFilter] = React.useState<string>("all")
    const { timezone } = useBrowserTimezone()
    
    // Editor states
    const [isEditorOpen, setIsEditorOpen] = React.useState(false)
    const [isEditing, setIsEditing] = React.useState(false)
    const [selectedTemplate, setSelectedTemplate] = React.useState<EmailTemplate | null>(null)
    const [isPreviewOpen, setIsPreviewOpen] = React.useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
    
    // Form states
    const [formData, setFormData] = React.useState({
        name: "",
        description: "",
        category: "custom" as TemplateCategory,
        subject: "",
        body_html: "",
    })
    const [isSaving, setIsSaving] = React.useState(false)
    
    const fetchTemplates = React.useCallback(async () => {
        setIsLoading(true)
        try {
            const response = await EmailTemplateService.listTemplates({
                search: search || undefined,
                category: categoryFilter !== "all" ? categoryFilter as TemplateCategory : undefined,
                page_size: 100
            })
            setTemplates(response.items)
        } catch (error) {
            console.error("Failed to fetch templates:", error)
        } finally {
            setIsLoading(false)
        }
    }, [search, categoryFilter])
    
    React.useEffect(() => {
        fetchTemplates()
    }, [fetchTemplates])
    
    const resetForm = () => {
        setFormData({
            name: "",
            description: "",
            category: "custom",
            subject: "",
            body_html: "",
        })
        setSelectedTemplate(null)
        setIsEditing(false)
    }
    
    const handleSave = async () => {
        if (!formData.name || !formData.subject) return
        
        setIsSaving(true)
        try {
            if (isEditing && selectedTemplate) {
                await EmailTemplateService.updateTemplate(selectedTemplate.id, {
                    name: formData.name,
                    description: formData.description,
                    category: formData.category,
                    subject: formData.subject,
                    body_html: formData.body_html,
                    body_text: stripHtml(formData.body_html),
                })
            } else {
                await EmailTemplateService.createTemplate({
                    name: formData.name,
                    description: formData.description,
                    category: formData.category,
                    subject: formData.subject,
                    body_html: formData.body_html,
                    body_text: stripHtml(formData.body_html),
                })
            }
            setIsEditorOpen(false)
            resetForm()
            fetchTemplates()
        } catch (error) {
            console.error("Failed to save template:", error)
        } finally {
            setIsSaving(false)
        }
    }
    
    const stripHtml = (html: string): string => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return doc.body.textContent || ""
    }
    
    const handleDelete = async () => {
        if (!selectedTemplate) return
        try {
            await EmailTemplateService.deleteTemplate(selectedTemplate.id)
            setIsDeleteDialogOpen(false)
            setSelectedTemplate(null)
            fetchTemplates()
        } catch (error) {
            console.error("Failed to delete template:", error)
        }
    }
    
    const openEditor = (template?: EmailTemplate) => {
        if (template) {
            setSelectedTemplate(template)
            setFormData({
                name: template.name,
                description: template.description || "",
                category: template.category,
                subject: template.subject,
                body_html: template.body_html || template.body_text || "",
            })
            setIsEditing(true)
        } else {
            resetForm()
        }
        setIsEditorOpen(true)
    }
    
    const openPreview = (template: EmailTemplate) => {
        setSelectedTemplate(template)
        setIsPreviewOpen(true)
    }
    
    const openDeleteDialog = (template: EmailTemplate) => {
        setSelectedTemplate(template)
        setIsDeleteDialogOpen(true)
    }
    
    const duplicateTemplate = async (template: EmailTemplate) => {
        try {
            await EmailTemplateService.createTemplate({
                name: `${template.name} (Copy)`,
                description: template.description,
                category: template.category,
                subject: template.subject,
                body_html: template.body_html,
                body_text: template.body_text,
            })
            fetchTemplates()
        } catch (error) {
            console.error("Failed to duplicate template:", error)
        }
    }
    
    const getCategoryColor = (category: string) => {
        const colors: Record<string, string> = {
            follow_up: "bg-amber-100 text-amber-700 border-amber-200",
            introduction: "bg-blue-100 text-blue-700 border-blue-200",
            quote: "bg-emerald-100 text-emerald-700 border-emerald-200",
            thank_you: "bg-purple-100 text-purple-700 border-purple-200",
            appointment: "bg-rose-100 text-rose-700 border-rose-200",
            custom: "bg-gray-100 text-gray-700 border-gray-200",
        }
        return colors[category] || colors.custom
    }

    // Gmail-style Editor Dialog
    if (isEditorOpen) {
        return (
            <div className="fixed inset-0 bg-background z-50 flex flex-col">
                {/* Editor Header */}
                <div className="flex items-center justify-between border-b px-4 py-3 bg-background">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => { setIsEditorOpen(false); resetForm(); }}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div>
                            <h1 className="text-lg font-semibold">
                                {isEditing ? "Edit Template" : "Create New Template"}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Design your email template with rich formatting
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => { setIsEditorOpen(false); resetForm(); }}>
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSave} 
                            disabled={isSaving || !formData.name || !formData.subject}
                        >
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {isEditing ? "Save Changes" : "Create Template"}
                        </Button>
                    </div>
                </div>
                
                {/* Editor Content */}
                <div className="flex-1 overflow-auto">
                    <div className="max-w-4xl mx-auto py-6 px-4">
                        {/* Template Info Section */}
                        <Card className="mb-6">
                            <CardContent className="pt-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="name" className="text-sm font-medium">
                                            Template Name <span className="text-destructive">*</span>
                                        </Label>
                                        <Input
                                            id="name"
                                            placeholder="e.g., Follow-up after meeting"
                                            value={formData.name}
                                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                            className="h-11"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="category" className="text-sm font-medium">Category</Label>
                                        <Select 
                                            value={formData.category} 
                                            onValueChange={(v) => setFormData(prev => ({ ...prev, category: v as TemplateCategory }))}
                                        >
                                            <SelectTrigger className="h-11">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {TEMPLATE_CATEGORIES.map((cat) => (
                                                    <SelectItem key={cat.value} value={cat.value}>
                                                        {cat.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="mt-4 space-y-2">
                                    <Label htmlFor="description" className="text-sm font-medium">
                                        Description <span className="text-muted-foreground">(optional)</span>
                                    </Label>
                                    <Input
                                        id="description"
                                        placeholder="When should this template be used?"
                                        value={formData.description}
                                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                        className="h-11"
                                    />
                                </div>
                            </CardContent>
                        </Card>
                        
                        {/* Email Compose Section - Gmail Style */}
                        <Card>
                            <CardContent className="p-0">
                                {/* Email Header */}
                                <div className="border-b p-4 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <Label className="w-20 text-sm text-muted-foreground">Subject:</Label>
                                        <Input
                                            placeholder="Enter email subject line"
                                            value={formData.subject}
                                            onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                                            className="flex-1 border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-base"
                                        />
                                    </div>
                                </div>
                                
                                {/* Email Body - Rich Text Editor */}
                                <div className="p-0">
                                    <RichTextEditor
                                        content={formData.body_html}
                                        onChange={(html) => setFormData(prev => ({ ...prev, body_html: html }))}
                                        placeholder="Compose your email template..."
                                        minHeight="400px"
                                    />
                                </div>
                            </CardContent>
                        </Card>
                        
                        {/* Variables Help */}
                        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <div className="flex items-start gap-3">
                                <Sparkles className="h-5 w-5 text-blue-500 mt-0.5" />
                                <div>
                                    <h4 className="font-medium text-blue-900 mb-1">Available Variables</h4>
                                    <p className="text-sm text-blue-700 mb-2">
                                        Use these placeholders and they&apos;ll be automatically replaced when sending:
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            "{{lead_name}}",
                                            "{{lead_first_name}}",
                                            "{{lead_email}}",
                                            "{{dealership_name}}",
                                            "{{salesperson_name}}",
                                            "{{current_date}}"
                                        ].map((v) => (
                                            <code 
                                                key={v} 
                                                className="px-2 py-1 bg-white rounded border text-xs text-blue-800 cursor-pointer hover:bg-blue-100"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(v)
                                                }}
                                                title="Click to copy"
                                            >
                                                {v}
                                            </code>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Email Templates</h1>
                    <p className="text-muted-foreground">
                        Create and manage reusable email templates
                    </p>
                </div>
                <Button onClick={() => openEditor()}>
                    <Plus className="h-4 w-4 mr-2" />
                    New Template
                </Button>
            </div>
            
            {/* Filters */}
            <div className="flex gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search templates..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-48">
                        <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {TEMPLATE_CATEGORIES.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                                {cat.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            
            {/* Templates Grid */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : templates.length === 0 ? (
                <Card>
                    <CardContent className="text-center py-16">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                            <Mail className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="font-semibold text-lg mb-2">No templates yet</h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                            Create email templates to save time when composing messages. 
                            Templates can include rich formatting and variables.
                        </p>
                        <Button onClick={() => openEditor()}>
                            <Plus className="h-4 w-4 mr-2" />
                            Create Your First Template
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {templates.map((template) => (
                        <Card 
                            key={template.id} 
                            className="group hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => openPreview(template)}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <Badge className={`${getCategoryColor(template.category)} border`}>
                                        {template.category.replace("_", " ")}
                                    </Badge>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={(e) => { e.stopPropagation(); duplicateTemplate(template); }}
                                            title="Duplicate"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                        {!template.is_system && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={(e) => { e.stopPropagation(); openEditor(template); }}
                                                    title="Edit"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive"
                                                    onClick={(e) => { e.stopPropagation(); openDeleteDialog(template); }}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                
                                <h3 className="font-semibold mb-1 line-clamp-1">{template.name}</h3>
                                {template.description && (
                                    <p className="text-sm text-muted-foreground mb-3 line-clamp-1">
                                        {template.description}
                                    </p>
                                )}
                                
                                <div className="text-sm text-muted-foreground mb-3">
                                    <span className="font-medium">Subject:</span> {template.subject}
                                </div>
                                
                                <div className="text-xs text-muted-foreground">
                                    Updated {formatDateInTimezone(template.updated_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            
            {/* Preview Modal */}
            <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between pr-8">
                            <span>{selectedTemplate?.name}</span>
                            {selectedTemplate && !selectedTemplate.is_system && (
                                <Button variant="outline" size="sm" onClick={() => { setIsPreviewOpen(false); openEditor(selectedTemplate); }}>
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Edit
                                </Button>
                            )}
                        </DialogTitle>
                    </DialogHeader>
                    
                    {selectedTemplate && (
                        <div className="flex-1 overflow-auto">
                            <div className="border rounded-lg overflow-hidden">
                                <div className="bg-muted/30 px-4 py-3 border-b">
                                    <div className="text-sm">
                                        <span className="text-muted-foreground">Subject: </span>
                                        <span className="font-medium">{selectedTemplate.subject}</span>
                                    </div>
                                </div>
                                <div 
                                    className="p-4 prose prose-sm max-w-none"
                                    dangerouslySetInnerHTML={{ 
                                        __html: selectedTemplate.body_html || selectedTemplate.body_text || "<p class='text-muted-foreground'>No content</p>" 
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            
            {/* Delete Confirmation */}
            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Template</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &quot;{selectedTemplate?.name}&quot;? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
