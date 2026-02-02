"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
    React.ComponentRef<typeof AvatarPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
    <AvatarPrimitive.Root
        ref={ref}
        className={cn(
            "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
            className
        )}
        {...props}
    />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
    React.ComponentRef<typeof AvatarPrimitive.Image>,
    React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
    <AvatarPrimitive.Image
        ref={ref}
        className={cn("aspect-square h-full w-full", className)}
        {...props}
    />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
    React.ComponentRef<typeof AvatarPrimitive.Fallback>,
    React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
    <AvatarPrimitive.Fallback
        ref={ref}
        className={cn(
            "flex h-full w-full items-center justify-center rounded-full bg-muted",
            className
        )}
        {...props}
    />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

// User avatar with initials fallback
interface UserAvatarProps {
    user?: {
        first_name?: string
        last_name?: string
        avatar_url?: string | null
    }
    firstName?: string
    lastName?: string
    size?: "sm" | "md" | "lg" | "xl"
    className?: string
}

const sizeClasses = {
    sm: "h-6 w-6 text-xs",
    md: "h-8 w-8 text-sm",
    lg: "h-10 w-10 text-base",
    xl: "h-12 w-12 text-lg",
}

function UserAvatar({ user, firstName, lastName, size = "md", className }: UserAvatarProps) {
    // Support both user object and direct firstName/lastName props
    const first = firstName || user?.first_name || ""
    const last = lastName || user?.last_name || ""
    const initials = first && last 
        ? `${first[0]}${last[0]}`.toUpperCase()
        : first 
        ? first[0].toUpperCase()
        : "?"

    return (
        <Avatar className={cn(sizeClasses[size], className)}>
            {user?.avatar_url && <AvatarImage src={user.avatar_url} alt={initials} />}
            <AvatarFallback className="bg-gradient-to-br from-primary to-purple-500 text-white font-semibold">
                {initials}
            </AvatarFallback>
        </Avatar>
    )
}

export { Avatar, AvatarImage, AvatarFallback, UserAvatar }
