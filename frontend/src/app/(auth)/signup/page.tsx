"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Mail, Lock, User, Building2, Eye, EyeOff } from "lucide-react"

import { useAuthStore } from "@/stores/auth-store"

export default function SignupPage() {
    const router = useRouter()
    const setAuth = useAuthStore((state) => state.setAuth)
    const [isLoading, setIsLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [formData, setFormData] = React.useState({
        first_name: "",
        last_name: "",
        email: "",
        password: "",
        dealership_name: ""
    })
    const [showPassword, setShowPassword] = React.useState(false)

    async function onSubmit(event: React.SyntheticEvent) {
        event.preventDefault()
        setIsLoading(true)
        setError(null)

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";
            const response = await fetch(`${apiUrl}/auth/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.detail || "Signup failed")
            }

            const data = await response.json()

            // Store auth in Zustand store (includes token + refresh token + user)
            setAuth(data.user, data.access_token, data.refresh_token)

            // Redirect to dashboard
            router.push("/dashboard")
        } catch (err: any) {
            console.error("Signup failed:", err)
            setError(err.message || "Signup failed. Please try again.")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex">
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
                            &ldquo;Join the next generation of dealership lead management. Streamline your sales process from day one.&rdquo;
                        </p>
                    </blockquote>
                </div>
            </div>

            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[400px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your details to register your dealership
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
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium" htmlFor="first_name">First Name</label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                            <input
                                                id="first_name"
                                                placeholder="John"
                                                className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                                                value={formData.first_name}
                                                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium" htmlFor="last_name">Last Name</label>
                                        <input
                                            id="last_name"
                                            placeholder="Doe"
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                                            value={formData.last_name}
                                            onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-sm font-medium" htmlFor="dealership">Dealership Name</label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="dealership"
                                            placeholder="Prestige Motors"
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                                            value={formData.dealership_name}
                                            onChange={(e) => setFormData({ ...formData, dealership_name: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-sm font-medium" htmlFor="email">Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="email"
                                            type="email"
                                            placeholder="john@dealership.com"
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-10 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-sm font-medium" htmlFor="password">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            className="flex h-10 w-full rounded-md border border-input bg-transparent pl-10 pr-10 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                                    className="inline-flex items-center justify-center rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground shadow shadow-primary/20 hover:bg-primary/90 transition-all font-bold uppercase tracking-widest mt-2"
                                    disabled={isLoading}
                                >
                                    {isLoading ? "Creating..." : "Create Account"}
                                </button>
                            </div>
                        </form>
                    </div>

                    <p className="px-8 text-center text-sm text-muted-foreground">
                        Already have an account?{" "}
                        <Link href="/login" className="underline underline-offset-4 hover:text-primary font-bold">
                            Sign In
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
