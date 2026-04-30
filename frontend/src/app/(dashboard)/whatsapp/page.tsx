"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, Loader2, RefreshCw, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  WhatsAppConversationList,
  WhatsAppConversationThread,
} from "@/components/whatsapp";
import {
  whatsappService,
  WhatsAppConversationListItem,
  WhatsAppConfig,
  WhatsAppLeadSearchItem,
} from "@/services/whatsapp-service";
import { useWebSocketEvent } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

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
    direction: string;
    body: string;
    status: string;
    created_at: string | null;
    media_urls?: string[];
    media_content_types?: string[];
  };
}

/** WebSocket payload for whatsapp:status events */
interface WsStatusPayload {
  message_id: string;
  lead_id: string;
  status: string;
}

// WhatsApp Desktop colors
const WA_HEADER_BG = "#00a884";
const WA_LIST_BG = "#f0f2f5";
const WA_EMPTY_RIGHT_BG = "#0b141a";
const WA_EMPTY_TEXT = "#8696a0";

export default function WhatsAppInboxPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [conversations, setConversations] = useState<WhatsAppConversationListItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [leadSearchResults, setLeadSearchResults] = useState<WhatsAppLeadSearchItem[]>([]);
  const [leadSearchLoading, setLeadSearchLoading] = useState(false);
  const [selectedLeadInfo, setSelectedLeadInfo] = useState<{ leadName: string; leadPhone: string | null } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedConversation = conversations.find((c) => c.lead_id === selectedLeadId);

  // Deep link: ?lead=... from inbox
  useEffect(() => {
    const lead = searchParams.get("lead");
    if (lead) setSelectedLeadId(lead);
  }, [searchParams]);

  useEffect(() => {
    whatsappService
      .getConfig()
      .then(setConfig)
      .catch(console.error)
      .finally(() => setConfigLoading(false));
  }, []);

  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    if (!config?.whatsapp_enabled) return;
    const silent = opts?.silent === true;
    try {
      if (!silent) setLoading(true);
      const response = await whatsappService.listConversations();
      setConversations(response.items);
      setTotalUnread(response.total_unread);
    } catch (err) {
      console.error("Failed to load WhatsApp conversations:", err);
      if (!silent) {
        toast({
          title: "Could not load conversations",
          description: "Check your connection and try again.",
          variant: "destructive",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [config?.whatsapp_enabled, toast]);

  useEffect(() => {
    if (config?.whatsapp_enabled) {
      loadConversations();
    }
  }, [config?.whatsapp_enabled, loadConversations]);

  // Debounced search for leads (new chat)
  useEffect(() => {
    if (!config?.whatsapp_enabled || searchQuery.trim().length < 2) {
      setLeadSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLeadSearchLoading(true);
      try {
        const items = await whatsappService.searchLeads(searchQuery.trim(), 20);
        setLeadSearchResults(items);
      } catch {
        setLeadSearchResults([]);
      } finally {
        setLeadSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, config?.whatsapp_enabled]);

  // Real-time: new incoming message - update conversation list instantly
  useWebSocketEvent<WsMessagePayload>(
    "whatsapp:received",
    useCallback(
      (data) => {
        if (!config?.whatsapp_enabled || !data?.lead_id) return;
        const leadId = data.lead_id;
        const messageId = data.message?.id || data.message_id;
        const rawBody = data.message?.body || data.body_preview || "";
        const hasMedia = data.has_media || ((data.message as { media_urls?: string[] })?.media_urls?.length ?? 0) > 0;
        const contentTypes = (data.message as { media_content_types?: string[] })?.media_content_types || [];
        const firstContentType = contentTypes[0] || "";
        let mediaLabel = "[Photo]";
        if (firstContentType.startsWith("video/")) {
          mediaLabel = "[Video]";
        } else if (firstContentType.startsWith("audio/")) {
          mediaLabel = "[Voice message]";
        } else if (firstContentType === "application/pdf" || firstContentType.includes("document")) {
          mediaLabel = "[Document]";
        }
        const body = rawBody || (hasMedia ? mediaLabel : "");
        const createdAt = data.message?.created_at || new Date().toISOString();

        setConversations((prev) => {
          const existingIdx = prev.findIndex((c) => c.lead_id === leadId);
          if (existingIdx >= 0) {
            const updated = [...prev];
            const conv = { ...updated[existingIdx] };
            conv.last_message = {
              id: messageId,
              body: body.slice(0, 100),
              direction: "inbound",
              created_at: createdAt,
              status: "received",
              media_urls: (data.message as { media_urls?: string[] })?.media_urls || [],
              media_content_types: (data.message as { media_content_types?: string[] })?.media_content_types || [],
            };
            if (selectedLeadId !== leadId) {
              conv.unread_count = (conv.unread_count || 0) + 1;
            }
            updated.splice(existingIdx, 1);
            return [conv, ...updated];
          } else {
            void loadConversations({ silent: true });
            return prev;
          }
        });

        if (selectedLeadId !== leadId) {
          setTotalUnread((prev) => prev + 1);
        }
      },
      [config?.whatsapp_enabled, selectedLeadId, loadConversations]
    ),
    [config?.whatsapp_enabled, selectedLeadId, loadConversations]
  );

  // Real-time: sent message - update conversation list instantly
  useWebSocketEvent<WsMessagePayload>(
    "whatsapp:sent",
    useCallback(
      (data) => {
        if (!config?.whatsapp_enabled || !data?.lead_id) return;
        const leadId = data.lead_id;
        const messageId = data.message?.id || data.message_id;
        const rawBody = data.message?.body || data.body_preview || "";
        const hasMedia = data.has_media || ((data.message as { media_urls?: string[] })?.media_urls?.length ?? 0) > 0;
        const contentTypes = (data.message as { media_content_types?: string[] })?.media_content_types || [];
        const firstContentType = contentTypes[0] || "";
        let mediaLabel = "[Photo]";
        if (firstContentType.startsWith("video/")) {
          mediaLabel = "[Video]";
        } else if (firstContentType.startsWith("audio/")) {
          mediaLabel = "[Voice message]";
        } else if (firstContentType === "application/pdf" || firstContentType.includes("document")) {
          mediaLabel = "[Document]";
        }
        const body = rawBody || (hasMedia ? mediaLabel : "");
        const createdAt = data.message?.created_at || new Date().toISOString();

        setConversations((prev) => {
          const existingIdx = prev.findIndex((c) => c.lead_id === leadId);
          if (existingIdx >= 0) {
            const updated = [...prev];
            const conv = { ...updated[existingIdx] };
            conv.last_message = {
              id: messageId,
              body: body.slice(0, 100),
              direction: "outbound",
              created_at: createdAt,
              status: data.message?.status || "sent",
              media_urls: (data.message as { media_urls?: string[] })?.media_urls || [],
              media_content_types: (data.message as { media_content_types?: string[] })?.media_content_types || [],
            };
            updated.splice(existingIdx, 1);
            return [conv, ...updated];
          }
          return prev;
        });
      },
      [config?.whatsapp_enabled]
    ),
    [config?.whatsapp_enabled]
  );

  // Real-time: status update (delivered/read) - update conversation list
  useWebSocketEvent<WsStatusPayload>(
    "whatsapp:status",
    useCallback(
      (data) => {
        if (!config?.whatsapp_enabled || !data?.lead_id) return;
        const leadId = data.lead_id;

        setConversations((prev) =>
          prev.map((c) =>
            c.lead_id === leadId && c.last_message
              ? { ...c, last_message: { ...c.last_message, status: data.status } }
              : c
          )
        );
      },
      [config?.whatsapp_enabled]
    ),
    [config?.whatsapp_enabled]
  );

  // Real-time: new lead created from WhatsApp - refresh conversations list
  useWebSocketEvent<{
    lead_id: string;
    customer_id: string;
    phone: string;
    source: string;
    is_whatsapp_lead: boolean;
  }>(
    "lead:created",
    useCallback(
      (data) => {
        if (!config?.whatsapp_enabled) return;
        if (data.is_whatsapp_lead) {
          loadConversations({ silent: true });
        }
      },
      [config?.whatsapp_enabled, loadConversations]
    ),
    [config?.whatsapp_enabled]
  );

  const handleSelect = (leadId: string) => {
    setSelectedLeadId(leadId);
    setSelectedLeadInfo(null);
    const conv = conversations.find((c) => c.lead_id === leadId);
    if (conv && conv.unread_count > 0) {
      setConversations((prev) =>
        prev.map((c) => (c.lead_id === leadId ? { ...c, unread_count: 0 } : c))
      );
      setTotalUnread((prev) => Math.max(0, prev - conv.unread_count));
    }
  };

  const handleSelectFromSearch = (lead: WhatsAppLeadSearchItem) => {
    setSelectedLeadId(lead.lead_id);
    setSelectedLeadInfo({ leadName: lead.lead_name, leadPhone: lead.lead_phone });
  };

  const displayLeadName = selectedConversation?.lead_name ?? selectedLeadInfo?.leadName ?? "";
  const displayLeadPhone = selectedConversation?.lead_phone ?? selectedLeadInfo?.leadPhone ?? null;

  const newChatHits = leadSearchResults.filter(
    (l) => !conversations.some((c) => c.lead_id === l.lead_id)
  );
  const showStartNewChatSection = leadSearchLoading || newChatHits.length > 0;

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config?.whatsapp_enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] text-center px-4">
        <div className="bg-[#00a884]/10 rounded-full p-6 mb-6">
          <MessageCircle className="h-16 w-16 text-[#00a884]" />
        </div>
        <h2 className="text-2xl font-bold mb-3">WhatsApp Coming Soon</h2>
        <p className="text-muted-foreground max-w-md mb-6">
          WhatsApp messaging is being configured and will be available soon.
        </p>
        <div className="bg-muted/50 rounded-lg p-6 max-w-md">
          <p className="text-sm text-muted-foreground">
            Configure Twilio WhatsApp (sandbox or Business API) and set
            TWILIO_WHATSAPP_NUMBER and WHATSAPP_ENABLED in your backend.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-[calc(100vh-140px)] flex overflow-hidden rounded-lg border border-border shadow-sm"
      style={{ backgroundColor: WA_LIST_BG }}
    >
      {/* Left panel - WhatsApp desktop style: green header + search + chat list */}
      <div
        className={`flex flex-col w-full md:w-[320px] lg:w-[360px] xl:w-[400px] border-r border-[#d1d7db] shrink-0 ${
          selectedLeadId ? "hidden md:flex" : "flex"
        }`}
      >
        {/* Green header - WhatsApp desktop */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: WA_HEADER_BG }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium text-white">WhatsApp</span>
            {totalUnread > 0 && (
              <span className="bg-white/20 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px]">
                {totalUnread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSearchQuery("");
                setLeadSearchResults([]);
                searchInputRef.current?.focus();
              }}
              className="text-white hover:bg-white/20"
              title="New chat"
            >
              <UserPlus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => loadConversations()}
              disabled={loading}
              className="text-white hover:bg-white/20"
            >
              <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {/* Search bar - like WhatsApp desktop */}
        <div className="shrink-0 px-2 py-2" style={{ backgroundColor: WA_HEADER_BG }}>
          <div className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2">
            <Search className="h-4 w-4 text-[#8696a0] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search chats or find a lead to start new chat"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-[#111b21] placeholder:text-[#8696a0] outline-none min-w-0"
            />
          </div>
        </div>
        {/* Chat list */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ backgroundColor: WA_LIST_BG }}
        >
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#8696a0]" />
            </div>
          ) : (
            <>
              {/* New chat: leads matching search (from customers/leads, not just existing chats) */}
              {showStartNewChatSection && (
                <div className="border-b border-[#e9edef] bg-white">
                  <p className="px-4 py-2 text-xs font-medium text-[#667781] uppercase tracking-wide">
                    Start new chat
                  </p>
                  {leadSearchLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-[#8696a0]" />
                    </div>
                  ) : (
                    newChatHits.map((lead) => (
                      <button
                        key={lead.lead_id}
                        type="button"
                        onClick={() => handleSelectFromSearch(lead)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#f5f6f6] transition-colors border-b border-[#e9edef]/50 last:border-b-0"
                      >
                        <div
                          className="h-10 w-10 rounded-full flex items-center justify-center shrink-0"
                          style={{ backgroundColor: "rgba(0,168,132,0.2)" }}
                        >
                          <MessageCircle className="h-5 w-5" style={{ color: WA_HEADER_BG }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-[#111b21] truncate">{lead.lead_name}</p>
                          {lead.lead_phone && (
                            <p className="text-xs text-[#667781] truncate">{lead.lead_phone}</p>
                          )}
                        </div>
                        <span className="text-xs text-[#00a884] font-medium shrink-0">New chat</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              <WhatsAppConversationList
                conversations={conversations}
                selectedLeadId={selectedLeadId || undefined}
                onSelect={handleSelect}
                searchQuery={searchQuery}
                hideEmptyStateForNewChatSearch={
                  showStartNewChatSection && conversations.length === 0
                }
              />
            </>
          )}
        </div>
      </div>

      {/* Right panel - chat area or empty state */}
      <div className={`flex-1 flex min-h-0 ${!selectedLeadId ? "hidden md:flex" : "flex"}`}>
        {selectedLeadId ? (
          <WhatsAppConversationThread
            leadId={selectedLeadId}
            leadName={displayLeadName}
            leadPhone={displayLeadPhone}
            onBack={() => {
              setSelectedLeadId(null);
              setSelectedLeadInfo(null);
            }}
            onMessageSent={() => loadConversations({ silent: true })}
          />
        ) : (
          <div
            className="flex flex-col items-center justify-center h-full text-center p-4 w-full"
            style={{ backgroundColor: WA_EMPTY_RIGHT_BG }}
          >
            <MessageCircle className="h-12 w-12 mb-4 opacity-80" style={{ color: WA_EMPTY_TEXT }} />
            <p className="text-sm" style={{ color: WA_EMPTY_TEXT }}>
              Select a chat to start messaging
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
