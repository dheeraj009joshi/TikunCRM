"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Loader2, ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppMessageBubble } from "./whatsapp-message-bubble";
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

  const loadConversation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const conversation = await whatsappService.getConversation(leadId);
      setMessages(conversation.messages);
    } catch (err) {
      setError("Failed to load chat");
      console.error(err);
      toast({
        title: "Could not load chat",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [leadId, toast]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // When Twilio sends delivery status (delivered/read), refresh so ticks update
  useWebSocketEvent<{ message_id: string; lead_id: string; status: string }>(
    "whatsapp:status",
    (data) => {
      if (data.lead_id === leadId) {
        loadConversation();
      }
    },
    [leadId, loadConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (body: string) => {
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
        onMessageSent?.();
      } else {
        const is63016 =
          result.error_code === "63016" ||
          (result.error?.includes("63016") ?? false);
        if (is63016) {
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
        loadConversation();
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
        <Button onClick={loadConversation}>Retry</Button>
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
        <div className="min-w-0">
          <h2 className="font-semibold text-[#e9edef] truncate">{leadName}</h2>
          {leadPhone && (
            <p className="text-xs text-[#8696a0] truncate">{leadPhone}</p>
          )}
        </div>
      </div>

      {/* Messages area - WhatsApp chat background */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2317222d' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {messages.length === 0 ? (
          <div className="text-center text-[#8696a0] py-8">
            No messages yet. Send a message to start the conversation.
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
        <div className="flex gap-2 items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-[#2a3942] text-[#e9edef] hover:bg-white/10"
            onClick={() => setTemplateModalOpen(true)}
          >
            <FileText className="h-4 w-4 mr-1" />
            Use template
          </Button>
        </div>
        <MessageComposer
          onSend={handleSend}
          placeholder="Message"
        />
      </div>

      <Dialog open={templateModalOpen} onOpenChange={setTemplateModalOpen}>
        <DialogContent className="bg-[#202c33] border-[#2a3942] text-[#e9edef] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#e9edef]">Send WhatsApp template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[#8696a0]">Template</Label>
              <Select
                value={selectedTemplate?.id ?? ""}
                onValueChange={(id) => {
                  const t = templates.find((x) => x.id === id) ?? null;
                  setSelectedTemplate(t);
                  setTemplateVariables({});
                }}
              >
                <SelectTrigger className="bg-[#2a3942] border-[#2a3942] text-[#e9edef]">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
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
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setTemplateModalOpen(false)}
                className="border-[#2a3942] text-[#e9edef]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSendTemplate}
                disabled={!selectedTemplate || sendingTemplate}
                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
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
