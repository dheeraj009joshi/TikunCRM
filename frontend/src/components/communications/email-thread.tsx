"use client"

import * as React from "react"
import { Mail, ChevronDown, ChevronUp, Reply, Clock, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

export interface EmailThreadItem {
    id: string
    subject: string
    body: string
    direction: 'sent' | 'received'
    sent_at: string
    user_name: string
}

interface ThreadProps {
    emails: EmailThreadItem[]
}

export function EmailThread({ emails }: ThreadProps) {
    const [expandedId, setExpandedId] = React.useState<string | null>(emails[0]?.id || null)

    if (emails.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center bg-muted/20 rounded-xl border border-dashed">
                <Mail className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground font-medium">No email history with this contact.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {emails.map((email) => {
                const isExpanded = expandedId === email.id
                return (
                    <div
                        key={email.id}
                        className={cn(
                            "rounded-xl border bg-card transition-all overflow-hidden",
                            isExpanded ? "ring-2 ring-primary/20 shadow-md" : "hover:border-primary/30"
                        )}
                    >
                        {/* Header / Summary */}
                        <div
                            onClick={() => setExpandedId(isExpanded ? null : email.id)}
                            className="px-4 py-3 flex items-center justify-between cursor-pointer group"
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold",
                                    email.direction === 'sent' ? "bg-primary/10 text-primary" : "bg-sky-500/10 text-sky-500"
                                )}>
                                    {email.direction === 'sent' ? 'S' : 'R'}
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold truncate max-w-[200px] md:max-w-md">{email.subject}</h4>
                                    <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1 font-bold">
                                        <Clock className="h-3 w-3" />
                                        {email.sent_at} • By {email.user_name}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "text-[9px] uppercase font-black px-1.5 py-0.5 rounded border tracking-tighter",
                                    email.direction === 'sent' ? "border-primary/30 text-primary" : "border-sky-500/30 text-sky-500"
                                )}>
                                    {email.direction === 'sent' ? 'OUTBOUND' : 'INBOUND'}
                                </span>
                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </div>
                        </div>

                        {/* Content */}
                        {isExpanded && (
                            <div className="px-4 pb-4 pt-2 animate-in fade-in duration-300">
                                <div className="rounded-lg bg-muted/30 p-4 border text-sm leading-relaxed whitespace-pre-wrap">
                                    {email.body}
                                </div>
                                <div className="mt-4 flex justify-end gap-2">
                                    <button className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
                                        <ExternalLink className="h-3 w-3" />
                                        View Original
                                    </button>
                                    <button className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-all">
                                        <Reply className="h-3 w-3" />
                                        Reply
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
