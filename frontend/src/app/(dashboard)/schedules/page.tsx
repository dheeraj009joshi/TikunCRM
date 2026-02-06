"use client"

import * as React from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CalendarDays, Clock, CalendarClock, Bell } from "lucide-react"

export default function SchedulesPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Schedules</h1>
                <p className="text-muted-foreground">
                    Manage your appointments, follow-ups, and scheduled activities.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Link href="/appointments">
                    <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Appointments</CardTitle>
                            <CalendarClock className="h-5 w-5 text-primary" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                View and manage scheduled appointments with leads
                            </p>
                            <Button variant="link" className="px-0 mt-2">
                                View Appointments →
                            </Button>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/follow-ups">
                    <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Follow-ups</CardTitle>
                            <Clock className="h-5 w-5 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Track and complete your follow-up tasks
                            </p>
                            <Button variant="link" className="px-0 mt-2">
                                View Follow-ups →
                            </Button>
                        </CardContent>
                    </Card>
                </Link>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Reminders</CardTitle>
                        <Bell className="h-5 w-5 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Custom reminders and notifications
                        </p>
                        <p className="text-xs text-muted-foreground mt-2 italic">
                            Coming soon...
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-primary" />
                        Schedule Overview
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center py-8">
                    <CalendarDays className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground text-center max-w-md">
                        A unified calendar view showing all your appointments and follow-ups is coming soon.
                        For now, use the individual sections above.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
