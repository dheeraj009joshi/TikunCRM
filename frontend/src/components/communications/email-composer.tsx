"use client"

import * as React from "react"
import { Send, X, Paperclip, Smile, Bold, Italic, List } from "lucide-react"

interface EmailComposerProps {
    recipientEmail: string
    recipientName: string
    onClose?: () => void
    onSend?: (data: { subject: string; body: string }) => void
}

export function EmailComposer({ recipientEmail, recipientName, onClose, onSend }: EmailComposerProps) {
    const [subject, setSubject] = React.useState("")
    const [body, setBody] = React.useState("")
    const [isSending, setIsSending] = React.useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSending(true)

        // Simulate API call
        if (onSend) {
            await onSend({ subject, body })
        }

        setIsSending(false)
        if (onClose) onClose()
    }

    return (
        <div className="flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300 h-[500px] w-full max-w-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                <h3 className="text-sm font-bold capitalize">New Email to {recipientName}</h3>
                <button onClick={onClose} className="p-1 hover:bg-accent rounded-md transition-colors">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Recipient Details */}
            <div className="px-4 py-2 border-b space-y-2">
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-12 text-xs font-bold uppercase tracking-wider">To:</span>
                    <span className="font-semibold text-primary/80">{recipientEmail}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-12 text-xs font-bold uppercase tracking-wider">Subj:</span>
                    <input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Introduce yourself or follow up on inquiry..."
                        className="flex-1 bg-transparent outline-none py-1 focus:ring-0 placeholder:text-muted-foreground/50 font-medium"
                    />
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 px-4 py-4 overflow-y-auto">
                <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={`Hi ${recipientName.split(' ')[0]},

I'm following up on your interest in...`}
                    className="w-full h-full bg-transparent resize-none outline-none text-sm leading-relaxed"
                />
            </div>

            {/* Formatting Tools & Footer */}
            <div className="p-3 bg-muted/30 border-t flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <button className="p-2 text-muted-foreground hover:bg-accent rounded transition-colors" title="Bold"><Bold className="h-4 w-4" /></button>
                    <button className="p-2 text-muted-foreground hover:bg-accent rounded transition-colors" title="Italic"><Italic className="h-4 w-4" /></button>
                    <button className="p-2 text-muted-foreground hover:bg-accent rounded transition-colors" title="List"><List className="h-4 w-4" /></button>
                    <div className="w-px h-4 bg-border mx-1" />
                    <button className="p-2 text-muted-foreground hover:bg-accent rounded transition-colors"><Paperclip className="h-4 w-4" /></button>
                    <button className="p-2 text-muted-foreground hover:bg-accent rounded transition-colors"><Smile className="h-4 w-4" /></button>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={isSending || !subject || !body}
                    className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-bold text-primary-foreground shadow-lg hover:bg-primary/90 disabled:opacity-50 transition-all uppercase tracking-widest"
                >
                    {isSending ? "Sending..." : "Send Now"}
                    {!isSending && <Send className="h-4 w-4" />}
                </button>
            </div>
        </div>
    )
}
