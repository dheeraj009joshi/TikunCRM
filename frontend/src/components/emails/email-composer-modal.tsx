"use client"

import * as React from "react"
import { X, Send, Loader2, FileText, ChevronDown, Minimize2, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { RichTextEditor } from "@/components/emails/rich-text-editor"
import { EmailTemplateService, EmailTemplate } from "@/services/email-service"

interface EmailComposerModalProps {
    isOpen: boolean
    onClose: () => void
    leadId?: string
    leadEmail?: string
    leadName?: string
    onSent?: () => void
}

export function EmailComposerModal({
    isOpen,
    onClose,
    leadId,
    leadEmail,
    leadName,
    onSent
}: EmailComposerModalProps) {
    const [toEmail, setToEmail] = React.useState(leadEmail || "")
    const [ccEmails, setCcEmails] = React.useState("")
    const [subject, setSubject] = React.useState("")
    const [bodyHtml, setBodyHtml] = React.useState("")
    
    const [templates, setTemplates] = React.useState<EmailTemplate[]>([])
    const [selectedTemplate, setSelectedTemplate] = React.useState<string>("")
    const [isLoadingTemplates, setIsLoadingTemplates] = React.useState(false)
    
    const [isSending, setIsSending] = React.useState(false)
    const [error, setError] = React.useState("")
    const [success, setSuccess] = React.useState("")
    const [showCc, setShowCc] = React.useState(false)
    const [isFullscreen, setIsFullscreen] = React.useState(false)
    
    // Load templates on mount
    React.useEffect(() => {
        if (isOpen) {
            loadTemplates()
            setToEmail(leadEmail || "")
            setSubject("")
            setBodyHtml("")
            setCcEmails("")
            setSelectedTemplate("")
            setError("")
            setSuccess("")
            setShowCc(false)
        }
    }, [isOpen, leadEmail])
    
    const loadTemplates = async () => {
        setIsLoadingTemplates(true)
        try {
            const response = await EmailTemplateService.listTemplates({ page_size: 50 })
            setTemplates(response.items)
        } catch (err) {
            console.error("Failed to load templates:", err)
        } finally {
            setIsLoadingTemplates(false)
        }
    }
    
    const handleTemplateSelect = async (templateId: string) => {
        if (templateId === "none" || !templateId) {
            setSelectedTemplate("")
            return
        }
        
        setSelectedTemplate(templateId)
        
        try {
            const template = await EmailTemplateService.getTemplate(templateId)
            setSubject(template.subject)
            setBodyHtml(template.body_html || template.body_text || "")
        } catch (err) {
            console.error("Failed to load template:", err)
        }
    }
    
    const stripHtml = (html: string): string => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        return doc.body.textContent || ""
    }
    
    const handleSend = async () => {
        if (!toEmail || !subject) {
            setError("Please fill in recipient email and subject")
            return
        }
        
        const plainText = stripHtml(bodyHtml)
        if (!plainText.trim()) {
            setError("Please write a message")
            return
        }
        
        setIsSending(true)
        setError("")
        setSuccess("")
        
        try {
            const response = await EmailTemplateService.sendEmail({
                to_email: toEmail,
                cc_emails: ccEmails ? ccEmails.split(",").map(e => e.trim()).filter(e => e) : undefined,
                subject,
                body_text: plainText,
                body_html: bodyHtml,
                template_id: selectedTemplate || undefined,
                lead_id: leadId
            })
            
            if (response.success) {
                setSuccess("Email sent successfully!")
                setTimeout(() => {
                    onSent?.()
                    handleClose()
                }, 1500)
            } else {
                setError(response.message || "Failed to send email")
            }
        } catch (err: any) {
            console.error("Failed to send email:", err)
            setError(err?.response?.data?.detail || "Failed to send email. Please try again.")
        } finally {
            setIsSending(false)
        }
    }
    
    const handleClose = () => {
        setToEmail("")
        setCcEmails("")
        setSubject("")
        setBodyHtml("")
        setSelectedTemplate("")
        setError("")
        setSuccess("")
        setIsFullscreen(false)
        onClose()
    }
    
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className={`${isFullscreen ? "max-w-5xl h-[90vh]" : "max-w-3xl"} flex flex-col p-0 gap-0`}>
                {/* Gmail-style Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                    <div className="flex items-center gap-3">
                        <DialogTitle className="text-base font-medium">
                            New Message
                            {leadName && (
                                <span className="text-muted-foreground font-normal ml-2">
                                    to {leadName}
                                </span>
                            )}
                        </DialogTitle>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => setIsFullscreen(!isFullscreen)}
                        >
                            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                
                {/* Email Form */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Recipients */}
                    <div className="border-b">
                        <div className="flex items-center px-4 py-2">
                            <Label className="w-16 text-sm text-muted-foreground">To</Label>
                            <Input
                                type="email"
                                placeholder="recipient@example.com"
                                value={toEmail}
                                onChange={(e) => setToEmail(e.target.value)}
                                className="flex-1 border-0 shadow-none focus-visible:ring-0 px-0"
                            />
                            {!showCc && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="text-muted-foreground"
                                    onClick={() => setShowCc(true)}
                                >
                                    Cc
                                </Button>
                            )}
                        </div>
                        
                        {showCc && (
                            <div className="flex items-center px-4 py-2 border-t">
                                <Label className="w-16 text-sm text-muted-foreground">Cc</Label>
                                <Input
                                    placeholder="cc@example.com, another@example.com"
                                    value={ccEmails}
                                    onChange={(e) => setCcEmails(e.target.value)}
                                    className="flex-1 border-0 shadow-none focus-visible:ring-0 px-0"
                                />
                            </div>
                        )}
                    </div>
                    
                    {/* Subject */}
                    <div className="flex items-center px-4 py-2 border-b">
                        <Label className="w-16 text-sm text-muted-foreground">Subject</Label>
                        <Input
                            placeholder="Subject"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="flex-1 border-0 shadow-none focus-visible:ring-0 px-0"
                        />
                    </div>
                    
                    {/* Template Selection */}
                    <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <Select 
                            value={selectedTemplate || "none"} 
                            onValueChange={handleTemplateSelect}
                        >
                            <SelectTrigger className="w-[250px] h-8 text-sm">
                                <SelectValue placeholder="Use a template..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">
                                    Write from scratch
                                </SelectItem>
                                {templates.map((template) => (
                                    <SelectItem key={template.id} value={template.id}>
                                        {template.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">
                            Templates auto-fill subject and body
                        </span>
                    </div>
                    
                    {/* Rich Text Editor */}
                    <div className="flex-1 overflow-auto">
                        <RichTextEditor
                            content={bodyHtml}
                            onChange={setBodyHtml}
                            placeholder="Compose your email..."
                            minHeight={isFullscreen ? "400px" : "250px"}
                        />
                    </div>
                    
                    {/* Error/Success Messages */}
                    {(error || success) && (
                        <div className="px-4 py-2 border-t">
                            {error && (
                                <div className="bg-destructive/10 text-destructive text-sm p-2 rounded">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="bg-emerald-500/10 text-emerald-600 text-sm p-2 rounded">
                                    {success}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                
                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                    <div className="flex items-center gap-2">
                        <Button 
                            onClick={handleSend} 
                            disabled={isSending || !toEmail || !subject}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {isSending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Send className="h-4 w-4 mr-2" />
                            )}
                            Send
                        </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleClose}>
                        Discard
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
