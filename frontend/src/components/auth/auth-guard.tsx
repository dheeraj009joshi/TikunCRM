"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuthStore } from "@/stores/auth-store"
import { Loader2 } from "lucide-react"

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"]
const CHANGE_PASSWORD_PATH = "/change-password"

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, user, setAuth, logout, setLoading } = useAuthStore()
    const router = useRouter()
    const pathname = usePathname()
    const [isInitialized, setIsInitialized] = React.useState(false)

    const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path))
    const isChangePasswordPath = pathname.startsWith(CHANGE_PASSWORD_PATH)

    React.useEffect(() => {
        const initAuth = async () => {
            // Check for stored token
            const storedToken = localStorage.getItem('auth_token')
            
            if (!storedToken) {
                // No token - if on protected route, redirect to login
                if (!isPublicPath) {
                    router.replace('/login')
                }
                setIsInitialized(true)
                return
            }

            // We have a token - check if user is already loaded from persisted store
            if (isAuthenticated && user) {
                // Check if user must change password
                if (user.must_change_password && !isChangePasswordPath) {
                    router.replace('/change-password?required=true')
                    setIsInitialized(true)
                    return
                }
                
                // Already authenticated from Zustand persist
                if (isPublicPath) {
                    router.replace('/dashboard')
                }
                setIsInitialized(true)
                return
            }

            // Token exists but no user - need to fetch user data
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.tikuncrm.com/api/v1";
                const response = await fetch(`${apiUrl}/auth/me`, {
                    headers: {
                        "Authorization": `Bearer ${storedToken}`
                    }
                })

                if (response.ok) {
                    const userData = await response.json()
                    setAuth(userData, storedToken)
                    
                    // Check if user must change password
                    if (userData.must_change_password && !isChangePasswordPath) {
                        router.replace('/change-password?required=true')
                        setIsInitialized(true)
                        return
                    }
                    
                    if (isPublicPath) {
                        router.replace('/dashboard')
                    }
                } else {
                    // Token invalid, try to refresh if we have refresh token
                    const refreshToken = localStorage.getItem('refresh_token')
                    if (refreshToken) {
                        try {
                            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.tikuncrm.com/api/v1";
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
                                setAuth(refreshData.user, refreshData.access_token, refreshData.refresh_token)
                                
                                // Check if user must change password
                                if (refreshData.user?.must_change_password && !isChangePasswordPath) {
                                    router.replace('/change-password?required=true')
                                    setIsInitialized(true)
                                    return
                                }
                                
                                if (isPublicPath) {
                                    router.replace('/dashboard')
                                }
                                setIsInitialized(true)
                                return
                            }
                        } catch (refreshError) {
                            console.error("Token refresh failed:", refreshError)
                        }
                    }
                    
                    // Refresh failed or no refresh token - clear and redirect
                    localStorage.removeItem('auth_token')
                    localStorage.removeItem('refresh_token')
                    logout()
                    
                    if (!isPublicPath) {
                        router.replace('/login')
                    }
                }
            } catch (error) {
                console.error("Auth check failed:", error)
                localStorage.removeItem('auth_token')
                localStorage.removeItem('refresh_token')
                logout()
                
                if (!isPublicPath) {
                    router.replace('/login')
                }
            }

            setIsInitialized(true)
        }

        initAuth()
    }, [pathname])

    // Show loading while initializing
    if (!isInitialized) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm font-medium text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    return <>{children}</>
}
