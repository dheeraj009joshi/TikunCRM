"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft,
    Server,
    Mail,
    Lock,
    CheckCircle2,
    XCircle,
    Loader2,
    Send,
    AlertTriangle,
    Info,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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

import {
    DealershipEmailService,
    DealershipEmailConfig,
    DealershipEmailConfigCreate,
    SMTP_PRESETS,
    SmtpPresetKey,
} from "@/services/dealership-email-service"
import { useRole } from "@/hooks/use-role"

export default function DealershipEmailConfigPage() {
    const router = useRouter()
    const { isDealershipAdmin, isDealershipOwner, isSuperAdmin } = useRole()
    
    // State
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)
    const [isTesting, setIsTesting] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
    const [showTestDialog, setShowTestDialog] = React.useState(false)
    
    const [existingConfig, setExistingConfig] = React.useState<DealershipEmailConfig | null>(null)
    const [testEmail, setTestEmail] = React.useState("")
    const [testResult, setTestResult] = React.useState<{ success: boolean; message: string; details?: string | null } | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
    
    // Form data
    const [formData, setFormData] = React.useState<DealershipEmailConfigCreate>({
        smtp_host: "",
        smtp_port: 465,
        smtp_username: "",
        smtp_password: "",
        smtp_use_ssl: true,
        smtp_use_tls: false,
        imap_host: "",
        imap_port: 993,
        imap_username: "",
        imap_password: "",
        imap_use_ssl: true,
        from_name: "",
    })
    
    // Load existing config
    React.useEffect(() => {
        const loadConfig = async () => {
            setIsLoading(true)
            try {
                const config = await DealershipEmailService.getConfig()
                setExistingConfig(config)
                setFormData({
                    smtp_host: config.smtp_host,
                    smtp_port: config.smtp_port,
                    smtp_username: config.smtp_username,
                    smtp_password: "", // Don't populate password
                    smtp_use_ssl: config.smtp_use_ssl,
                    smtp_use_tls: config.smtp_use_tls,
                    imap_host: config.imap_host || "",
                    imap_port: config.imap_port,
                    imap_username: config.imap_username || "",
                    imap_password: "", // Don't populate password
                    imap_use_ssl: config.imap_use_ssl,
                    from_name: config.from_name || "",
                })
            } catch (err: any) {
                // 404 means no config exists yet - that's okay
                if (err.response?.status !== 404) {
                    console.error("Failed to load config:", err)
                }
            } finally {
                setIsLoading(false)
            }
        }
        
        loadConfig()
    }, [])
    
    // Handle preset selection
    const handlePresetSelect = (presetKey: string) => {
        if (presetKey === "custom") return
        
        const preset = SMTP_PRESETS[presetKey as SmtpPresetKey]
        setFormData(prev => ({
            ...prev,
            smtp_host: preset.smtp_host,
            smtp_port: preset.smtp_port,
            smtp_use_ssl: preset.smtp_use_ssl,
            smtp_use_tls: preset.smtp_use_tls,
            imap_host: preset.imap_host,
            imap_port: preset.imap_port,
            imap_use_ssl: preset.imap_use_ssl,
        }))
    }
    
    // Handle form input changes
    const handleInputChange = (field: keyof DealershipEmailConfigCreate, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        setError(null)
        setSuccessMessage(null)
    }
    
    // Save configuration
    const handleSave = async () => {
        setError(null)
        setSuccessMessage(null)
        
        // Validation
        if (!formData.smtp_host || !formData.smtp_username) {
            setError("SMTP Host and Username are required")
            return
        }
        
        if (!existingConfig && !formData.smtp_password) {
            setError("SMTP Password is required for new configuration")
            return
        }
        
        setIsSaving(true)
        try {
            // If password is empty and we have existing config, don't send it
            const dataToSend = { ...formData }
            if (existingConfig && !dataToSend.smtp_password) {
                delete (dataToSend as any).smtp_password
            }
            if (existingConfig && !dataToSend.imap_password) {
                delete (dataToSend as any).imap_password
            }
            
            // Use same password for IMAP if not specified
            if (dataToSend.smtp_password && !dataToSend.imap_password) {
                dataToSend.imap_password = dataToSend.smtp_password
            }
            // Use same username for IMAP if not specified
            if (!dataToSend.imap_username) {
                dataToSend.imap_username = dataToSend.smtp_username
            }
            
            const config = await DealershipEmailService.saveConfig(dataToSend as DealershipEmailConfigCreate)
            setExistingConfig(config)
            setSuccessMessage("Email configuration saved successfully!")
            
            // Clear password fields after save
            setFormData(prev => ({
                ...prev,
                smtp_password: "",
                imap_password: "",
            }))
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to save configuration")
        } finally {
            setIsSaving(false)
        }
    }
    
    // Test configuration
    const handleTest = async () => {
        if (!testEmail) {
            setTestResult({ success: false, message: "Please enter a test email address" })
            return
        }
        
        setIsTesting(true)
        setTestResult(null)
        try {
            const result = await DealershipEmailService.testConfig(testEmail)
            setTestResult(result)
            
            if (result.success) {
                // Refresh config to get updated verification status
                const config = await DealershipEmailService.getConfig()
                setExistingConfig(config)
            }
        } catch (err: any) {
            setTestResult({
                success: false,
                message: err.response?.data?.detail || "Test failed",
            })
        } finally {
            setIsTesting(false)
        }
    }
    
    // Delete configuration
    const handleDelete = async () => {
        setIsDeleting(true)
        try {
            await DealershipEmailService.deleteConfig()
            setExistingConfig(null)
            setFormData({
                smtp_host: "",
                smtp_port: 465,
                smtp_username: "",
                smtp_password: "",
                smtp_use_ssl: true,
                smtp_use_tls: false,
                imap_host: "",
                imap_port: 993,
                imap_username: "",
                imap_password: "",
                imap_use_ssl: true,
                from_name: "",
            })
            setShowDeleteDialog(false)
            setSuccessMessage("Email configuration deleted")
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to delete configuration")
        } finally {
            setIsDeleting(false)
        }
    }
    
    // Check if user has access
    if (!isDealershipAdmin && !isDealershipOwner && !isSuperAdmin) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Card className="max-w-md">
                    <CardContent className="pt-6 text-center">
                        <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
                        <h2 className="text-lg font-semibold mb-2">Access Denied</h2>
                        <p className="text-muted-foreground">
                            Only Dealership Admins can configure email settings.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }
    
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }
    
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push("/settings")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">Email Configuration</h1>
                    <p className="text-muted-foreground">
                        Configure Hostinger SMTP and IMAP settings for your dealership
                    </p>
                </div>
                {existingConfig && (
                    <Badge variant={existingConfig.is_verified ? "default" : "secondary"}>
                        {existingConfig.is_verified ? (
                            <>
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Verified
                            </>
                        ) : (
                            <>
                                <XCircle className="mr-1 h-3 w-3" />
                                Not Verified
                            </>
                        )}
                    </Badge>
                )}
            </div>
            
            {/* Status messages */}
            {error && (
                <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-4 flex items-center gap-2">
                    <XCircle className="h-5 w-5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            
            {successMessage && (
                <div className="bg-green-500/10 text-green-600 border border-green-500/20 rounded-lg p-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                    <span>{successMessage}</span>
                </div>
            )}
            
            {/* Info banner */}
            <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="pt-4 pb-4">
                    <div className="flex gap-3">
                        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-700">
                            <p className="font-medium mb-1">How it works:</p>
                            <ul className="list-disc list-inside space-y-1 text-blue-600">
                                <li>Configure your Hostinger email settings once for your dealership</li>
                                <li>Each user sets their own email in their profile (e.g., john@yourdealership.com)</li>
                                <li>Emails are sent via your SMTP server with the user&apos;s email in Reply-To</li>
                                <li>Replies are automatically fetched via IMAP and routed to the correct salesperson</li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Provider preset */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        Email Provider
                    </CardTitle>
                    <CardDescription>
                        Select your email provider for quick setup, or choose Custom for manual configuration
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Select onValueChange={handlePresetSelect} defaultValue="hostinger">
                        <SelectTrigger className="w-full md:w-[300px]">
                            <SelectValue placeholder="Select a provider..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="custom">Custom / Manual</SelectItem>
                            {Object.entries(SMTP_PRESETS).map(([key, preset]) => (
                                <SelectItem key={key} value={key}>
                                    {preset.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>
            
            {/* SMTP Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5" />
                        SMTP Settings (Sending)
                    </CardTitle>
                    <CardDescription>
                        Configure how emails are sent from your dealership
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="smtp_host">SMTP Host *</Label>
                            <Input
                                id="smtp_host"
                                placeholder="smtp.hostinger.com"
                                value={formData.smtp_host}
                                onChange={(e) => handleInputChange("smtp_host", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_port">SMTP Port *</Label>
                            <Input
                                id="smtp_port"
                                type="number"
                                placeholder="465"
                                value={formData.smtp_port}
                                onChange={(e) => handleInputChange("smtp_port", parseInt(e.target.value) || 465)}
                            />
                        </div>
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="smtp_username">Email Address *</Label>
                            <Input
                                id="smtp_username"
                                placeholder="info@yourdealership.com"
                                value={formData.smtp_username}
                                onChange={(e) => handleInputChange("smtp_username", e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                This will be the &quot;From&quot; address for all emails
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_password">
                                Password {existingConfig ? "(leave blank to keep current)" : "*"}
                            </Label>
                            <Input
                                id="smtp_password"
                                type="password"
                                placeholder={existingConfig ? "••••••••" : "Enter password"}
                                value={formData.smtp_password}
                                onChange={(e) => handleInputChange("smtp_password", e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-6">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="smtp_use_ssl"
                                checked={formData.smtp_use_ssl}
                                onCheckedChange={(checked) => {
                                    handleInputChange("smtp_use_ssl", checked)
                                    if (checked) handleInputChange("smtp_use_tls", false)
                                }}
                            />
                            <Label htmlFor="smtp_use_ssl" className="text-sm">
                                Use SSL (Port 465) - Recommended for Hostinger
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="smtp_use_tls"
                                checked={formData.smtp_use_tls}
                                onCheckedChange={(checked) => {
                                    handleInputChange("smtp_use_tls", checked)
                                    if (checked) handleInputChange("smtp_use_ssl", false)
                                }}
                            />
                            <Label htmlFor="smtp_use_tls" className="text-sm">
                                Use STARTTLS (Port 587)
                            </Label>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label htmlFor="from_name">Display Name (Optional)</Label>
                        <Input
                            id="from_name"
                            placeholder="Your Dealership Name"
                            value={formData.from_name || ""}
                            onChange={(e) => handleInputChange("from_name", e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground">
                            This name will appear as the sender name in emails (e.g., &quot;ABC Motors&quot;)
                        </p>
                    </div>
                </CardContent>
            </Card>
            
            {/* IMAP Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Lock className="h-5 w-5" />
                        IMAP Settings (Receiving Replies)
                    </CardTitle>
                    <CardDescription>
                        Configure IMAP to automatically fetch incoming replies and route them to the correct salesperson
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="imap_host">IMAP Host</Label>
                            <Input
                                id="imap_host"
                                placeholder="imap.hostinger.com"
                                value={formData.imap_host || ""}
                                onChange={(e) => handleInputChange("imap_host", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imap_port">IMAP Port</Label>
                            <Input
                                id="imap_port"
                                type="number"
                                placeholder="993"
                                value={formData.imap_port}
                                onChange={(e) => handleInputChange("imap_port", parseInt(e.target.value) || 993)}
                            />
                        </div>
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="imap_username">
                                IMAP Username
                                <span className="text-muted-foreground ml-1">(defaults to SMTP email)</span>
                            </Label>
                            <Input
                                id="imap_username"
                                placeholder="Same as SMTP email"
                                value={formData.imap_username || ""}
                                onChange={(e) => handleInputChange("imap_username", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="imap_password">
                                IMAP Password
                                <span className="text-muted-foreground ml-1">(defaults to SMTP password)</span>
                            </Label>
                            <Input
                                id="imap_password"
                                type="password"
                                placeholder="Same as SMTP password"
                                value={formData.imap_password || ""}
                                onChange={(e) => handleInputChange("imap_password", e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="imap_use_ssl"
                            checked={formData.imap_use_ssl}
                            onCheckedChange={(checked) => handleInputChange("imap_use_ssl", checked)}
                        />
                        <Label htmlFor="imap_use_ssl" className="text-sm">
                            Use SSL for IMAP (Port 993) - Recommended
                        </Label>
                    </div>
                    
                    <div className="bg-muted/50 rounded-lg p-4">
                        <p className="text-sm text-muted-foreground">
                            <strong>Note:</strong> The CRM checks for new emails every 2 minutes. 
                            When a lead replies, the email is automatically matched to the original 
                            sender and appears in their inbox.
                        </p>
                    </div>
                </CardContent>
            </Card>
            
            {/* Actions */}
            <div className="flex flex-wrap gap-3 justify-between">
                <div className="flex gap-3">
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {existingConfig ? "Update Configuration" : "Save Configuration"}
                    </Button>
                    
                    {existingConfig && (
                        <Button
                            variant="outline"
                            onClick={() => setShowTestDialog(true)}
                            disabled={!existingConfig}
                        >
                            <Send className="mr-2 h-4 w-4" />
                            Send Test Email
                        </Button>
                    )}
                </div>
                
                {existingConfig && (
                    <Button
                        variant="destructive"
                        onClick={() => setShowDeleteDialog(true)}
                    >
                        Delete Configuration
                    </Button>
                )}
            </div>
            
            {/* Test Email Dialog */}
            <AlertDialog open={showTestDialog} onOpenChange={setShowTestDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Send Test Email</AlertDialogTitle>
                        <AlertDialogDescription>
                            Enter an email address to receive a test email. This will verify your SMTP configuration is working correctly.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="test_email">Email Address</Label>
                            <Input
                                id="test_email"
                                type="email"
                                placeholder="your@email.com"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                            />
                        </div>
                        
                        {testResult && (
                            <div className={`p-4 rounded-lg ${testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                <div className="flex items-center gap-2 font-medium">
                                    {testResult.success ? (
                                        <CheckCircle2 className="h-5 w-5" />
                                    ) : (
                                        <XCircle className="h-5 w-5" />
                                    )}
                                    {testResult.message}
                                </div>
                                {testResult.details && (
                                    <p className="mt-1 text-sm opacity-80">{testResult.details}</p>
                                )}
                            </div>
                        )}
                    </div>
                    
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setTestResult(null)}>Close</AlertDialogCancel>
                        <Button onClick={handleTest} disabled={isTesting || !testEmail}>
                            {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Send Test
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Email Configuration?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the email configuration for your dealership. Users will no longer be able to send emails until a new configuration is set up.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isDeleting}
                        >
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
