"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Loader2, ArrowLeft, FileText, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WhatsAppMessageBubble } from "./whatsapp-message-bubble";
import { MediaUploadButton } from "./media-upload-button";
import { VoiceRecorder } from "./voice-recorder";
import { CallRecordingCard } from "./call-recording-card";
import { MessageComposer } from "@/components/sms/message-composer";
import {
  WhatsAppMessage,
  WhatsAppTemplateItem,
  TimelineItem,
  whatsappService,
} from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";
import { useWebSocketEvent } from "@/hooks/use-websocket";
import { useCallLeadOptional } from "@/contexts/call-lead-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix Select must not use empty string as a value. */
const TEMPLATE_SELECT_NONE = "__none__";

/** WebSocket payload for whatsapp:received and whatsapp:sent events */
interface WsMessagePayload {
  message_id: string;
  lead_id: string;
  body_preview?: string;
  from_number?: string;
  has_media?: boolean;
  message?: {
    id: string;
    lead_id: string;
    user_id: string | null;
    direction: string;
    from_number: string;
    to_number: string;
    body: string;
    status: string;
    is_read: boolean;
    created_at: string | null;
    sent_at: string | null;
    delivered_at: string | null;
    media_urls?: string[];
    media_content_types?: string[];
  };
}

/** WebSocket payload for whatsapp:status events */
interface WsStatusPayload {
  message_id: string;
  lead_id: string;
  status: string;
  delivered_at?: string | null;
  read_at?: string | null;
}

interface WhatsAppConversationThreadProps {
  leadId: string;
  leadName: string;
  leadPhone?: string | null;
  onBack?: () => void;
  onMessageSent?: () => void;
}

export function WhatsAppConversationThread({
  leadId,
  leadName,
  leadPhone,
  onBack,
  onMessageSent,
}: WhatsAppConversationThreadProps) {
  const { toast } = useToast();
  const callLeadCtx = useCallLeadOptional();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const previousLeadIdRef = useRef<string | null>(null);
  const shouldScrollRef = useRef(true);
  // Track message IDs we sent ourselves to prevent WebSocket duplicates
  const sentMessageIdsRef = useRef<Set<string>>(new Set());
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplateItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateItem | null>(null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [sessionWindow, setSessionWindow] = useState<{
    within_window: boolean;
    last_inbound_at: string | null;
  } | null>(null);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);

  const loadSessionWindow = useCallback(async () => {
    try {
      const sw = await whatsappService.getSessionWindow(leadId);
      setSessionWindow({
        within_window: sw.within_window,
        last_inbound_at: sw.last_inbound_at ?? null,
      });
    } catch {
      setSessionWindow({ within_window: false, last_inbound_at: null });
    }
  }, [leadId]);

  const loadConversation = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    try {
      if (!silent) {
        setError(null);
      }
      const timeline = await whatsappService.getTimeline(leadId);
      setTimelineItems(timeline.items);
    } catch (err) {
      console.error(err);
      if (!silent) {
        setError("Failed to load chat");
        toast({
          title: "Could not load chat",
          description: "Check your connection and try again.",
          variant: "destructive",
        });
      }
    } finally {
      setInitialLoading(false);
    }
  }, [leadId, toast]);

  // When leadId changes, reset state and load new conversation instantly
  useEffect(() => {
    const isNewLead = previousLeadIdRef.current !== null && previousLeadIdRef.current !== leadId;
    previousLeadIdRef.current = leadId;
    
    // Clear old data when switching leads for a clean slate
    if (isNewLead) {
      setTimelineItems([]);
    }
    setSessionWindow(null);
    void loadConversation();
  }, [leadId, loadConversation]);

  useEffect(() => {
    void loadSessionWindow();
  }, [leadId, loadSessionWindow]);

  // Real-time status updates (delivered/read ticks) - update locally, no API call
  useWebSocketEvent<WsStatusPayload>(
    "whatsapp:status",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      // Update the message status in local state instantly
      setTimelineItems((prev) =>
        prev.map((item) =>
          item.item_type === "message" && item.message?.id === data.message_id
            ? {
                ...item,
                message: {
                  ...item.message,
                  status: data.status,
                  delivered_at: data.delivered_at ?? item.message.delivered_at,
                },
              }
            : item
        )
      );
    },
    [leadId]
  );

  // Real-time incoming messages - add to state instantly, no API call
  useWebSocketEvent<WsMessagePayload>(
    "whatsapp:received",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      // If we have the full message object, add it directly
      if (data.message) {
        const newMsg: WhatsAppMessage = {
          id: data.message.id,
          lead_id: data.message.lead_id,
          user_id: data.message.user_id,
          direction: data.message.direction as "inbound" | "outbound",
          from_number: data.message.from_number,
          to_number: data.message.to_number,
          body: data.message.body,
          status: data.message.status,
          is_read: data.message.is_read,
          created_at: data.message.created_at || new Date().toISOString(),
          sent_at: data.message.sent_at,
          delivered_at: data.message.delivered_at,
          media_urls: data.message.media_urls || [],
          media_content_types: data.message.media_content_types || [],
        };
        const newItem: TimelineItem = {
          item_type: "message",
          id: newMsg.id,
          created_at: newMsg.created_at,
          message: newMsg,
        };
        // Dedupe: only add if not already present
        setTimelineItems((prev) => {
          if (prev.some((item) => item.id === newMsg.id)) return prev;
          return [...prev, newItem];
        });
        // Refresh session window since inbound message extends it
        void loadSessionWindow();
      } else {
        // Fallback: if no full message, do a silent API refresh
        void loadConversation({ silent: true });
        void loadSessionWindow();
      }
    },
    [leadId, loadConversation, loadSessionWindow]
  );

  // Real-time sent messages (from other tabs/users) - add to state instantly
  useWebSocketEvent<WsMessagePayload>(
    "whatsapp:sent",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      if (data.message) {
        const messageId = data.message.id;
        
        // Skip if we already handled this via our own API response
        if (sentMessageIdsRef.current.has(messageId)) {
          sentMessageIdsRef.current.delete(messageId); // Clean up
          return;
        }
        
        const newMsg: WhatsAppMessage = {
          id: messageId,
          lead_id: data.message.lead_id,
          user_id: data.message.user_id,
          direction: data.message.direction as "inbound" | "outbound",
          from_number: data.message.from_number,
          to_number: data.message.to_number,
          body: data.message.body,
          status: data.message.status,
          is_read: data.message.is_read,
          created_at: data.message.created_at || new Date().toISOString(),
          sent_at: data.message.sent_at,
          delivered_at: data.message.delivered_at,
          media_urls: data.message.media_urls || [],
          media_content_types: data.message.media_content_types || [],
        };
        const newItem: TimelineItem = {
          item_type: "message",
          id: newMsg.id,
          created_at: newMsg.created_at,
          message: newMsg,
        };
        
        // Check if there's a temp (optimistic) message to replace
        setTimelineItems((prev) => {
          // Already have this exact message ID?
          if (prev.some((item) => item.id === newMsg.id)) return prev;
          
          // Find temp message with matching body (optimistic update we sent)
          const tempIndex = prev.findIndex(
            (item) =>
              item.item_type === "message" &&
              item.id.startsWith("temp_") &&
              item.message?.direction === "outbound" &&
              item.message?.body === newMsg.body
          );
          
          if (tempIndex >= 0) {
            // Replace temp message with real one
            const updated = [...prev];
            updated[tempIndex] = newItem;
            return updated;
          }
          
          // No temp to replace, add new
          return [...prev, newItem];
        });
      } else {
        // Fallback
        void loadConversation({ silent: true });
      }
    },
    [leadId, loadConversation]
  );

  // Real-time call completed events - add call to timeline instantly
  useWebSocketEvent<{
    call_log_id: string;
    lead_id: string;
    call: {
      id: string;
      direction: string;
      from_number: string;
      to_number: string;
      status: string;
      duration_seconds: number | null;
      outcome: string | null;
      notes: string | null;
      recording_url: string | null;
      started_at: string | null;
      ended_at: string | null;
    };
  }>(
    "call:completed",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      if (data.call) {
        const newItem: TimelineItem = {
          item_type: "call",
          id: data.call.id,
          created_at: data.call.started_at || new Date().toISOString(),
          call: {
            id: data.call.id,
            direction: data.call.direction as "inbound" | "outbound",
            from_number: data.call.from_number,
            to_number: data.call.to_number,
            status: data.call.status,
            duration_seconds: data.call.duration_seconds ?? 0,
            outcome: data.call.outcome,
            notes: data.call.notes,
            recording_url: data.call.recording_url,
            recording_duration_seconds: null,
            started_at: data.call.started_at ?? new Date().toISOString(),
            answered_at: null,
            ended_at: data.call.ended_at,
          },
        };
        // Add to timeline if not already present
        setTimelineItems((prev) => {
          if (prev.some((item) => item.id === data.call.id)) return prev;
          return [...prev, newItem];
        });
      }
    },
    [leadId]
  );

  // Real-time recording ready - update call with recording URL
  useWebSocketEvent<{
    call_log_id: string;
    lead_id: string;
    recording_url: string;
    recording_duration_seconds: number;
  }>(
    "call:recording_ready",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      // Update existing call item with recording URL
      setTimelineItems((prev) =>
        prev.map((item) =>
          item.item_type === "call" && item.id === data.call_log_id && item.call
            ? {
                ...item,
                call: {
                  ...item.call,
                  recording_url: data.recording_url,
                  duration_seconds: data.recording_duration_seconds || item.call.duration_seconds,
                },
              }
            : item
        )
      );
    },
    [leadId]
  );

  // Scroll to bottom helper
  const scrollToBottom = useCallback((instant = false) => {
    if (!shouldScrollRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ 
        behavior: instant ? "instant" : "smooth",
        block: "end"
      });
    });
  }, []);

  // Scroll to bottom when timeline items change
  useEffect(() => {
    scrollToBottom(true);
  }, [timelineItems.length, scrollToBottom]);

  // Also scroll when initial load completes
  useEffect(() => {
    if (!initialLoading && timelineItems.length > 0) {
      setTimeout(() => scrollToBottom(true), 100);
    }
  }, [initialLoading, scrollToBottom]);

  const freeFormAllowed =
    sessionWindow !== null && sessionWindow.within_window;

  // Generate temporary ID for optimistic updates
  const generateTempId = () => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const handleSend = async (body: string) => {
    if (!freeFormAllowed) return;
    
    // Create optimistic message IMMEDIATELY
    const tempId = generateTempId();
    const optimisticMessage: WhatsAppMessage = {
      id: tempId,
      lead_id: leadId,
      user_id: null,
      direction: "outbound",
      from_number: "",
      to_number: leadPhone || "",
      body,
      status: "sending",
      is_read: true,
      created_at: new Date().toISOString(),
      sent_at: null,
      delivered_at: null,
    };
    const optimisticItem: TimelineItem = {
      item_type: "message",
      id: tempId,
      created_at: optimisticMessage.created_at,
      message: optimisticMessage,
    };
    
    // Add to UI INSTANTLY - no await
    setTimelineItems((prev) => [...prev, optimisticItem]);
    
    // Send via API in background (don't await)
    whatsappService.sendToLead(leadId, body, leadPhone ?? undefined)
      .then((result) => {
        if (result.success && result.message_id) {
          // Track this message ID to prevent WebSocket duplicate
          sentMessageIdsRef.current.add(result.message_id);
          
          // Replace temp message with real one
          setTimelineItems((prev) =>
            prev.map((item) =>
              item.id === tempId
                ? {
                    ...item,
                    id: result.message_id!,
                    message: item.message
                      ? { ...item.message, id: result.message_id!, status: "sent", sent_at: new Date().toISOString() }
                      : undefined,
                  }
                : item
            )
          );
          void loadSessionWindow();
          onMessageSent?.();
        } else {
          // Mark as failed
          setTimelineItems((prev) =>
            prev.map((item) =>
              item.id === tempId && item.message
                ? { ...item, message: { ...item.message, status: "failed" } }
                : item
            )
          );
          
          const isOutsideWindow =
            result.error_code === "OUTSIDE_SESSION_WINDOW" ||
            result.error_code === "63016" ||
            (result.error?.includes("63016") ?? false);
          if (isOutsideWindow) {
            setTimelineItems((prev) => prev.filter((item) => item.id !== tempId));
            void loadSessionWindow();
            toast({
              title: "Outside 24-hour window",
              description: "Cannot send free-form message. Use a template.",
              variant: "destructive",
            });
            setTemplateModalOpen(true);
          } else {
            toast({
              title: "Failed to send",
              description: result.error || "Could not send message",
              variant: "destructive",
            });
          }
        }
      })
      .catch(() => {
        setTimelineItems((prev) =>
          prev.map((item) =>
            item.id === tempId && item.message
              ? { ...item, message: { ...item.message, status: "failed" } }
              : item
          )
        );
        toast({
          title: "Error",
          description: "Failed to send message",
          variant: "destructive",
        });
      });
  };

  const loadTemplates = useCallback(async () => {
    try {
      const list = await whatsappService.listTemplates();
      setTemplates(list);
      setSelectedTemplate(null);
      setTemplateVariables({});
    } catch {
      toast({
        title: "Could not load templates",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    if (templateModalOpen) loadTemplates();
  }, [templateModalOpen, loadTemplates]);

  const handleSendTemplate = async () => {
    if (!selectedTemplate) return;
    const vars: Record<string, string> = {};
    selectedTemplate.variable_names.forEach((key) => {
      vars[key] = templateVariables[key] ?? "";
    });
    setSendingTemplate(true);
    try {
      const result = await whatsappService.sendTemplateToLead(
        leadId,
        selectedTemplate.content_sid,
        vars,
        leadPhone ?? undefined,
        selectedTemplate.name
      );
      if (result.success && result.message_id) {
        toast({ title: "Template sent" });
        setTemplateModalOpen(false);
        setSelectedTemplate(null);
        setTemplateVariables({});
        await loadConversation();
        await loadSessionWindow();
        onMessageSent?.();
      } else {
        toast({
          title: "Failed to send template",
          description: result.error || "Could not send",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to send template",
        variant: "destructive",
      });
    } finally {
      setSendingTemplate(false);
    }
  };

  const sessionWindowLoading = sessionWindow === null;

  // Group timeline items by date
  const groupedItems = timelineItems.reduce((groups, item) => {
    const date = new Date(item.created_at);
    const dateKey = isToday(date) ? "Today" : isYesterday(date) ? "Yesterday" : format(date, "MMMM d, yyyy");
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(item);
    return groups;
  }, {} as Record<string, TimelineItem[]>);

  // Only show full loading spinner on very first load
  if (initialLoading && timelineItems.length === 0) {
    return (
      <div className="flex flex-col h-full w-full bg-[#0b141a]">
        {/* Header placeholder */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#202c33] border-b border-[#2a3942]">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="text-[#e9edef] hover:bg-white/10">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="h-10 w-10 rounded-full bg-[#00a884]/30 flex items-center justify-center shrink-0">
            <span className="text-lg font-medium text-[#e9edef]">
              {leadName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-[#e9edef] truncate">{leadName}</h2>
            {leadPhone && <p className="text-xs text-[#8696a0] truncate">{leadPhone}</p>}
          </div>
        </div>
        {/* Loading area */}
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#8696a0]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4">
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => void loadConversation()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#0b141a]">
      {/* Header - WhatsApp style dark bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#202c33] border-b border-[#2a3942]">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="text-[#e9edef] hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="h-10 w-10 rounded-full bg-[#00a884]/30 flex items-center justify-center shrink-0">
          <span className="text-lg font-medium text-[#e9edef]">
            {leadName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[#e9edef] truncate">{leadName}</h2>
          {leadPhone && (
            <p className="text-xs text-[#8696a0] truncate">{leadPhone}</p>
          )}
        </div>
        {leadPhone && callLeadCtx && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              callLeadCtx.setCallLead({
                phone: leadPhone,
                leadId: leadId,
                leadName: leadName,
              });
              toast({ title: "Opening softphone...", description: `Calling ${leadName}` });
            }}
            className="text-[#8696a0] hover:text-[#e9edef] hover:bg-white/10"
            title="Call lead"
          >
            <Phone className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Messages area - WhatsApp chat background */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2317222d' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {timelineItems.length === 0 ? (
          <div className="text-center text-[#8696a0] py-8 px-4">
            {sessionWindowLoading
              ? "No messages yet."
              : freeFormAllowed
                ? "No messages yet. Send a message to start the conversation."
                : "No messages yet. Send an approved WhatsApp template to start the conversation, or wait for the contact to message you."}
          </div>
        ) : (
          Object.entries(groupedItems).map(([date, items]) => (
            <div key={date}>
              <div className="flex items-center gap-4 my-4">
                <div className="flex-1 h-px bg-[#2a3942]" />
                <span className="text-xs text-[#8696a0]">{date}</span>
                <div className="flex-1 h-px bg-[#2a3942]" />
              </div>
              <div className="space-y-1.5">
                {items.map((item) => (
                  item.item_type === "message" && item.message ? (
                    <WhatsAppMessageBubble key={item.id} message={item.message} />
                  ) : item.item_type === "call" && item.call ? (
                    <CallRecordingCard key={item.id} call={item.call} />
                  ) : null
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer - dark bar */}
      <div className="border-t border-[#2a3942] bg-[#202c33] px-2 py-2">
        {!sessionWindowLoading && !freeFormAllowed && (
          <div
            className="mb-2 rounded-md border border-[#3b4a54] bg-[#0b141a]/80 px-3 py-2 text-xs text-[#8696a0]"
            role="status"
          >
            24-hour window closed. Use template to message.
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {/* Hide other inputs when voice recording is active */}
          {!isVoiceRecording && (
            <>
              <MediaUploadButton
                leadId={leadId}
                disabled={sessionWindowLoading}
                onMediaSent={loadConversation}
                onOptimisticSend={(tempId, contentType, caption) => {
                  const optimisticMessage: WhatsAppMessage = {
                    id: tempId,
                    lead_id: leadId,
                    user_id: null,
                    direction: "outbound",
                    from_number: "",
                    to_number: leadPhone || "",
                    body: caption || "",
                    status: "sending",
                    is_read: true,
                    created_at: new Date().toISOString(),
                    sent_at: null,
                    delivered_at: null,
                    media_urls: ["media-pending"],
                    media_content_types: [contentType],
                  };
                  setTimelineItems((prev) => [...prev, {
                    item_type: "message",
                    id: tempId,
                    created_at: optimisticMessage.created_at,
                    message: optimisticMessage,
                  }]);
                }}
                onSendSuccess={(tempId, realId) => {
                  sentMessageIdsRef.current.add(realId);
                  setTimelineItems((prev) =>
                    prev.map((item) =>
                      item.id === tempId
                        ? {
                            ...item,
                            id: realId,
                            message: item.message
                              ? { ...item.message, id: realId, status: "sent", sent_at: new Date().toISOString() }
                              : undefined,
                          }
                        : item
                    )
                  );
                }}
                onSendFailed={(tempId) => {
                  setTimelineItems((prev) =>
                    prev.map((item) =>
                      item.id === tempId && item.message
                        ? { ...item, message: { ...item.message, status: "failed" } }
                        : item
                    )
                  );
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 rounded-full",
                  freeFormAllowed && !sessionWindowLoading
                    ? "text-[#8696a0] hover:text-white hover:bg-[#3b4a54]"
                    : "bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                )}
                onClick={() => setTemplateModalOpen(true)}
                title="Send template"
              >
                <FileText className="h-5 w-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <MessageComposer
                  onSend={handleSend}
                  disabled={sessionWindowLoading || !freeFormAllowed}
                  placeholder={
                    sessionWindowLoading
                      ? "Checking..."
                      : freeFormAllowed
                        ? "Message"
                        : "Use template..."
                  }
                  className="border-0 bg-transparent p-0 gap-1.5 [&_textarea]:min-h-[36px] [&_textarea]:max-h-[120px] [&_textarea]:rounded-2xl [&_textarea]:border-0 [&_textarea]:bg-[#2a3942] [&_textarea]:text-[#e9edef] [&_textarea]:placeholder:text-[#8696a0] [&_textarea]:px-3 [&_textarea]:py-2 [&_button]:h-9 [&_button]:w-9 [&_button]:rounded-full [&_button]:bg-[#00a884] [&_button]:hover:bg-[#00a884]/90 [&_button]:text-white [&_button]:shrink-0"
                />
              </div>
            </>
          )}
          <VoiceRecorder
            leadId={leadId}
            disabled={sessionWindowLoading}
            onVoiceSent={loadConversation}
            onRecordingStateChange={setIsVoiceRecording}
            onOptimisticSend={(tempId, duration) => {
              // Add optimistic voice message immediately
              const optimisticMessage: WhatsAppMessage = {
                id: tempId,
                lead_id: leadId,
                user_id: null,
                direction: "outbound",
                from_number: "",
                to_number: leadPhone || "",
                body: "",
                status: "sending",
                is_read: true,
                created_at: new Date().toISOString(),
                sent_at: null,
                delivered_at: null,
                media_urls: ["voice-message-pending"],
                media_content_types: ["audio/webm"],
              };
              setTimelineItems((prev) => [...prev, {
                item_type: "message",
                id: tempId,
                created_at: optimisticMessage.created_at,
                message: optimisticMessage,
              }]);
            }}
            onSendSuccess={(tempId, realId) => {
              sentMessageIdsRef.current.add(realId);
              setTimelineItems((prev) =>
                prev.map((item) =>
                  item.id === tempId
                    ? {
                        ...item,
                        id: realId,
                        message: item.message
                          ? { ...item.message, id: realId, status: "sent", sent_at: new Date().toISOString() }
                          : undefined,
                      }
                    : item
                )
              );
            }}
            onSendFailed={(tempId) => {
              setTimelineItems((prev) =>
                prev.map((item) =>
                  item.id === tempId && item.message
                    ? { ...item, message: { ...item.message, status: "failed" } }
                    : item
                )
              );
            }}
          />
        </div>
      </div>

      <Dialog open={templateModalOpen} onOpenChange={setTemplateModalOpen}>
        <DialogContent className="bg-[#202c33] border-[#2a3942] text-[#e9edef] max-w-md w-[min(100%,calc(100vw-2rem))] max-h-[min(90vh,720px)] overflow-y-auto overflow-x-hidden gap-4 p-6 pr-12 sm:pr-14">
          <DialogHeader className="pr-2 shrink-0">
            <DialogTitle className="text-[#e9edef]">Send WhatsApp template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 min-w-0">
            <div className="min-w-0 space-y-2">
              <Label className="text-[#8696a0]">Template</Label>
              <Select
                value={selectedTemplate?.id ?? TEMPLATE_SELECT_NONE}
                onValueChange={(id) => {
                  if (id === TEMPLATE_SELECT_NONE) {
                    setSelectedTemplate(null);
                    setTemplateVariables({});
                    return;
                  }
                  const t = templates.find((x) => x.id === id) ?? null;
                  setSelectedTemplate(t);
                  setTemplateVariables({});
                }}
              >
                <SelectTrigger className="w-full min-w-0 max-w-full bg-[#2a3942] border-[#3b4a54] text-[#e9edef]">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPLATE_SELECT_NONE}>Select a template…</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTemplate &&
              selectedTemplate.variable_names.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-[#8696a0]">Variables</Label>
                  {selectedTemplate.variable_names.map((key) => (
                    <div key={key}>
                      <Label className="text-xs text-[#8696a0]">
                        {key}
                      </Label>
                      <Input
                        className="bg-[#2a3942] border-[#2a3942] text-[#e9edef]"
                        value={templateVariables[key] ?? ""}
                        onChange={(e) =>
                          setTemplateVariables((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        placeholder={`Value for {{${key}}}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:flex-wrap shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplateModalOpen(false)}
                className="w-full sm:w-auto shrink-0 border-[#3b4a54] bg-[#2a3942] text-[#e9edef] hover:bg-[#3b4a54] hover:text-[#e9edef]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSendTemplate}
                disabled={!selectedTemplate || sendingTemplate}
                className="w-full sm:w-auto shrink-0 bg-[#00a884] hover:bg-[#00a884]/90 text-white"
              >
                {sendingTemplate ? "Sending…" : "Send template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
