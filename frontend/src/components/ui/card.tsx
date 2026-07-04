"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    decoration?: "top" | "left" | "bottom" | "right"
    decorationColor?: "blue" | "emerald" | "amber" | "rose" | "purple" | "gray"
}

const decorationColorMap = {
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    purple: "bg-purple-500",
    gray: "bg-gray-500",
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, decoration, decorationColor = "blue", children, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    "relative rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
                    className
                )}
                {...props}
            >
                {decoration && (
                    <div
                        className={cn(
                            decorationColorMap[decorationColor],
                            decoration === "top" && "absolute top-0 left-0 right-0 h-1",
                            decoration === "bottom" && "absolute bottom-0 left-0 right-0 h-1",
                            decoration === "left" && "absolute top-0 bottom-0 left-0 w-1",
                            decoration === "right" && "absolute top-0 bottom-0 right-0 w-1"
                        )}
                    />
                )}
                {children}
            </div>
        )
    }
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex flex-col space-y-1.5 p-6", className)}
        {...props}
    />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h3
        ref={ref}
        className={cn("font-semibold leading-none tracking-tight", className)}
        {...props}
    />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <p
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
    />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex items-center p-6 pt-0", className)}
        {...props}
    />
))
CardFooter.displayName = "CardFooter"

// Tremor-style Metric Card
interface MetricCardProps {
    title: string
    metric: string | number
    icon?: React.ReactNode
    description?: string
    trend?: {
        value: string
        isPositive: boolean
    }
    color?: "blue" | "emerald" | "amber" | "rose" | "purple"
    className?: string
    href?: string
    onClick?: () => void
    actionLabel?: string
}

const colorClasses = {
    blue: "bg-blue-500/10 text-blue-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    rose: "bg-rose-500/10 text-rose-500",
    purple: "bg-purple-500/10 text-purple-500",
}

const metricBorderAccent: Record<NonNullable<MetricCardProps["color"]>, string> = {
    blue: "hover:border-blue-300/80 hover:shadow-blue-500/10",
    emerald: "hover:border-emerald-300/80 hover:shadow-emerald-500/10",
    amber: "hover:border-amber-300/80 hover:shadow-amber-500/10",
    rose: "hover:border-rose-300/80 hover:shadow-rose-500/10",
    purple: "hover:border-purple-300/80 hover:shadow-purple-500/10",
}

function MetricCard({
    title,
    metric,
    icon,
    description,
    trend,
    color = "blue",
    className,
    href,
    onClick,
    actionLabel = "View",
}: MetricCardProps) {
    const isInteractive = Boolean(href || onClick)
    const cardContent = (
        <Card
            className={cn(
                "relative overflow-hidden border-2 border-transparent transition-all duration-200",
                isInteractive && "cursor-pointer hover:shadow-lg hover:-translate-y-0.5",
                isInteractive && metricBorderAccent[color],
                className
            )}
            onClick={onClick}
        >
            <CardContent className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                    {icon && (
                        <div className={cn("rounded-xl p-2.5 shadow-sm", colorClasses[color])}>
                            {icon}
                        </div>
                    )}
                    {trend && (
                        <div
                            className={cn(
                                "flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight",
                                trend.isPositive ? "text-emerald-600" : "text-rose-600"
                            )}
                        >
                            {trend.value}
                        </div>
                    )}
                </div>
                <div className="mt-4 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {title}
                    </p>
                    <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{metric}</p>
                    {description && (
                        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{description}</p>
                    )}
                </div>
                {isInteractive && (
                    <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
                        {actionLabel}
                        <ChevronRight className="h-4 w-4" />
                    </div>
                )}
            </CardContent>
        </Card>
    )

    if (href) {
        return (
            <Link href={href} className="group block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                {cardContent}
            </Link>
        )
    }

    return cardContent
}

// Canonical name going forward; MetricCard kept for existing call sites
const StatCard = MetricCard

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, MetricCard, StatCard }
