"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    ArrowLeft,
    Mail,
    CheckCircle2,
    XCircle,
    Loader2,
    Send,
    Eye,
    EyeOff,
    AlertTriangle,
    Info,
    Shield,
    Inbox,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import {
    UserEmailService,
    UserEmailConfig,
} from "@/services/user-email-service"
import { useAuthStore } from "@/stores/auth-store"

export default function UserEmailConfigPage() {
    const router = useRouter()
    const { updateUser } = useAuthStore()
    
    // State
    const [isLoading, setIsLoading] = React.useState(true)
    const [isSaving, setIsSaving] = React.useState(false)
    const [isTesting, setIsTesting] = React.useState(false)
    const [isDeleting, setIsDeleting] = React.useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
    const [showTestDialog, setShowTestDialog] = React.useState(false)
    const [showPasswordDialog, setShowPasswordDialog] = React.useState(false)
    
    const [existingConfig, setExistingConfig] = React.useState<UserEmailConfig | null>(null)
    const [testEmail, setTestEmail] = React.useState("")
    const [testResult, setTestResult] = React.useState<any>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
    
    // Password view state
    const [accountPassword, setAccountPassword] = React.useState("")
    const [viewedPassword, setViewedPassword] = React.useState<string | null>(null)
    const [passwordError, setPasswordError] = React.useState<string | null>(null)
    const [isViewingPassword, setIsViewingPassword] = React.useState(false)
    
    // Form data - simplified
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [showPassword, setShowPassword] = React.useState(false)
    
    // Load existing config
    React.useEffect(() => {
        const loadConfig = async () => {
            setIsLoading(true)
            try {
                const config = await UserEmailService.getConfig()
                setExistingConfig(config)
                setEmail(config.email || "")
            } catch (err: any) {
                if (err?.response?.status !== 404) {
                    console.error("Failed to load email config:", err)
                }
            } finally {
                setIsLoading(false)
            }
        }
        
        loadConfig()
    }, [])
    
    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setSuccessMessage(null)
        setIsSaving(true)
        
        try {
            if (!email) {
                throw new Error("Email address is required")
            }
            if (!password && !existingConfig?.has_password) {
                throw new Error("Password is required")
            }
            
            const config = await UserEmailService.saveConfig({
                email,
                password: password || "UNCHANGED",
            })
            
            setExistingConfig(config)
            setSuccessMessage("Email configuration saved! Testing configuration...")
            setPassword("")
            
            // Auto-open test dialog after saving
            if (config.has_password) {
                setTestEmail(email)
                setShowTestDialog(true)
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || "Failed to save configuration")
        } finally {
            setIsSaving(false)
        }
    }
    
    // Handle test
    const handleTest = async () => {
        if (!testEmail) return
        
        setTestResult(null)
        setIsTesting(true)
        
        try {
            const result = await UserEmailService.testConfig(testEmail)
            setTestResult(result)
            
            if (result.success) {
                setExistingConfig(prev => prev ? { ...prev, email_config_verified: true } : null)
                // Update user in auth store
                updateUser({ email_config_verified: true })
            }
        } catch (err: any) {
            setTestResult({
                success: false,
                message: "Test failed",
                details: {
                    sending: { success: false, message: err.message || "Unknown error" },
                    receiving: { success: false, message: "Not tested" }
                }
            })
        } finally {
            setIsTesting(false)
        }
    }
    
    // Handle view password
    const handleViewPassword = async () => {
        setPasswordError(null)
        setIsViewingPassword(true)
        
        try {
            const result = await UserEmailService.viewPassword(accountPassword)
            setViewedPassword(result.password)
        } catch (err: any) {
            if (err?.response?.status === 401) {
                setPasswordError("Invalid account password")
            } else {
                setPasswordError(err.message || "Failed to retrieve password")
            }
        } finally {
            setIsViewingPassword(false)
        }
    }
    
    // Handle delete
    const handleDelete = async () => {
        setIsDeleting(true)
        try {
            await UserEmailService.deleteConfig()
            setExistingConfig(null)
            setEmail("")
            setPassword("")
            setSuccessMessage("Email configuration deleted")
        } catch (err: any) {
            setError(err.message || "Failed to delete configuration")
        } finally {
            setIsDeleting(false)
            setShowDeleteDialog(false)
        }
    }
    
    // Reset password dialog
    const resetPasswordDialog = () => {
        setShowPasswordDialog(false)
        setAccountPassword("")
        setViewedPassword(null)
        setPasswordError(null)
    }
    
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }
    
    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push("/settings")}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold">Email Configuration</h1>
                        <p className="text-muted-foreground">
                            Connect your Hostinger email to send and receive emails
                        </p>
                    </div>
                </div>
                {existingConfig?.email_config_verified ? (
                    <Badge className="bg-green-100 text-green-800">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Verified
                    </Badge>
                ) : existingConfig?.has_password ? (
                    <Badge variant="secondary">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Not Tested
                    </Badge>
                ) : null}
            </div>
            
            {/* Info Card */}
            <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="pt-6">
                    <div className="flex gap-3">
                        <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-900">
                            <p className="font-medium mb-2">How it works:</p>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex items-start gap-2">
                                    <Send className="h-4 w-4 mt-0.5 text-blue-600" />
                                    <div>
                                        <p className="font-medium">Sending</p>
                                        <p className="text-blue-700 text-xs">Emails sent from your address</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Inbox className="h-4 w-4 mt-0.5 text-blue-600" />
                                    <div>
                                        <p className="font-medium">Receiving</p>
                                        <p className="text-blue-700 text-xs">Replies appear in Communications</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Messages */}
            {error && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="py-3 flex items-center gap-2 text-red-800">
                        <XCircle className="h-4 w-4" />
                        {error}
                    </CardContent>
                </Card>
            )}
            
            {successMessage && (
                <Card className="border-green-200 bg-green-50">
                    <CardContent className="py-3 flex items-center gap-2 text-green-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {successMessage}
                    </CardContent>
                </Card>
            )}
            
            {/* Main Form */}
            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5" />
                            Hostinger Email Credentials
                        </CardTitle>
                        <CardDescription>
                            Enter your Hostinger email and password. The same credentials are used for sending and receiving.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Email Address */}
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address *</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="your.name@yourdomain.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        
                        {/* Password */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">
                                    Password {existingConfig?.has_password ? "(leave blank to keep current)" : "*"}
                                </Label>
                                {existingConfig?.has_password && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowPasswordDialog(true)}
                                    >
                                        <Eye className="h-4 w-4 mr-1" />
                                        View Saved
                                    </Button>
                                )}
                            </div>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder={existingConfig?.has_password ? "••••••••" : "Enter your email password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required={!existingConfig?.has_password}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Your Hostinger email password (securely encrypted)
                            </p>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center justify-between pt-4 border-t">
                            <div className="flex gap-2">
                                <Button type="submit" disabled={isSaving}>
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        "Save"
                                    )}
                                </Button>
                                
                                {existingConfig?.has_password && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            setTestEmail(email)
                                            setShowTestDialog(true)
                                        }}
                                    >
                                        <Send className="h-4 w-4 mr-2" />
                                        Test Configuration
                                    </Button>
                                )}
                            </div>
                            
                            {existingConfig?.has_password && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setShowDeleteDialog(true)}
                                >
                                    Delete
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </form>
            
            {/* Security Info */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex gap-3">
                        <Shield className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="text-sm text-muted-foreground">
                            <p><strong>Security:</strong> Your password is encrypted with AES-256 before storage. To view it, you must verify your CRM account password.</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {/* Test Dialog */}
            <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Test Email Configuration</DialogTitle>
                        <DialogDescription>
                            This will test both sending and receiving capabilities.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="test_email">Send test email to:</Label>
                            <Input
                                id="test_email"
                                type="email"
                                placeholder="test@example.com"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                            />
                        </div>
                        
                        {testResult && (
                            <div className="space-y-2">
                                <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-50' : 'bg-amber-50'}`}>
                                    <div className="flex items-center gap-2 font-medium">
                                        {testResult.success ? (
                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        ) : (
                                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                                        )}
                                        <span className={testResult.success ? 'text-green-800' : 'text-amber-800'}>
                                            {testResult.message}
                                        </span>
                                    </div>
                                </div>
                                
                                {testResult.details && (
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className={`p-2 rounded ${testResult.details.sending.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                            <div className="flex items-center gap-1 font-medium">
                                                <Send className="h-3 w-3" />
                                                Sending
                                            </div>
                                            <p className="text-xs mt-1">{testResult.details.sending.message}</p>
                                        </div>
                                        <div className={`p-2 rounded ${testResult.details.receiving.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                            <div className="flex items-center gap-1 font-medium">
                                                <Inbox className="h-3 w-3" />
                                                Receiving
                                            </div>
                                            <p className="text-xs mt-1">{testResult.details.receiving.message}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTestDialog(false)}>
                            Close
                        </Button>
                        <Button onClick={handleTest} disabled={!testEmail || isTesting}>
                            {isTesting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Testing...
                                </>
                            ) : (
                                "Run Test"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {/* View Password Dialog */}
            <Dialog open={showPasswordDialog} onOpenChange={resetPasswordDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>View Saved Password</DialogTitle>
                        <DialogDescription>
                            Enter your CRM account password to verify your identity.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {!viewedPassword ? (
                            <div className="space-y-2">
                                <Label htmlFor="account_password">CRM Account Password:</Label>
                                <Input
                                    id="account_password"
                                    type="password"
                                    placeholder="Enter your CRM password"
                                    value={accountPassword}
                                    onChange={(e) => setAccountPassword(e.target.value)}
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label>Your Email Password:</Label>
                                <div className="p-3 bg-muted rounded-lg font-mono text-sm break-all">
                                    {viewedPassword}
                                </div>
                            </div>
                        )}
                        
                        {passwordError && (
                            <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">
                                {passwordError}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={resetPasswordDialog}>
                            Close
                        </Button>
                        {!viewedPassword && (
                            <Button onClick={handleViewPassword} disabled={!accountPassword || isViewingPassword}>
                                {isViewingPassword ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Eye className="h-4 w-4 mr-2" />
                                )}
                                View Password
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            
            {/* Delete Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Email Configuration?</AlertDialogTitle>
                        <AlertDialogDescription>
                            You won't be able to send or receive emails until you configure it again.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={isDeleting}
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
