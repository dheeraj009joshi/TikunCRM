"use client"

import * as React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string
    description?: string
    onRetry?: () => void
    compact?: boolean
}

/**
 * Standard error state for failed data fetches. Pair with ErrorBoundary
 * for render-time crashes.
 */
export function ErrorState({
    title = "Something went wrong",
    description = "We couldn't load this data. Please try again.",
    onRetry,
    compact = false,
    className,
    ...props
}: ErrorStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center text-center",
                compact ? "gap-2 py-8 px-4" : "gap-3 py-16 px-6",
                className
            )}
            {...props}
        >
            <div
                className={cn(
                    "flex items-center justify-center rounded-full bg-destructive/10 text-destructive",
                    compact ? "h-10 w-10" : "h-14 w-14"
                )}
            >
                <AlertTriangle className={compact ? "h-5 w-5" : "h-7 w-7"} />
            </div>
            <div className="space-y-1">
                <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</p>
                <p className={cn("text-muted-foreground max-w-sm mx-auto", compact ? "text-xs" : "text-sm")}>
                    {description}
                </p>
            </div>
            {onRetry && (
                <Button variant="outline" size={compact ? "sm" : "default"} onClick={onRetry} className="mt-1">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                </Button>
            )}
        </div>
    )
}

interface ErrorBoundaryProps {
    children: React.ReactNode
    fallback?: React.ReactNode
}

interface ErrorBoundaryState {
    hasError: boolean
}

/**
 * Global error boundary. Wrap page content so a crashing widget
 * doesn't take down the whole app shell.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true }
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error("ErrorBoundary caught:", error, info)
    }

    handleRetry = () => {
        this.setState({ hasError: false })
    }

    render() {
        if (this.state.hasError) {
            return (
                this.props.fallback ?? (
                    <ErrorState
                        title="This page hit an unexpected error"
                        description="The rest of the app is still fine. Try reloading this section."
                        onRetry={this.handleRetry}
                    />
                )
            )
        }
        return this.props.children
    }
}
