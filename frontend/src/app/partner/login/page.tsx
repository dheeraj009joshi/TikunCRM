"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PartnerPortalService } from "@/services/partner-portal-service"

export default function PartnerLoginPage() {
    const router = useRouter()
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [error, setError] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(false)

    async function onSubmit(event: React.FormEvent) {
        event.preventDefault()
        setLoading(true)
        setError(null)
        try {
            await PartnerPortalService.login(email, password)
            router.replace("/partner")
        } catch {
            setError("Incorrect email or password.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6">
                <div>
                    <h1 className="text-xl font-semibold">Partner login</h1>
                    <p className="text-sm text-muted-foreground">Leads and appointments for your store.</p>
                </div>
                <label className="block space-y-1 text-sm">
                    <span>Email</span>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                </label>
                <label className="block space-y-1 text-sm">
                    <span>Password</span>
                    <input
                        type="password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                </label>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                    {loading ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </div>
    )
}
