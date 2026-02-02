"use client"

import * as React from "react"
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
    trend?: {
        value: string
        isPositive: boolean
    }
    color?: "blue" | "emerald" | "amber" | "rose" | "purple"
    className?: string
}

const colorClasses = {
    blue: "bg-blue-500/10 text-blue-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    rose: "bg-rose-500/10 text-rose-500",
    purple: "bg-purple-500/10 text-purple-500",
}

function MetricCard({ title, metric, icon, trend, color = "blue", className }: MetricCardProps) {
    return (
        <Card className={cn("relative overflow-hidden hover:shadow-lg transition-all", className)}>
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    {icon && (
                        <div className={cn("rounded-lg p-2", colorClasses[color])}>
                            {icon}
                        </div>
                    )}
                    {trend && (
                        <div className={cn(
                            "flex items-center gap-1 text-[10px] font-black uppercase tracking-tighter",
                            trend.isPositive ? "text-emerald-500" : "text-rose-500"
                        )}>
                            {trend.value}
                            <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d={trend.isPositive
                                        ? "M7 17L17 7M17 7H7M17 7V17"
                                        : "M17 17L7 7M7 7H17M7 7V17"
                                    }
                                />
                            </svg>
                        </div>
                    )}
                </div>
                <div className="mt-4">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                        {title}
                    </h2>
                    <p className="mt-1 text-2xl font-black tracking-tighter">{metric}</p>
                </div>
                <div className={cn(
                    "absolute -right-4 -top-4 h-24 w-24 rounded-full opacity-[0.03]",
                    colorClasses[color].split(" ")[0]
                )} />
            </CardContent>
        </Card>
    )
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, MetricCard }
