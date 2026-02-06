"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, TrendingUp, Users, Target } from "lucide-react"

export default function AnalyticsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
                <p className="text-muted-foreground">
                    View detailed analytics and performance metrics.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Coming Soon</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Lead Analytics</div>
                        <p className="text-xs text-muted-foreground">
                            Conversion rates, sources, and trends
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Coming Soon</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Performance</div>
                        <p className="text-xs text-muted-foreground">
                            Team and individual performance metrics
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Coming Soon</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Team Stats</div>
                        <p className="text-xs text-muted-foreground">
                            Activity and engagement metrics
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Coming Soon</CardTitle>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Goals</div>
                        <p className="text-xs text-muted-foreground">
                            Track progress towards targets
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                    <BarChart3 className="h-16 w-16 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-semibold">Analytics Dashboard Coming Soon</h3>
                    <p className="text-muted-foreground text-center max-w-md mt-2">
                        We're building comprehensive analytics to help you understand your lead performance, 
                        team productivity, and conversion metrics.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
