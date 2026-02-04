"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Lock, CheckCircle, AlertTriangle } from "lucide-react"

import { useAuthStore } from "@/stores/auth-store"

export default function ChangePasswordPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const isRequired = searchParams.get("required") === "true"
    
    const { token, logout, updateUser } = useAuthStore()
    
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [success, setSuccess] = React.useState(false)
    const [formData, setFormData] = React.useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
    })

    // Redirect to login if not authenticated
    React.useEffect(() => {
        if (!token) {
            router.push("/login")
        }
    }, [token, router])

    async function onSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        setError(null)

        // Validate passwords match
        if (formData.newPassword !== formData.confirmPassword) {
            setError("New passwords do not match")
            return
        }

        // Validate password length
        if (formData.newPassword.length < 8) {
            setError("New password must be at least 8 characters")
            return
        }

        // Validate new password is different
        if (formData.currentPassword === formData.newPassword) {
            setError("New password must be different from current password")
            return
        }

        setIsLoading(true)

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1"
            const response = await fetch(`${apiUrl}/auth/change-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    current_password: formData.currentPassword,
                    new_password: formData.newPassword
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.detail || "Failed to change password")
            }

            // Update the user store to reflect password changed
            updateUser({ must_change_password: false })
            
            setSuccess(true)
            
            // Redirect to dashboard after short delay
            setTimeout(() => {
                router.push("/dashboard")
            }, 2000)
        } catch (err: any) {
            console.error("Change password failed:", err)
            setError(err.message || "Something went wrong. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    function handleLogout() {
        logout()
        router.push("/login")
    }

    if (success) {
        return (
            <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
                <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
                    <div className="absolute inset-0 bg-primary" />
                    <div className="relative z-20 flex items-center text-lg font-medium">
                        <div className="mr-2 flex h-8 w-8 items-center justify-center rounded bg-white text-primary">
                            <span className="font-bold">L</span>
                        </div>
                        TikunCRM
                    </div>
                </div>

                <div className="lg:p-8">
                    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                        <div className="flex flex-col items-center space-y-4 text-center">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                                <CheckCircle className="h-8 w-8 text-green-600" />
                            </div>
                            <h1 className="text-2xl font-semibold tracking-tight">Password Changed!</h1>
                            <p className="text-sm text-muted-foreground">
                                Your password has been updated successfully. Redirecting to dashboard...
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            {/* Left side: Branding */}
            <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
                <div className="absolute inset-0 bg-primary" />
                <div className="relative z-20 flex items-center text-lg font-medium">
                    <div className="mr-2 flex h-8 w-8 items-center justify-center rounded bg-white text-primary">
                        <span className="font-bold">L</span>
                    </div>
                    TikunCRM
                </div>
                <div className="relative z-20 mt-auto">
                    <blockquote className="space-y-2">
                        <p className="text-lg">
                            &ldquo;Keep your account secure with a strong, unique password.&rdquo;
                        </p>
                    </blockquote>
                </div>
            </div>

            {/* Right side: Form */}
            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                    {isRequired && (
                        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-medium text-amber-800">Password Change Required</p>
                                <p className="text-sm text-amber-700">
                                    You must change your password before continuing.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">Change Password</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your current password and choose a new one.
                        </p>
                    </div>

                    <div className="grid gap-6">
                        {error && (
                            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                                {error}
                            </div>
                        )}
                        <form onSubmit={onSubmit}>
                            <div className="grid gap-4">
                                <div className="grid gap-2">
                                    <label className="text-sm font-medium leading-none" htmlFor="currentPassword">
                                        Current Password
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="currentPassword"
                                            type="password"
                                            disabled={isLoading}
                                            value={formData.currentPassword}
                                            onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <label className="text-sm font-medium leading-none" htmlFor="newPassword">
                                        New Password
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="newPassword"
                                            type="password"
                                            placeholder="At least 8 characters"
                                            disabled={isLoading}
                                            value={formData.newPassword}
                                            onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            required
                                            minLength={8}
                                        />
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <label className="text-sm font-medium leading-none" htmlFor="confirmPassword">
                                        Confirm New Password
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="confirmPassword"
                                            type="password"
                                            placeholder="Repeat new password"
                                            disabled={isLoading}
                                            value={formData.confirmPassword}
                                            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            required
                                            minLength={8}
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    className="inline-flex items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                                    disabled={isLoading}
                                >
                                    {isLoading && (
                                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                    )}
                                    Change Password
                                </button>
                            </div>
                        </form>
                    </div>

                    {!isRequired && (
                        <button
                            onClick={handleLogout}
                            className="inline-flex items-center justify-center text-sm text-muted-foreground hover:text-primary"
                        >
                            Cancel and Logout
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
