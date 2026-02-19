"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground",
                secondary: "bg-secondary text-secondary-foreground",
                destructive: "bg-destructive text-destructive-foreground",
                outline: "border border-input bg-background text-foreground",
                // Status variants
                new: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                contacted: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                follow_up: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                interested: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                not_interested: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
                converted: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                lost: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                in_showroom: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                couldnt_qualify: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                browsing: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
                reschedule: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                manager_review: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
                qualified: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                negotiation: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
                // Role variants
                super_admin: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
                dealership_owner: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                dealership_admin: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
                salesperson: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                // Source variants
                google_sheets: "bg-green-500/10 text-green-600 dark:text-green-400",
                meta_ads: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                manual: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
                website: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
                referral: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                walk_in: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
            },
            size: {
                default: "px-2.5 py-0.5 text-xs",
                sm: "px-2 py-0.5 text-[10px]",
                lg: "px-3 py-1 text-sm",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
    dot?: boolean
    dotColor?: string
}

function Badge({ className, variant, size, dot, dotColor, children, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
            {dot && (
                <span
                    className={cn(
                        "mr-1.5 h-1.5 w-1.5 rounded-full",
                        dotColor || "bg-current"
                    )}
                />
            )}
            {children}
        </div>
    )
}

// Normalize stage display name or name to variant key (e.g. "In Showroom" → "in_showroom")
export function normalizeStatusKey(status: string): string {
    if (!status || typeof status !== "string") return ""
    const key = status
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/'/g, "")
    // Map display-name forms to variant keys
    if (key === "couldnt_qualify") return "couldnt_qualify"
    return key
}

// Helper to get badge variant from status string (accepts display name or name, e.g. "In Showroom", "in_showroom")
function getStatusVariant(status: string): VariantProps<typeof badgeVariants>["variant"] {
    const key = normalizeStatusKey(status)
    const statusMap: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
        new: "new",
        contacted: "contacted",
        follow_up: "follow_up",
        interested: "interested",
        not_interested: "not_interested",
        in_showroom: "in_showroom",
        converted: "converted",
        lost: "lost",
        couldnt_qualify: "couldnt_qualify",
        browsing: "browsing",
        reschedule: "reschedule",
        negotiation: "negotiation",
        manager_review: "manager_review",
        qualified: "qualified",
    }
    return statusMap[key] || "default"
}

function getRoleVariant(role: string): VariantProps<typeof badgeVariants>["variant"] {
    const roleMap: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
        super_admin: "super_admin",
        dealership_owner: "dealership_owner",
        dealership_admin: "dealership_admin",
        salesperson: "salesperson",
    }
    return roleMap[role] || "default"
}

function getSourceVariant(source: string): VariantProps<typeof badgeVariants>["variant"] {
    const sourceMap: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
        google_sheets: "google_sheets",
        meta_ads: "meta_ads",
        manual: "manual",
        website: "website",
        referral: "referral",
        walk_in: "walk_in",
        // Custom display sources from Google Sheets (use same green styling)
        "Toyota Spanish Leads": "google_sheets",
        "Toyota Spanish Leads with Down payment": "google_sheets",
    }
    return sourceMap[source] || "default"
}

export { Badge, badgeVariants, getStatusVariant, getRoleVariant, getSourceVariant }
