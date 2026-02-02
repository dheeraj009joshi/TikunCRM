"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuthStore } from "@/stores/auth-store"

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password"]

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const { isAuthenticated, token, user, setLoading } = useAuthStore()
    const [isChecking, setIsChecking] = React.useState(true)

    React.useEffect(() => {
        const checkAuth = async () => {
            setIsChecking(true)
            
            // Check if we have a token stored
            const storedToken = localStorage.getItem('auth_token')
            const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path))
            
            if (!storedToken && !isPublicPath) {
                // No token and trying to access protected route
                router.replace("/login")
                setIsChecking(false)
                return
            }

            if (storedToken && isPublicPath && isAuthenticated && user) {
                // Already authenticated, redirect to dashboard
                router.replace("/dashboard")
                setIsChecking(false)
                return
            }

            // If we have a token but no user in store, try to fetch user
            if (storedToken && !user) {
                try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";
                    const response = await fetch(`${apiUrl}/auth/me`, {
                        headers: {
                            "Authorization": `Bearer ${storedToken}`
                        }
                    })

                    if (response.ok) {
                        const userData = await response.json()
                        useAuthStore.getState().setAuth(userData, storedToken)
                    } else {
                        // Token invalid, try to refresh if we have refresh token
                        const refreshToken = localStorage.getItem('refresh_token')
                        if (refreshToken) {
                            try {
                                const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://leedsapi.tikuntech.com/api/v1";
                                const refreshResponse = await fetch(`${apiUrl}/auth/refresh`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ refresh_token: refreshToken })
                                })
                                
                                if (refreshResponse.ok) {
                                    const refreshData = await refreshResponse.json()
                                    localStorage.setItem('auth_token', refreshData.access_token)
                                    if (refreshData.refresh_token) {
                                        localStorage.setItem('refresh_token', refreshData.refresh_token)
                                    }
                                    useAuthStore.getState().setAuth(refreshData.user, refreshData.access_token, refreshData.refresh_token)
                                    setIsChecking(false)
                                    return
                                }
                            } catch (refreshError) {
                                console.error("Token refresh failed:", refreshError)
                            }
                        }
                        
                        // Refresh failed or no refresh token, clear and redirect
                        localStorage.removeItem('auth_token')
                        localStorage.removeItem('refresh_token')
                        useAuthStore.getState().logout()
                        if (!isPublicPath) {
                            router.replace("/login")
                        }
                    }
                } catch (error) {
                    console.error("Auth check failed:", error)
                    if (!isPublicPath) {
                        router.replace("/login")
                    }
                }
            }

            setIsChecking(false)
        }

        checkAuth()
    }, [pathname])

    // Show loading while checking auth
    if (isChecking) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    return <>{children}</>
}
