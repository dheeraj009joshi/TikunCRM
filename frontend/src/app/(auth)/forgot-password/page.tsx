"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { Mail, ArrowLeft, CheckCircle } from "lucide-react"

import { AuthService } from "@/services/auth-service"

export default function ForgotPasswordPage() {
    const searchParams = useSearchParams()
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [success, setSuccess] = React.useState(false)
    const [email, setEmail] = React.useState(searchParams.get("email") ?? "")
    async function onEmailSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        setError(null)
        setIsLoading(true)
        try {
            const options = await AuthService.lookupDealerships(email)
            if (options.length === 0) {
                setSuccess(true)
                return
            }
            await AuthService.forgotPassword(email, options[0])
            setSuccess(true)
        } catch (err: any) {
            const detail = err?.response?.data?.detail
            console.error("Forgot password failed:", err)
            setError(typeof detail === "string" ? detail : "Something went wrong. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    if (success) {
        return (
            <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
                {/* Left side: Branding */}
                <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
                    <div className="absolute inset-0 bg-primary" />
                    <div className="relative z-20 flex items-center text-lg font-medium">
                        <Image
                            src="/brand/app-icon.png"
                            alt="TikunCRM"
                            width={32}
                            height={32}
                            className="mr-2 h-8 w-8 rounded object-contain"
                        />
                        TikunCRM
                    </div>
                </div>

                {/* Right side: Success Message */}
                <div className="lg:p-8">
                    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                        <div className="flex flex-col items-center space-y-4 text-center">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                                <CheckCircle className="h-8 w-8 text-green-600" />
                            </div>
                            <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
                            <p className="text-sm text-muted-foreground">
                                If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link.
                            </p>
                            <p className="text-sm text-muted-foreground">
                                The link will expire in 24 hours.
                            </p>
                        </div>

                        <Link
                            href="/login"
                            className="inline-flex items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Login
                        </Link>

                        <p className="text-center text-sm text-muted-foreground">
                            Didn&apos;t receive the email?{" "}
                            <button
                                onClick={() => { setSuccess(false); setError(null) }}
                                className="text-primary hover:underline font-medium"
                            >
                                Try again
                            </button>
                        </p>
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
                    <Image
                        src="/brand/app-icon.png"
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
                            &ldquo;Secure password management is essential for protecting your Carvaminos data and customer information.&rdquo;
                        </p>
                    </blockquote>
                </div>
            </div>

            {/* Right side: Form */}
            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[380px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your email address and we&apos;ll send you a link to reset your password.
                        </p>
                    </div>

                    <div className="grid gap-6">
                        {error && (
                            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                                {error}
                            </div>
                        )}

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
                                            placeholder="name@carvaminos.com"
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
                                    Send Reset Link
                                </button>
                            </div>
                        </form>

                    </div>

                    <Link
                        href="/login"
                        className="inline-flex items-center justify-center text-sm text-muted-foreground hover:text-primary"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Login
                    </Link>
                </div>
            </div>
        </div>
    )
}
