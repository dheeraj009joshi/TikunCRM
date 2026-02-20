"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  MessageSquare,
  MessageCircle,
  Mail,
  MailOpen,
  Loader2,
  RefreshCw,
  User,
  ArrowUpRight,
  Clock
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { voiceService, CallLog, VoiceConfig } from "@/services/voice-service";
import { smsService, ConversationListItem, SMSConfig } from "@/services/sms-service";
import { whatsappService, WhatsAppConversationListItem, WhatsAppConfig } from "@/services/whatsapp-service";
import { AudioPlayer } from "@/components/audio-player";
import apiClient from "@/lib/api-client";

// Email type (simplified from email service)
interface Email {
  id: string;
  lead_id: string | null;
  direction: string;
  from_email: string;
  to_email: string;
  subject: string;
  is_read: boolean;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

// Unified communication item
interface CommunicationItem {
  id: string;
  type: "call" | "sms" | "email" | "whatsapp";
  lead_id: string | null;
  lead_name?: string;
  direction: "inbound" | "outbound";
  timestamp: string;
  preview: string;
  status?: string;
  is_read?: boolean;
  raw: CallLog | ConversationListItem | Email | WhatsAppConversationListItem;
}

export default function UnifiedInboxPage() {
  const [activeTab, setActiveTab] = useState<"all" | "calls" | "sms" | "whatsapp" | "email">("all");
  const [loading, setLoading] = useState(true);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [smsConfig, setSmsConfig] = useState<SMSConfig | null>(null);
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig | null>(null);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [smsConversations, setSmsConversations] = useState<ConversationListItem[]>([]);
  const [whatsappConversations, setWhatsappConversations] = useState<WhatsAppConversationListItem[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedItem, setSelectedItem] = useState<CommunicationItem | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const recordingObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([
      voiceService.getConfig().catch((): VoiceConfig => ({
        voice_enabled: false,
        phone_number: null,
        recording_enabled: false,
        azure_storage_configured: false,
      })),
      smsService.getConfig().catch(() => ({ sms_enabled: false, phone_number: null })),
      whatsappService.getConfig().catch(() => ({ whatsapp_enabled: false, phone_number: null }))
    ]).then(([voice, sms, wa]) => {
      setVoiceConfig(voice);
      setSmsConfig(sms);
      setWhatsappConfig(wa);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (recordingObjectUrlRef.current) {
        URL.revokeObjectURL(recordingObjectUrlRef.current);
        recordingObjectUrlRef.current = null;
      }
    };
  }, []);
  
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const promises: Promise<any>[] = [];
      if (voiceConfig?.voice_enabled) {
        promises.push(voiceService.listCalls({ page_size: 50 }).catch(() => ({ items: [] })));
      } else {
        promises.push(Promise.resolve({ items: [] }));
      }
      if (smsConfig?.sms_enabled) {
        promises.push(smsService.listConversations({ limit: 50 }).catch(() => ({ items: [], total_unread: 0 })));
      } else {
        promises.push(Promise.resolve({ items: [], total_unread: 0 }));
      }
      if (whatsappConfig?.whatsapp_enabled) {
        promises.push(whatsappService.listConversations({ limit: 50 }).catch(() => ({ items: [], total_unread: 0 })));
      } else {
        promises.push(Promise.resolve({ items: [], total_unread: 0 }));
      }
      promises.push(apiClient.get("/emails", { params: { page_size: 50 } }).catch(() => ({ data: { items: [] } })));

      const [callsRes, smsRes, waRes, emailsRes] = await Promise.all(promises);
      setCalls(callsRes.items || []);
      setSmsConversations(smsRes.items || []);
      setWhatsappConversations(waRes.items || []);
      setEmails(emailsRes.data?.items || []);
    } catch (err) {
      console.error("Failed to load communications:", err);
    } finally {
      setLoading(false);
    }
  }, [voiceConfig?.voice_enabled, smsConfig?.sms_enabled, whatsappConfig?.whatsapp_enabled]);
  
  useEffect(() => {
    if (voiceConfig !== null && smsConfig !== null && whatsappConfig !== null) {
      loadAll();
    }
  }, [voiceConfig, smsConfig, whatsappConfig, loadAll]);
  
  // Build unified list
  const buildUnifiedList = (): CommunicationItem[] => {
    const items: CommunicationItem[] = [];
    
    // Add calls
    calls.forEach((call) => {
      items.push({
        id: `call-${call.id}`,
        type: "call",
        lead_id: call.lead_id,
        lead_name: call.lead_name || undefined,
        direction: call.direction as "inbound" | "outbound",
        timestamp: call.created_at,
        preview: `${call.direction === "inbound" ? "Incoming" : "Outgoing"} call - ${formatDuration(call.duration_seconds)}`,
        status: call.status,
        raw: call
      });
    });
    
    smsConversations.forEach((conv) => {
      items.push({
        id: `sms-${conv.lead_id}`,
        type: "sms",
        lead_id: conv.lead_id,
        lead_name: conv.lead_name,
        direction: conv.last_message.direction as "inbound" | "outbound",
        timestamp: conv.last_message.created_at,
        preview: conv.last_message.body,
        is_read: conv.unread_count === 0,
        raw: conv
      });
    });

    whatsappConversations.forEach((conv) => {
      items.push({
        id: `whatsapp-${conv.lead_id}`,
        type: "whatsapp",
        lead_id: conv.lead_id,
        lead_name: conv.lead_name,
        direction: conv.last_message.direction as "inbound" | "outbound",
        timestamp: conv.last_message.created_at,
        preview: conv.last_message.body,
        is_read: conv.unread_count === 0,
        raw: conv
      });
    });
    
    // Add emails
    emails.forEach((email) => {
      items.push({
        id: `email-${email.id}`,
        type: "email",
        lead_id: email.lead_id,
        direction: email.direction as "inbound" | "outbound",
        timestamp: email.sent_at || email.received_at || email.created_at,
        preview: email.subject || "(No subject)",
        is_read: email.is_read,
        raw: email
      });
    });
    
    // Sort by timestamp (newest first)
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    if (activeTab !== "all") {
      return items.filter((item) => {
        if (activeTab === "calls") return item.type === "call";
        if (activeTab === "sms") return item.type === "sms";
        if (activeTab === "whatsapp") return item.type === "whatsapp";
        if (activeTab === "email") return item.type === "email";
        return true;
      });
    }
    
    return items;
  };
  
  const formatDuration = (seconds: number): string => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };
  
  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isToday(date)) {
      return format(date, "h:mm a");
    }
    if (isYesterday(date)) {
      return "Yesterday";
    }
    return format(date, "MMM d");
  };
  
  const getIcon = (item: CommunicationItem) => {
    if (item.type === "call") {
      const call = item.raw as CallLog;
      if (call.status === "no-answer" || call.status === "busy") {
        return <PhoneMissed className="h-4 w-4 text-red-500" />;
      }
      if (item.direction === "inbound") {
        return <PhoneIncoming className="h-4 w-4 text-green-500" />;
      }
      return <PhoneOutgoing className="h-4 w-4 text-blue-500" />;
    }
    if (item.type === "sms") {
      return <MessageSquare className="h-4 w-4 text-purple-500" />;
    }
    if (item.type === "whatsapp") {
      return <MessageCircle className="h-4 w-4 text-[#25D366]" />;
    }
    if (item.type === "email") {
      return item.is_read
        ? <MailOpen className="h-4 w-4 text-gray-400" />
        : <Mail className="h-4 w-4 text-blue-500" />;
    }
    return null;
  };
  
  // Handle item selection
  const handleSelect = async (item: CommunicationItem) => {
    // Revoke previous blob URL if we created one
    if (recordingObjectUrlRef.current) {
      URL.revokeObjectURL(recordingObjectUrlRef.current);
      recordingObjectUrlRef.current = null;
    }
    setSelectedItem(item);
    setRecordingUrl(null);

    if (item.type !== "call") return;
    const call = item.raw as CallLog;
    if (!call.recording_url) return;

    try {
      const result = await voiceService.getRecordingUrl(call.id);
      const url = result.recording_url;
      const isProxyUrl = url.includes("/voice/calls/") && url.includes("/recording") && !url.startsWith("blob:");
      if (isProxyUrl) {
        const res = await apiClient.get<Blob>(url, { responseType: "blob" });
        const blob = res.data;
        const objectUrl = URL.createObjectURL(blob);
        recordingObjectUrlRef.current = objectUrl;
        setRecordingUrl(objectUrl);
      } else {
        setRecordingUrl(url);
      }
    } catch (err) {
      console.error("Failed to get recording URL:", err);
    }
  };
  
  const items = buildUnifiedList();
  
  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-muted-foreground">All your communications in one place</p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="calls">
            <Phone className="h-4 w-4 mr-1" />
            Calls
          </TabsTrigger>
          <TabsTrigger value="sms">
            <MessageSquare className="h-4 w-4 mr-1" />
            SMS
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageCircle className="h-4 w-4 mr-1" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="h-4 w-4 mr-1" />
            Email
          </TabsTrigger>
        </TabsList>
        
        <Card className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className={`w-full md:w-96 lg:w-[420px] border-r overflow-y-auto ${selectedItem ? "hidden md:block" : ""}`}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === "calls" && !voiceConfig?.voice_enabled ? (
              <ComingSoonMessage
                icon={<Phone className="h-10 w-10" />}
                title="Voice calling not configured"
                description="Call logs and in-app calling need Twilio voice configured in the backend .env. Ask your administrator to add the required variables."
                missingCredentials={voiceConfig?.missing_credentials}
              />
            ) : activeTab === "sms" && !smsConfig?.sms_enabled ? (
              <ComingSoonMessage
                icon={<MessageSquare className="h-10 w-10" />}
                title="SMS Messaging Coming Soon"
                description="In-app texting is being configured. You can still text leads from your phone."
              />
            ) : activeTab === "whatsapp" && !whatsappConfig?.whatsapp_enabled ? (
              <ComingSoonMessage
                icon={<MessageCircle className="h-10 w-10" />}
                title="WhatsApp Coming Soon"
                description="WhatsApp messaging is being configured."
              />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Mail className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No communications yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      "w-full flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors",
                      selectedItem?.id === item.id && "bg-muted",
                      item.type !== "call" && !item.is_read && "bg-primary/5"
                    )}
                  >
                    {/* Icon */}
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {getIcon(item)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("font-medium truncate", !item.is_read && item.type !== "call" && "font-semibold")}>
                          {item.lead_name || "Unknown"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatTime(item.timestamp)}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {item.type.toUpperCase()}
                        </Badge>
                        <p className="text-sm text-muted-foreground truncate">{item.preview}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Detail View */}
          <div className={`flex-1 ${!selectedItem ? "hidden md:flex" : "flex"}`}>
            {selectedItem ? (
              <div className="flex flex-col h-full w-full">
                {/* Detail Header */}
                <div className="flex items-center justify-between p-4 border-b">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="md:hidden"
                      onClick={() => setSelectedItem(null)}
                    >
                      Back
                    </Button>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{selectedItem.lead_name || "Unknown"}</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedItem.type === "call" ? "Voice Call" : selectedItem.type === "sms" ? "SMS Message" : selectedItem.type === "whatsapp" ? "WhatsApp" : "Email"}
                      </p>
                    </div>
                  </div>
                  
                  {selectedItem.lead_id && (
                    <Link href={`/leads/${selectedItem.lead_id}`}>
                      <Button variant="outline" size="sm">
                        View Lead
                        <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
                
                {/* Detail Content */}
                <div className="flex-1 p-6 overflow-y-auto">
                  {selectedItem.type === "call" && (
                    <CallDetail
                      call={selectedItem.raw as CallLog}
                      recordingUrl={recordingUrl}
                    />
                  )}
                  
                  {selectedItem.type === "sms" && (
                    <SMSDetail conversation={selectedItem.raw as ConversationListItem} />
                  )}

                  {selectedItem.type === "whatsapp" && (
                    <WhatsAppDetail conversation={selectedItem.raw as WhatsAppConversationListItem} />
                  )}
                  
                  {selectedItem.type === "email" && (
                    <EmailDetail email={selectedItem.raw as Email} />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Mail className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Select an item to view details</p>
              </div>
            )}
          </div>
        </Card>
      </Tabs>
    </div>
  );
}

// Call Detail Component
function CallDetail({ call, recordingUrl }: { call: CallLog; recordingUrl: string | null }) {
  return (
    <div className="space-y-6">
      {/* Call Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Direction</p>
          <p className="font-medium capitalize">{call.direction}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Status</p>
          <Badge variant={call.status === "completed" ? "default" : "secondary"}>
            {call.status}
          </Badge>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">From</p>
          <p className="font-medium">{call.from_number}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">To</p>
          <p className="font-medium">{call.to_number}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Duration</p>
          <p className="font-medium">{Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Date</p>
          <p className="font-medium">{format(new Date(call.created_at), "PPpp")}</p>
        </div>
      </div>
      
      {/* Recording */}
      {recordingUrl && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Recording</p>
          <AudioPlayer src={recordingUrl} title="Call Recording" />
        </div>
      )}
      
      {/* Notes */}
      {call.notes && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Notes</p>
          <p className="text-sm bg-muted p-3 rounded-md">{call.notes}</p>
        </div>
      )}
    </div>
  );
}

// SMS Detail Component
function SMSDetail({ conversation }: { conversation: ConversationListItem }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Contact</p>
        <p className="font-medium">{conversation.lead_name}</p>
        <p className="text-sm text-muted-foreground">{conversation.lead_phone}</p>
      </div>
      
      <div>
        <p className="text-sm text-muted-foreground mb-2">Last Message</p>
        <div className={cn(
          "p-3 rounded-lg max-w-[80%]",
          conversation.last_message.direction === "outbound"
            ? "bg-primary text-primary-foreground ml-auto"
            : "bg-muted"
        )}>
          <p className="text-sm">{conversation.last_message.body}</p>
          <p className="text-[10px] mt-1 opacity-70">
            {format(new Date(conversation.last_message.created_at), "PPpp")}
          </p>
        </div>
      </div>
      
      <Link href={`/sms?lead=${conversation.lead_id}`}>
        <Button className="w-full">
          <MessageSquare className="h-4 w-4 mr-2" />
          Open Conversation
        </Button>
      </Link>
    </div>
  );
}

function WhatsAppDetail({ conversation }: { conversation: WhatsAppConversationListItem }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Contact</p>
        <p className="font-medium">{conversation.lead_name}</p>
        <p className="text-sm text-muted-foreground">{conversation.lead_phone}</p>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">Last Message</p>
        <div className={cn(
          "p-3 rounded-lg max-w-[80%]",
          conversation.last_message.direction === "outbound"
            ? "bg-[#005c4b] text-white ml-auto"
            : "bg-muted"
        )}>
          <p className="text-sm">{conversation.last_message.body}</p>
          <p className="text-[10px] mt-1 opacity-70">
            {format(new Date(conversation.last_message.created_at), "PPpp")}
          </p>
        </div>
      </div>
      <Link href={`/whatsapp?lead=${conversation.lead_id}`}>
        <Button className="w-full bg-[#25D366] hover:bg-[#20bd5a]">
          <MessageCircle className="h-4 w-4 mr-2" />
          Open in WhatsApp
        </Button>
      </Link>
    </div>
  );
}

// Email Detail Component
function EmailDetail({ email }: { email: Email }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">From</p>
          <p className="font-medium">{email.from_email}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">To</p>
          <p className="font-medium">{email.to_email}</p>
        </div>
      </div>
      
      <div>
        <p className="text-sm text-muted-foreground">Subject</p>
        <p className="font-medium">{email.subject || "(No subject)"}</p>
      </div>
      
      <div>
        <p className="text-sm text-muted-foreground">Date</p>
        <p className="font-medium">
          {format(new Date(email.sent_at || email.received_at || email.created_at), "PPpp")}
        </p>
      </div>
      
      {email.lead_id && (
        <Link href={`/leads/${email.lead_id}?tab=emails`}>
          <Button className="w-full">
            <Mail className="h-4 w-4 mr-2" />
            View Full Email
          </Button>
        </Link>
      )}
    </div>
  );
}

// Coming Soon Message Component
function ComingSoonMessage({
  icon,
  title,
  description,
  missingCredentials,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  missingCredentials?: string[] | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className="bg-primary/10 rounded-full p-4 mb-4 text-primary">
        {icon}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground max-w-[280px]">{description}</p>
      {missingCredentials && missingCredentials.length > 0 && (
        <div className="mt-3 text-left max-w-[280px]">
          <p className="text-xs font-medium text-muted-foreground mb-1">Missing in backend .env:</p>
          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
            {missingCredentials.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
