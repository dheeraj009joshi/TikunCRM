"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
    Mail,
    Send,
    Inbox,
    Search,
    RefreshCw,
    ChevronRight,
    Loader2,
    User,
    Clock,
    MailOpen,
    ArrowLeft,
    Reply,
    MailPlus,
    CheckCircle2,
    AlertCircle,
    Eye,
    MousePointer
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/ui/avatar"
import {
    EmailTemplateService,
    EmailInboxItem,
    EmailDetail,
    EmailStats,
    EmailThread,
    EmailDeliveryStatus
} from "@/services/email-service"
import { UserEmailService } from "@/services/user-email-service"
import { EmailComposerModal } from "@/components/emails/email-composer-modal"
import { cn } from "@/lib/utils"
import { useDealershipTimezone } from "@/hooks/use-dealership-timezone"
import { formatDateInTimezone, formatRelativeTimeInTimezone } from "@/utils/timezone"

function formatDate(dateString: string, timezone: string) {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)
    
    if (diffHours < 24) {
        return formatDateInTimezone(date, timezone, {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone
        })
    } else if (diffHours < 48) {
        return 'Yesterday'
    } else {
        return formatDateInTimezone(date, timezone, {
            month: 'short',
            day: 'numeric',
            timeZone: timezone
        })
    }
}

function getDisplayName(email: EmailInboxItem): string {
    if (email.direction === 'sent') {
        // For sent emails, show who it was sent TO
        if (email.lead) {
            return `To: ${email.lead.first_name} ${email.lead.last_name}`
        }
        return `To: ${email.to_email}`
    } else {
        // For received emails, show who it's FROM
        if (email.lead) {
            return `${email.lead.first_name} ${email.lead.last_name}`
        }
        return email.from_email
    }
}

function getInitialsFromEmail(emailAddress: string): { firstName: string, lastName: string } {
    // Try to extract name from email format "Name <email@domain.com>"
    const nameMatch = emailAddress.match(/^([^<]+)</);
    if (nameMatch) {
        const name = nameMatch[1].trim();
        const parts = name.split(' ');
        return {
            firstName: parts[0] || '',
            lastName: parts.slice(1).join(' ') || ''
        };
    }
    
    // Extract from the email part before @
    const localPart = emailAddress.split('@')[0] || '';
    // Try to split by common separators (. _ -)
    const parts = localPart.split(/[._-]/);
    if (parts.length >= 2) {
        return {
            firstName: parts[0] || '',
            lastName: parts[1] || ''
        };
    }
    
    // Just use first two characters of the local part
    return {
        firstName: localPart.charAt(0) || '?',
        lastName: localPart.charAt(1) || ''
    };
}

// Delivery status badge component
function DeliveryStatusBadge({ status, openCount, clickCount }: { 
    status?: EmailDeliveryStatus, 
    openCount?: number,
    clickCount?: number 
}) {
    if (!status) return null
    
    const statusConfig: Record<EmailDeliveryStatus, { label: string, variant: 'default' | 'secondary' | 'destructive' | 'outline', icon?: React.ReactNode }> = {
        pending: { label: 'Sending', variant: 'secondary' },
        sent: { label: 'Sent', variant: 'outline' },
        delivered: { label: 'Delivered', variant: 'default', icon: <CheckCircle2 className="h-3 w-3" /> },
        opened: { label: `Opened${openCount && openCount > 1 ? ` (${openCount})` : ''}`, variant: 'default', icon: <Eye className="h-3 w-3" /> },
        clicked: { label: `Clicked${clickCount && clickCount > 1 ? ` (${clickCount})` : ''}`, variant: 'default', icon: <MousePointer className="h-3 w-3" /> },
        bounced: { label: 'Bounced', variant: 'destructive', icon: <AlertCircle className="h-3 w-3" /> },
        dropped: { label: 'Failed', variant: 'destructive' },
        spam: { label: 'Spam', variant: 'destructive' },
        failed: { label: 'Failed', variant: 'destructive' }
    }
    
    const config = statusConfig[status]
    if (!config) return null
    
    return (
        <Badge variant={config.variant} size="sm" className="gap-1">
            {config.icon}
            {config.label}
        </Badge>
    )
}

type TabType = 'inbox' | 'sent' | 'all'

export default function CommunicationsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { timezone } = useDealershipTimezone()
    const initialTab = (searchParams.get('tab') as TabType) || 'inbox'
    
    const [activeTab, setActiveTab] = React.useState<TabType>(initialTab)
    const [emails, setEmails] = React.useState<EmailInboxItem[]>([])
    const [stats, setStats] = React.useState<EmailStats | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)
    const [isRefreshing, setIsRefreshing] = React.useState(false)
    const [isSyncing, setIsSyncing] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const [selectedEmail, setSelectedEmail] = React.useState<EmailDetail | null>(null)
    const [selectedThread, setSelectedThread] = React.useState<EmailThread | null>(null)
    const [isLoadingDetail, setIsLoadingDetail] = React.useState(false)
    const [showComposer, setShowComposer] = React.useState(false)
    
    const fetchEmails = React.useCallback(async () => {
        setIsLoading(true)
        try {
            // Map tab to direction filter
            const direction = activeTab === 'sent' ? 'sent' : activeTab === 'inbox' ? 'received' : undefined
            const response = await EmailTemplateService.getInbox({
                direction,
                search: search || undefined,
                page_size: 50
            })
            setEmails(response.items)
        } catch (error) {
            console.error("Failed to fetch emails:", error)
        } finally {
            setIsLoading(false)
        }
    }, [activeTab, search])
    
    const fetchStats = React.useCallback(async () => {
        try {
            const response = await EmailTemplateService.getEmailStats()
            setStats(response)
        } catch (error) {
            console.error("Failed to fetch stats:", error)
        }
    }, [])
    
    React.useEffect(() => {
        fetchEmails()
        fetchStats()
    }, [fetchEmails, fetchStats])
    
    const handleEmailClick = async (email: EmailInboxItem) => {
        setIsLoadingDetail(true)
        setSelectedEmail(null)
        setSelectedThread(null)
        
        try {
            const detail = await EmailTemplateService.getEmailDetail(email.id)
            setSelectedEmail(detail)
            
            // Try to load thread if available
            if (email.gmail_thread_id || email.lead_id) {
                try {
                    const thread = await EmailTemplateService.getEmailThread(email.gmail_thread_id || email.id)
                    if (thread.total_count > 1) {
                        setSelectedThread(thread)
                    }
                } catch {
                    // Thread not found, just show single email
                }
            }
            
            // Update unread count
            if (!email.is_read) {
                fetchStats()
                setEmails(prev => prev.map(e => 
                    e.id === email.id ? { ...e, is_read: true } : e
                ))
            }
        } catch (error) {
            console.error("Failed to load email:", error)
        } finally {
            setIsLoadingDetail(false)
        }
    }
    
    const handleBack = () => {
        setSelectedEmail(null)
        setSelectedThread(null)
    }
    
    const handleRefresh = async () => {
        setIsRefreshing(true)
        await Promise.all([fetchEmails(), fetchStats()])
        setIsRefreshing(false)
    }

    const handleSyncInbox = async () => {
        setIsSyncing(true)
        try {
            const result = await UserEmailService.syncNow()
            if (result.success) {
                // Refresh the email list after sync
                await Promise.all([fetchEmails(), fetchStats()])
            }
        } catch (error) {
            console.error("Sync failed:", error)
        } finally {
            setIsSyncing(false)
        }
    }

    const handleTabChange = (tab: TabType) => {
        setActiveTab(tab)
        setSelectedEmail(null)
        setSelectedThread(null)
    }

    // Tab Button Component
    const TabButton = ({ tab, icon: Icon, label, count, isUnread = false }: { 
        tab: TabType, 
        icon: React.ElementType, 
        label: string, 
        count?: number,
        isUnread?: boolean 
    }) => (
        <button
            onClick={() => handleTabChange(tab)}
            className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                activeTab === tab 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
        >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {count !== undefined && count > 0 && (
                <Badge 
                    variant={isUnread && activeTab !== tab ? "destructive" : "secondary"} 
                    size="sm"
                    className="ml-1"
                >
                    {count}
                </Badge>
            )}
        </button>
    )

    // Email List Item
    const EmailListItem = ({ email }: { email: EmailInboxItem }) => {
        const isUnread = !email.is_read && email.direction === 'received'
        
        return (
            <div
                className={cn(
                    "flex items-start gap-4 p-4 cursor-pointer border-b transition-colors",
                    isUnread 
                        ? "bg-blue-50/70 dark:bg-blue-950/20 hover:bg-blue-100/50 dark:hover:bg-blue-950/30" 
                        : "hover:bg-muted/50"
                )}
                onClick={() => handleEmailClick(email)}
            >
                {/* Direction Icon or Avatar */}
                <div className="flex-shrink-0 mt-1">
                    {email.direction === 'sent' ? (
                        <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <Send className="h-4 w-4 text-emerald-600" />
                        </div>
                    ) : email.lead ? (
                        <UserAvatar
                            firstName={email.lead.first_name}
                            lastName={email.lead.last_name}
                            size="md"
                        />
                    ) : (() => {
                        const { firstName, lastName } = getInitialsFromEmail(email.from_email);
                        return (
                            <UserAvatar
                                firstName={firstName}
                                lastName={lastName}
                                size="md"
                            />
                        );
                    })()}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn(
                            "text-sm truncate",
                            isUnread ? "font-semibold text-foreground" : "font-medium"
                        )}>
                            {getDisplayName(email)}
                        </span>
                        {isUnread && (
                            <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                    </div>
                    <p className={cn(
                        "text-sm truncate mb-1",
                        isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                    )}>
                        {email.subject || "(No subject)"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        {email.body?.slice(0, 100)}...
                    </p>
                </div>
                
                {/* Meta */}
                <div className="flex-shrink-0 text-right space-y-1">
                    <p className={cn(
                        "text-xs",
                        isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                    )}>
                        {formatDate(email.created_at, timezone)}
                    </p>
                    <div className="flex flex-wrap gap-1 justify-end">
                        {email.direction === 'sent' && email.delivery_status && (
                            <DeliveryStatusBadge 
                                status={email.delivery_status}
                                openCount={email.open_count}
                                clickCount={email.click_count}
                            />
                        )}
                        {email.lead && (
                            <Badge variant="outline" size="sm">
                                Lead
                            </Badge>
                        )}
                    </div>
                </div>
                
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-3" />
            </div>
        )
    }

    // Email Detail View
    const EmailDetailView = () => {
        if (!selectedEmail) return null
        
        const emailsToShow = selectedThread?.emails || [selectedEmail]
        
        return (
            <Card>
                <CardHeader className="pb-3 border-b">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="sm" onClick={handleBack}>
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                        <div className="flex-1">
                            <h2 className="font-semibold text-lg">
                                {selectedEmail.subject || "(No subject)"}
                            </h2>
                            {selectedThread && selectedThread.total_count > 1 && (
                                <p className="text-sm text-muted-foreground">
                                    {selectedThread.total_count} messages in this conversation
                                </p>
                            )}
                        </div>
                        {selectedEmail.lead && (
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => router.push(`/leads/${selectedEmail.lead?.id}`)}
                            >
                                View Lead
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoadingDetail ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="divide-y">
                            {emailsToShow.map((email) => (
                                <div key={email.id} className="p-6">
                                    {/* Email Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            {email.direction === 'sent' ? (
                                                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                                    <Send className="h-4 w-4 text-emerald-600" />
                                                </div>
                                            ) : email.sender_user ? (
                                                <UserAvatar
                                                    firstName={email.sender_user.first_name}
                                                    lastName={email.sender_user.last_name}
                                                    size="md"
                                                />
                                            ) : (() => {
                                                const { firstName, lastName } = getInitialsFromEmail(email.from_email);
                                                return (
                                                    <UserAvatar
                                                        firstName={firstName}
                                                        lastName={lastName}
                                                        size="md"
                                                    />
                                                );
                                            })()}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">
                                                        {email.direction === 'sent' 
                                                            ? 'You' 
                                                            : email.sender_user 
                                                                ? `${email.sender_user.first_name} ${email.sender_user.last_name}`
                                                                : email.from_email
                                                        }
                                                    </span>
                                                    {email.direction === 'sent' && email.delivery_status ? (
                                                        <DeliveryStatusBadge 
                                                            status={email.delivery_status}
                                                            openCount={email.open_count}
                                                            clickCount={email.click_count}
                                                        />
                                                    ) : (
                                                        <Badge variant={email.direction === 'sent' ? "secondary" : "outline"} size="sm">
                                                            {email.direction === 'sent' ? 'Sent' : 'Received'}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-sm text-muted-foreground">
                                                    {email.direction === 'sent' ? `To: ${email.to_email}` : `From: ${email.from_email}`}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {formatDateInTimezone(email.created_at, timezone, {
                                                    dateStyle: "medium",
                                                    timeStyle: "short"
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Email Body */}
                                    <div className="prose prose-sm max-w-none dark:prose-invert pl-13">
                                        {email.body_html ? (
                                            <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
                                        ) : (
                                            <pre className="whitespace-pre-wrap font-sans text-sm bg-transparent p-0">
                                                {email.body}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            ))}
                            
                            {/* Reply Section */}
                            <div className="p-4 bg-muted/30">
                                <Button onClick={() => setShowComposer(true)}>
                                    <Reply className="h-4 w-4 mr-2" />
                                    Reply
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        )
    }

    // Empty State
    const EmptyState = () => {
        const messages: Record<TabType, { title: string, description: string }> = {
            inbox: {
                title: "No received emails",
                description: "When leads reply to your emails, they'll appear here"
            },
            sent: {
                title: "No sent emails",
                description: "Emails you send to leads will appear here"
            },
            all: {
                title: "No emails yet",
                description: "Start by sending an email to a lead"
            }
        }

        return (
            <div className="text-center py-16">
                <Mail className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
                <h3 className="font-semibold text-lg mb-2">{messages[activeTab].title}</h3>
                <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                    {search ? "Try a different search term" : messages[activeTab].description}
                </p>
                <Button onClick={() => setShowComposer(true)} size="lg">
                    <MailPlus className="h-4 w-4 mr-2" />
                    Compose Email
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Communications</h1>
                    <p className="text-muted-foreground">
                        Manage email conversations with your leads
                    </p>
                </div>
                <Button onClick={() => setShowComposer(true)}>
                    <MailPlus className="h-4 w-4 mr-2" />
                    Compose
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                                <Mail className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold">{stats?.total || 0}</p>
                                <p className="text-sm text-muted-foreground">Total Emails</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleTabChange('sent')}>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                                <Send className="h-6 w-6 text-emerald-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold">{stats?.total_sent || 0}</p>
                                <p className="text-sm text-muted-foreground">Sent</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleTabChange('inbox')}>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
                                <Inbox className="h-6 w-6 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold">{stats?.total_received || 0}</p>
                                <p className="text-sm text-muted-foreground">Received</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className={cn(
                    "hover:shadow-md transition-shadow cursor-pointer",
                    stats?.unread_count && stats.unread_count > 0 && "ring-2 ring-amber-500/50"
                )} onClick={() => handleTabChange('inbox')}>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                                <MailOpen className="h-6 w-6 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold">{stats?.unread_count || 0}</p>
                                <p className="text-sm text-muted-foreground">Unread</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            
            {/* Main Content */}
            {selectedEmail ? (
                <EmailDetailView />
            ) : (
                <Card>
                    {/* Tabs and Actions Bar */}
                    <div className="border-b p-4">
                        <div className="flex items-center justify-between gap-4">
                            {/* Tab Buttons */}
                            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
                                <TabButton tab="inbox" icon={Inbox} label="Inbox" count={stats?.unread_count} isUnread />
                                <TabButton tab="sent" icon={Send} label="Sent" count={stats?.total_sent} />
                                <TabButton tab="all" icon={Mail} label="All" count={stats?.total} />
                            </div>
                            
                            {/* Actions */}
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search emails..."
                                        className="pl-9 w-64"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={handleSyncInbox}
                                    disabled={isSyncing}
                                >
                                    <RefreshCw className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")} />
                                    {isSyncing ? "Syncing..." : "Sync Inbox"}
                                </Button>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                >
                                    <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                                </Button>
                            </div>
                        </div>
                    </div>
                    
                    {/* Email List */}
                    <div className="min-h-[400px]">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : emails.length === 0 ? (
                            <EmptyState />
                        ) : (
                            <div>
                                {emails.map((email) => (
                                    <EmailListItem key={email.id} email={email} />
                                ))}
                            </div>
                        )}
                    </div>
                </Card>
            )}
            
            {/* Composer Modal */}
            <EmailComposerModal
                isOpen={showComposer}
                onClose={() => setShowComposer(false)}
                leadId={selectedEmail?.lead_id}
                leadEmail={selectedEmail?.lead?.email || selectedEmail?.to_email}
                leadName={selectedEmail?.lead ? `${selectedEmail.lead.first_name} ${selectedEmail.lead.last_name}` : undefined}
                onSent={() => {
                    fetchEmails()
                    fetchStats()
                }}
            />
        </div>
    )
}
