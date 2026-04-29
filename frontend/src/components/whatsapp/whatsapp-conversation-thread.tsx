"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Loader2, ArrowLeft, FileText, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WhatsAppMessageBubble } from "./whatsapp-message-bubble";
import { MediaUploadButton } from "./media-upload-button";
import { VoiceRecorder } from "./voice-recorder";
import { MessageComposer } from "@/components/sms/message-composer";
import {
  WhatsAppMessage,
  WhatsAppTemplateItem,
  whatsappService,
} from "@/services/whatsapp-service";
import { useToast } from "@/hooks/use-toast";
import { useWebSocketEvent } from "@/hooks/use-websocket";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplateItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateItem | null>(null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [sessionWindow, setSessionWindow] = useState<{
    within_window: boolean;
    last_inbound_at: string | null;
  } | null>(null);

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
        setLoading(true);
        setError(null);
      }
      const conversation = await whatsappService.getConversation(leadId);
      setMessages(conversation.messages);
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
      if (!silent) setLoading(false);
    }
  }, [leadId, toast]);

  useEffect(() => {
    setSessionWindow(null);
  }, [leadId]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    void loadSessionWindow();
  }, [leadId, loadSessionWindow]);

  // Real-time status updates (delivered/read ticks) - update locally, no API call
  useWebSocketEvent<WsStatusPayload>(
    "whatsapp:status",
    (data) => {
      if (!data?.lead_id || String(data.lead_id) !== String(leadId)) return;
      // Update the message status in local state instantly
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.message_id
            ? {
                ...msg,
                status: data.status,
                delivered_at: data.delivered_at ?? msg.delivered_at,
              }
            : msg
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
        // Dedupe: only add if not already present
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
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
        // Dedupe: only add if not already present (handles optimistic updates)
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      } else {
        // Fallback
        void loadConversation({ silent: true });
      }
    },
    [leadId, loadConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const freeFormAllowed =
    sessionWindow !== null && sessionWindow.within_window;

  const handleSend = async (body: string) => {
    if (!freeFormAllowed) return;
    try {
      const result = await whatsappService.sendToLead(leadId, body, leadPhone ?? undefined);
      if (result.success && result.message_id) {
        const newMessage: WhatsAppMessage = {
          id: result.message_id,
          lead_id: leadId,
          user_id: null,
          direction: "outbound",
          from_number: "",
          to_number: leadPhone || "",
          body,
          status: "sent",
          is_read: true,
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          delivered_at: null,
        };
        setMessages((prev) => [...prev, newMessage]);
        void loadSessionWindow();
        onMessageSent?.();
      } else {
        const isOutsideWindow =
          result.error_code === "OUTSIDE_SESSION_WINDOW" ||
          result.error_code === "63016" ||
          (result.error?.includes("63016") ?? false);
        if (isOutsideWindow) {
          void loadSessionWindow();
          toast({
            title: "Outside 24-hour window",
            description:
              "Cannot send free-form message. Use a template to start the conversation.",
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
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    }
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
        leadPhone ?? undefined
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

  const groupedMessages = messages.reduce((groups, message) => {
    const date = new Date(message.created_at);
    const dateKey = isToday(date) ? "Today" : isYesterday(date) ? "Yesterday" : format(date, "MMMM d, yyyy");
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(message);
    return groups;
  }, {} as Record<string, WhatsAppMessage[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
    <div className="flex flex-col h-full bg-[#0b141a]">
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
        {leadPhone && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              window.open(`/voice?call=${encodeURIComponent(leadPhone)}&lead_id=${leadId}`, "_blank");
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
        {messages.length === 0 ? (
          <div className="text-center text-[#8696a0] py-8 px-4">
            {sessionWindowLoading
              ? "No messages yet."
              : freeFormAllowed
                ? "No messages yet. Send a message to start the conversation."
                : "No messages yet. Send an approved WhatsApp template to start the conversation, or wait for the contact to message you."}
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              <div className="flex items-center gap-4 my-4">
                <div className="flex-1 h-px bg-[#2a3942]" />
                <span className="text-xs text-[#8696a0]">{date}</span>
                <div className="flex-1 h-px bg-[#2a3942]" />
              </div>
              <div className="space-y-1.5">
                {msgs.map((message) => (
                  <WhatsAppMessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer - dark bar */}
      <div className="border-t border-[#2a3942] bg-[#202c33] p-2 flex flex-col gap-2">
        {!sessionWindowLoading && !freeFormAllowed && (
          <div
            className="mx-1 rounded-md border border-[#3b4a54] bg-[#0b141a]/80 px-3 py-2 text-xs text-[#8696a0]"
            role="status"
          >
            The 24-hour messaging window is closed (no inbound message from this contact in the
            last 24 hours). Meta only allows approved templates until they reply. Send one with the
            green button beside the input.
          </div>
        )}
        <div className="flex items-end gap-2 min-h-[52px] min-w-0">
          <MediaUploadButton
            leadId={leadId}
            disabled={sessionWindowLoading}
            onMediaSent={loadConversation}
          />
          <Button
            type="button"
            variant={freeFormAllowed && !sessionWindowLoading ? "outline" : "default"}
            size="sm"
            className={cn(
              "h-10 shrink-0 px-3",
              freeFormAllowed && !sessionWindowLoading
                ? "border-[#3b4a54] bg-[#2a3942] text-[#e9edef] shadow-sm hover:bg-[#3b4a54] hover:text-[#e9edef]"
                : "bg-[#00a884] hover:bg-[#00a884]/90 text-white"
            )}
            onClick={() => setTemplateModalOpen(true)}
          >
            <FileText className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Use template</span>
          </Button>
          <div className="flex-1 min-w-0 rounded-lg border border-[#2a3942] bg-[#2a3942]/50 overflow-hidden">
            <MessageComposer
              onSend={handleSend}
              disabled={sessionWindowLoading || !freeFormAllowed}
              placeholder={
                sessionWindowLoading
                  ? "Checking messaging window…"
                  : freeFormAllowed
                    ? "Message"
                    : "Templates only until they reply…"
              }
              className="border-0 bg-transparent p-1.5 gap-1.5 [&_textarea]:min-h-[40px] [&_textarea]:rounded-lg [&_textarea]:border-[#3b4a54] [&_textarea]:bg-[#2a3942] [&_textarea]:text-[#e9edef] [&_textarea]:placeholder:text-[#8696a0] [&_button]:h-10 [&_button]:w-10 [&_button]:rounded-full [&_button]:bg-[#00a884] [&_button]:hover:bg-[#00a884]/90 [&_button]:text-white [&_button]:shrink-0"
            />
          </div>
          <VoiceRecorder
            leadId={leadId}
            disabled={sessionWindowLoading}
            onVoiceSent={loadConversation}
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
