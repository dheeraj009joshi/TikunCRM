"use client"

import * as React from "react"
import { LayoutDashboard, Users, LogOut } from "lucide-react"
import Link from "next/link"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <LayoutDashboard className="h-6 w-6" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">TikunCRM</h1>
          <p className="text-muted-foreground">The most advanced lead management platform for enterprise dealerships.</p>
        </div>

        <div className="grid gap-4">
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-xl transition-all hover:scale-[1.02] hover:bg-primary/90"
          >
            Launch Dashboard
          </Link>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card p-4 transition-all hover:border-primary/50">
              <Users className="mx-auto h-6 w-6 text-primary mb-2" />
              <p className="text-sm font-semibold">Multi-Tenant</p>
              <p className="text-xs text-muted-foreground mt-1">Independent dealership nodes</p>
            </div>
            <div className="rounded-xl border bg-card p-4 transition-all hover:border-primary/50">
              <BarChart3 className="mx-auto h-6 w-6 text-primary mb-2" />
              <p className="text-sm font-semibold">Live Analytics</p>
              <p className="text-xs text-muted-foreground mt-1">Real-time lead tracking</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground pt-8 uppercase tracking-widest font-semibold">
          Powered by TikunCRM Technology
        </p>
      </div>
    </div>
  )
}

import { BarChart3 } from "lucide-react"
