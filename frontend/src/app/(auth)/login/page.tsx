"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { Mail, Lock, Eye, EyeOff, UserX, Building2, ArrowLeft, ChevronRight } from "lucide-react"

import { useAuthStore } from "@/stores/auth-store"
import { registerFCMToken } from "@/hooks/use-fcm-notifications"
import { AuthService, DealershipOption, dealershipLoginKey } from "@/services/auth-service"

type Step = "email" | "dealership" | "password"

export default function LoginPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const setAuth = useAuthStore((state) => state.setAuth)
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [step, setStep] = React.useState<Step>("email")
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [showPassword, setShowPassword] = React.useState(false)
    const [accountDeactivated, setAccountDeactivated] = React.useState(false)
    const [dealerships, setDealerships] = React.useState<DealershipOption[]>([])
    const [selectedDealership, setSelectedDealership] = React.useState<DealershipOption | null>(null)

    const showDeactivatedScreen = accountDeactivated || searchParams.get("deactivated") === "1"

    const clearDeactivatedAndError = () => {
        setAccountDeactivated(false)
        setError(null)
        setStep("email")
        router.replace("/login", { scroll: false })
    }

    const resetToEmail = () => {
        setStep("email")
        setError(null)
        setPassword("")
        setSelectedDealership(null)
        setDealerships([])
    }

    async function onEmailSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        setIsLoading(true)
        setError(null)

        try {
            const options = await AuthService.lookupDealerships(email)
            if (options.length === 0) {
                setError("No account found for this email.")
                return
            }
            setDealerships(options)
            if (options.length === 1) {
                setSelectedDealership(options[0])
                setStep("password")
            } else {
                setStep("dealership")
            }
        } catch (err: any) {
            console.error("Dealership lookup failed:", err)
            setError(err?.response?.data?.detail || "Could not look up your account. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    function pickDealership(option: DealershipOption) {
        setSelectedDealership(option)
        setStep("password")
        setError(null)
    }

    async function onPasswordSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        if (!selectedDealership) {
            setStep("email")
            return
        }
        setIsLoading(true)
        setError(null)
        setAccountDeactivated(false)

        try {
            const formBody = new URLSearchParams()
            formBody.append('username', email)
            formBody.append('password', password)
            // Empty string when super admin (no dealership UUID)
            formBody.append('dealership_id', dealershipLoginKey(selectedDealership))

            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.tikuncrm.com/api/v1";
            const response = await fetch(`${apiUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formBody
            })

            const errorData = response.ok ? null : await response.json().catch(() => ({}))
            const detail = errorData?.detail

            if (!response.ok) {
                if (response.status === 403 && (detail === "account_deactivated" || detail === "Account deactivated")) {
                    setAccountDeactivated(true)
                    return
                }
                // Edge case: backend returned 409 dealership_required (e.g. someone added a
                // new dealership account between lookup and login). Re-prompt picker.
                if (response.status === 409 && detail?.code === "dealership_required") {
                    setDealerships(detail.dealerships || [])
                    setSelectedDealership(null)
                    setStep("dealership")
                    return
                }
                throw new Error(typeof detail === "string" ? detail : "Login failed")
            }

            const data = await response.json()

            setAuth(data.user, data.access_token, data.refresh_token)

            registerFCMToken().catch(console.error)

            if (data.user?.must_change_password) {
                router.push("/change-password?required=true")
            } else {
                router.push("/dashboard")
            }
        } catch (err: any) {
            console.error("Login failed:", err)
            setError(err.message || "Login failed. Please check your credentials.")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            {/* Left side: Branding / Info */}
            <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
                <div className="absolute inset-0 bg-primary" />
                <div className="relative z-20 flex items-center text-lg font-medium">
                    <Image
                        src="/Gemini_Generated_Image_iauae6iauae6iaua.png"
                        alt="TikunCRM"
                        width={32}
                        height={32}
                        className="mr-2 h-8 w-8 rounded object-contain"
                    />
                    TikunCRM
                </div>
                <div className="relative z-20 mt-auto">
                    <blockquote className="space-y-2">
                        <p className="text-lg">
                            &ldquo;This platform has completely transformed how we manage leads across our 15 regional dealerships. The multi-level hierarchy is a game changer.&rdquo;
                        </p>
                        <footer className="text-sm">Sofia Davis, Regional Manager</footer>
                    </blockquote>
                </div>
            </div>

            {/* Right side */}
            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[380px]">
                    {showDeactivatedScreen ? (
                        <>
                            <div className="flex flex-col space-y-4 text-center">
                                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                                    <UserX className="h-7 w-7 text-amber-600 dark:text-amber-500" />
                                </div>
                                <h1 className="text-2xl font-semibold tracking-tight">Account deactivated</h1>
                                <p className="text-sm text-muted-foreground">
                                    Your account has been deactivated. You cannot sign in at this time.
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Contact your <strong>dealership administrator</strong> or <strong>owner</strong> for further assistance. Only an admin or owner can reactivate your account.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={clearDeactivatedAndError}
                                    className="inline-flex items-center justify-center rounded-md border border-input bg-background py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                                >
                                    Back to sign in
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex flex-col space-y-2 text-center">
                                <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
                                <p className="text-sm text-muted-foreground">
                                    {step === "email" && "Enter your email to continue"}
                                    {step === "dealership" && "Select the dealership to sign in to"}
                                    {step === "password" && "Enter your password to sign in"}
                                </p>
                            </div>

                            <div className="grid gap-6">
                                {error && (
                                    <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                                        {error}
                                    </div>
                                )}

                                {step === "email" && (
                                    <form onSubmit={onEmailSubmit}>
                                        <div className="grid gap-4">
                                            <div className="grid gap-2">
                                                <label className="text-sm font-medium leading-none" htmlFor="email">
                                                    Email Address
                                                </label>
                                                <div className="relative">
                                                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                                    <input
                                                        id="email"
                                                        placeholder="name@dealership.com"
                                                        type="email"
                                                        autoCapitalize="none"
                                                        autoComplete="email"
                                                        autoCorrect="off"
                                                        disabled={isLoading}
                                                        value={email}
                                                        onChange={(e) => setEmail(e.target.value)}
                                                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                        required
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                className="inline-flex items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                                                disabled={isLoading || !email}
                                            >
                                                {isLoading && (
                                                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                                )}
                                                Continue
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {step === "dealership" && (
                                    <div className="grid gap-4">
                                        <button
                                            type="button"
                                            onClick={resetToEmail}
                                            className="inline-flex items-center self-start gap-1 text-sm text-muted-foreground hover:text-foreground"
                                        >
                                            <ArrowLeft className="h-4 w-4" /> Use a different email
                                        </button>
                                        <div className="text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground">{email}</span> is registered with multiple dealerships. Pick one to continue.
                                        </div>
                                        <div className="grid gap-2">
                                            {dealerships.map((d) => (
                                                <button
                                                    key={dealershipLoginKey(d)}
                                                    type="button"
                                                    onClick={() => pickDealership(d)}
                                                    className="group flex items-center justify-between rounded-md border border-input bg-background px-4 py-3 text-left text-sm shadow-sm transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
                                                >
                                                    <span className="flex items-center gap-3">
                                                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                                                            <Building2 className="h-4 w-4 text-muted-foreground" />
                                                        </span>
                                                        <span>
                                                            <span className="block font-medium">{d.name}</span>
                                                            {d.is_super_admin && (
                                                                <span className="block text-xs text-muted-foreground">System administrator</span>
                                                            )}
                                                            {d.is_bdc && (
                                                                <span className="block text-xs text-muted-foreground">BDC agent</span>
                                                            )}
                                                        </span>
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {step === "password" && selectedDealership && (
                                    <form onSubmit={onPasswordSubmit}>
                                        <div className="grid gap-4">
                                            <div className="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        <div className="min-w-0">
                                                            <div className="truncate font-medium">{selectedDealership.name}</div>
                                                            <div className="truncate text-xs text-muted-foreground">{email}</div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={resetToEmail}
                                                        className="text-xs text-primary hover:underline shrink-0"
                                                    >
                                                        Change
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid gap-2">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm font-medium leading-none" htmlFor="password">
                                                        Password
                                                    </label>
                                                    <Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="text-sm text-primary hover:underline font-medium">
                                                        Forgot password?
                                                    </Link>
                                                </div>
                                                <div className="relative">
                                                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                                    <input
                                                        id="password"
                                                        type={showPassword ? "text" : "password"}
                                                        autoComplete="current-password"
                                                        autoFocus
                                                        disabled={isLoading}
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        className="flex h-10 w-full rounded-md border border-input bg-transparent pl-10 pr-10 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                                        required
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowPassword(!showPassword)}
                                                        className="absolute right-3 top-3 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
                                                        tabIndex={-1}
                                                    >
                                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </div>
                                            <button
                                                className="inline-flex items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                                                disabled={isLoading || !password}
                                            >
                                                {isLoading && (
                                                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                                                )}
                                                Sign In
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>

                            <p className="px-8 text-center text-sm text-muted-foreground">
                                By clicking continue, you agree to our{" "}
                                <Link href="/terms" className="underline underline-offset-4 hover:text-primary">
                                    Terms of Service
                                </Link>{" "}
                                and{" "}
                                <Link href="/privacy" className="underline underline-offset-4 hover:text-primary">
                                    Privacy Policy
                                </Link>
                                .
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
