"use client"

import * as React from "react"
import {
    Settings,
    Mail,
    Database,
    Facebook,
    RefreshCcw,
    CheckCircle2,
    AlertTriangle,
    ExternalLink,
    ChevronRight,
    ShieldCheck,
    Smartphone
} from "lucide-react"
import { cn } from "@/lib/utils"

const integrations = [
    {
        id: "gmail",
        name: "Gmail & Google Workspace",
        description: "Sync lead emails and send outreach directly from the CRM.",
        icon: Mail,
        color: "text-red-500",
        bg: "bg-red-500/10",
        status: "Connected",
        lastSync: "5 mins ago",
        type: "Communication"
    },
    {
        id: "meta",
        name: "Meta Lead Ads",
        description: "Capture leads instantly from Facebook and Instagram forms.",
        icon: Facebook,
        color: "text-blue-600",
        bg: "bg-blue-600/10",
        status: "Disconnected",
        lastSync: "N/A",
        type: "Lead Gen"
    },
    {
        id: "sheets",
        name: "Google Sheets",
        description: "Sync and import leads from shared dealership spreadsheets.",
        icon: Database,
        color: "text-emerald-500",
        bg: "bg-emerald-500/10",
        status: "Connected",
        lastSync: "1 hour ago",
        type: "Data Sync"
    },
    {
        id: "whatsapp",
        name: "WhatsApp Business",
        description: "Send automated alerts and chat with leads via WhatsApp.",
        icon: Smartphone,
        color: "text-green-500",
        bg: "bg-green-500/10",
        status: "Coming Soon",
        lastSync: "N/A",
        type: "Communication"
    }
]

export default function IntegrationsPage() {
    const [isSyncing, setIsSyncing] = React.useState<string | null>(null)

    const handleSync = (id: string) => {
        setIsSyncing(id)
        setTimeout(() => setIsSyncing(null), 2000)
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">External Integrations</h1>
                <p className="text-muted-foreground">Connect and manage external services to automate your lead workflows.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {integrations.map((integration) => (
                    <div key={integration.id} className="group relative rounded-2xl border bg-card p-6 hover:shadow-lg transition-all hover:border-primary/20">
                        <div className="flex items-start justify-between">
                            <div className="flex gap-4">
                                <div className={cn(
                                    "flex h-12 w-12 items-center justify-center rounded-xl",
                                    integration.bg,
                                    integration.color
                                )}>
                                    <integration.icon className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-lg">{integration.name}</h3>
                                        <span className="text-[10px] font-black uppercase tracking-widest bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                            {integration.type}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed max-w-[300px]">
                                        {integration.description}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className={cn(
                                    "flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full",
                                    integration.status === 'Connected' ? "bg-emerald-500/10 text-emerald-500" :
                                        integration.status === 'Coming Soon' ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-500"
                                )}>
                                    {integration.status === 'Connected' ? <CheckCircle2 className="h-3 w-3" /> : integration.status === 'Disconnected' ? <AlertTriangle className="h-3 w-3" /> : null}
                                    {integration.status}
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 flex items-center justify-between pt-6 border-t border-dashed">
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                                <RefreshCcw className={cn("h-3 w-3", isSyncing === integration.id && "animate-spin")} />
                                Last synced: {integration.lastSync}
                            </div>
                            <div className="flex gap-2">
                                {integration.status === 'Connected' ? (
                                    <>
                                        <button
                                            onClick={() => handleSync(integration.id)}
                                            disabled={isSyncing === integration.id}
                                            className="text-xs font-bold px-3 py-1.5 rounded-lg border hover:bg-accent transition-all flex items-center gap-1.5"
                                        >
                                            Sync Now
                                        </button>
                                        <button className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-all">
                                            Configure
                                        </button>
                                    </>
                                ) : integration.status === 'Disconnected' ? (
                                    <button className="text-xs font-bold px-4 py-2 rounded-lg bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-all flex items-center gap-2">
                                        <ShieldCheck className="h-3.5 w-3.5" />
                                        Connect Account
                                    </button>
                                ) : (
                                    <button disabled className="text-xs font-bold px-4 py-2 rounded-lg bg-muted text-muted-foreground cursor-not-allowed">
                                        Coming Soon
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="rounded-2xl bg-primary/5 border border-primary/10 p-8 flex flex-col md:flex-row items-center gap-8 mt-12">
                <div className="flex-1 space-y-2 text-center md:text-left">
                    <h2 className="text-xl font-bold flex items-center gap-2 justify-center md:justify-start">
                        <ExternalLink className="h-5 w-5 text-primary" />
                        Webhooks & API
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Connect your custom lead sources or build your own integrations using our secure API endpoints.
                    </p>
                </div>
                <button className="whitespace-nowrap rounded-xl bg-primary px-8 py-3 text-sm font-black uppercase tracking-widest text-primary-foreground shadow-xl shadow-primary/20 hover:scale-105 transition-all active:scale-95">
                    View API Documentation
                </button>
            </div>
        </div>
    )
}
