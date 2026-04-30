"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MessageCircle, Loader2, RefreshCw, Search, UserPlus, User, UserX, Check } from "lucide-react";
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
  UnknownConversationItem,
} from "@/services/whatsapp-service";
import { TeamService, UserBrief } from "@/services/team-service";
import { useWebSocketEvent } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";

type TabType = "chats" | "unknown";

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
  
  // Unknown conversations state
  const [activeTab, setActiveTab] = useState<TabType>("chats");
  const [unknownConversations, setUnknownConversations] = useState<UnknownConversationItem[]>([]);
  const [unknownUnread, setUnknownUnread] = useState(0);
  const [unknownLoading, setUnknownLoading] = useState(false);
  const [selectedUnknownPhone, setSelectedUnknownPhone] = useState<string | null>(null);

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

  const loadUnknownConversations = useCallback(async (opts?: { silent?: boolean }) => {
    if (!config?.whatsapp_enabled) return;
    const silent = opts?.silent === true;
    try {
      if (!silent) setUnknownLoading(true);
      const response = await whatsappService.listUnknownConversations();
      setUnknownConversations(response.items);
      setUnknownUnread(response.total_unread);
    } catch (err) {
      console.error("Failed to load unknown conversations:", err);
    } finally {
      if (!silent) setUnknownLoading(false);
    }
  }, [config?.whatsapp_enabled]);

  useEffect(() => {
    if (config?.whatsapp_enabled) {
      loadConversations();
      loadUnknownConversations();
    }
  }, [config?.whatsapp_enabled, loadConversations, loadUnknownConversations]);

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
        // Determine media type from content types
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
        // Show appropriate label for media messages with no text
        const body = rawBody || (hasMedia ? mediaLabel : "");
        const createdAt = data.message?.created_at || new Date().toISOString();

        setConversations((prev) => {
          const existingIdx = prev.findIndex((c) => c.lead_id === leadId);
          if (existingIdx >= 0) {
            // Update existing conversation and move to top
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
            // Increment unread only if not currently viewing this conversation
            if (selectedLeadId !== leadId) {
              conv.unread_count = (conv.unread_count || 0) + 1;
            }
            updated.splice(existingIdx, 1);
            return [conv, ...updated];
          } else {
            // New conversation - do a silent refresh to get full details
            void loadConversations({ silent: true });
            return prev;
          }
        });

        // Update total unread count if not viewing this conversation
        if (selectedLeadId !== leadId) {
          setTotalUnread((prev) => prev + 1);
        }

        // No toast on WhatsApp page - user can see updates in real-time
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
        // Determine media type from content types
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
        // Show appropriate label for media messages with no text
        const body = rawBody || (hasMedia ? mediaLabel : "");
        const createdAt = data.message?.created_at || new Date().toISOString();

        setConversations((prev) => {
          const existingIdx = prev.findIndex((c) => c.lead_id === leadId);
          if (existingIdx >= 0) {
            // Update existing conversation and move to top
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

  // Real-time: unknown message received - refresh unknown conversations
  useWebSocketEvent<{ from_number: string; body_preview?: string }>(
    "whatsapp:unknown_received",
    useCallback(
      () => {
        if (!config?.whatsapp_enabled) return;
        // Refresh unknown conversations list
        loadUnknownConversations({ silent: true });
      },
      [config?.whatsapp_enabled, loadUnknownConversations]
    ),
    [config?.whatsapp_enabled]
  );

  // Real-time: message sent to unknown - refresh unknown conversations list
  useWebSocketEvent<{ phone_number: string; body_preview?: string }>(
    "whatsapp:unknown_sent",
    useCallback(
      () => {
        if (!config?.whatsapp_enabled) return;
        // Refresh unknown conversations list to show latest message preview
        loadUnknownConversations({ silent: true });
      },
      [config?.whatsapp_enabled, loadUnknownConversations]
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
        // Only refresh for WhatsApp leads
        if (data.is_whatsapp_lead) {
          // Refresh the chats list to show the new lead
          loadConversations({ silent: true });
          // Also refresh unknown list in case we need to remove from there
          loadUnknownConversations({ silent: true });
        }
      },
      [config?.whatsapp_enabled, loadConversations, loadUnknownConversations]
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
          <span className="text-lg font-medium text-white">WhatsApp</span>
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
              onClick={() => {
                if (activeTab === "chats") {
                  loadConversations();
                } else {
                  loadUnknownConversations();
                }
              }}
              disabled={loading || unknownLoading}
              className="text-white hover:bg-white/20"
            >
              <RefreshCw className={`h-5 w-5 ${loading || unknownLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {/* Tabs - Chats / Unknown */}
        <div className="shrink-0 flex border-b border-[#e9edef]" style={{ backgroundColor: "#fff" }}>
          <button
            onClick={() => {
              setActiveTab("chats");
              setSelectedUnknownPhone(null);
            }}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === "chats"
                ? "text-[#00a884]"
                : "text-[#667781] hover:bg-[#f5f6f6]"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <User className="h-4 w-4" />
              <span>Chats</span>
              {totalUnread > 0 && (
                <span className="bg-[#00a884] text-white text-xs rounded-full px-2 py-0.5 min-w-[20px]">
                  {totalUnread}
                </span>
              )}
            </div>
            {activeTab === "chats" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00a884]" />
            )}
          </button>
          <button
            onClick={() => {
              setActiveTab("unknown");
              setSelectedLeadId(null);
              setSelectedLeadInfo(null);
            }}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === "unknown"
                ? "text-[#00a884]"
                : "text-[#667781] hover:bg-[#f5f6f6]"
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <UserX className="h-4 w-4" />
              <span>Unknown</span>
              {unknownUnread > 0 && (
                <span className="bg-orange-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px]">
                  {unknownUnread}
                </span>
              )}
            </div>
            {activeTab === "unknown" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00a884]" />
            )}
          </button>
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
          {activeTab === "chats" ? (
            // Regular chats tab
            loading ? (
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
            )
          ) : (
            // Unknown conversations tab
            unknownLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-[#8696a0]" />
              </div>
            ) : unknownConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <UserX className="h-12 w-12 text-[#8696a0] mb-3" />
                <p className="text-sm text-[#667781]">No unknown contacts</p>
                <p className="text-xs text-[#8696a0] mt-1">
                  Messages from numbers not in your leads will appear here
                </p>
              </div>
            ) : (
              <div>
                {unknownConversations.map((conv) => {
                  const isSelected = selectedUnknownPhone === conv.phone_number;
                  const mediaTypes = conv.last_message.media_content_types || [];
                  const firstType = mediaTypes[0] || "";
                  let mediaLabel = "";
                  if (firstType.startsWith("image/")) mediaLabel = "📷 Photo";
                  else if (firstType.startsWith("video/")) mediaLabel = "🎥 Video";
                  else if (firstType.startsWith("audio/")) mediaLabel = "🎤 Voice";
                  else if (mediaTypes.length > 0) mediaLabel = "📎 File";
                  
                  const displayBody = conv.last_message.body || mediaLabel;
                  const time = new Date(conv.last_message.created_at);
                  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                  return (
                    <button
                      key={conv.phone_number}
                      type="button"
                      onClick={() => setSelectedUnknownPhone(conv.phone_number)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[#e9edef]/50 ${
                        isSelected ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                      }`}
                    >
                      <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                        <UserX className="h-6 w-6 text-orange-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-sm text-[#111b21] truncate">
                            {conv.display_name}
                          </p>
                          <span className="text-xs text-[#667781] shrink-0">{timeStr}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-[#667781] truncate">
                            {displayBody || "No message"}
                          </p>
                          {conv.unread_count > 0 && (
                            <span className="bg-orange-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center shrink-0">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* Right panel - chat area or empty state */}
      <div className={`flex-1 flex min-h-0 ${!selectedLeadId && !selectedUnknownPhone ? "hidden md:flex" : "flex"}`}>
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
        ) : selectedUnknownPhone ? (
          <UnknownConversationThread
            phoneNumber={selectedUnknownPhone}
            displayName={unknownConversations.find(c => c.phone_number === selectedUnknownPhone)?.display_name || selectedUnknownPhone}
            onBack={() => setSelectedUnknownPhone(null)}
            onLeadCreated={(leadId) => {
              setSelectedUnknownPhone(null);
              // Switch to Chats tab
              setActiveTab("chats");
              // Refresh both lists
              loadConversations({ silent: true });
              loadUnknownConversations({ silent: true });
              // Select the new/existing lead in chats if we have the ID
              if (leadId) {
                setSelectedLeadId(leadId);
              }
            }}
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

// ==================== Unknown Conversation Thread Component ====================

interface UnknownConversationThreadProps {
  phoneNumber: string;
  displayName: string;
  onBack: () => void;
  onLeadCreated: (leadId?: string) => void;
}

function UnknownConversationThread({ phoneNumber, displayName, onBack, onLeadCreated }: UnknownConversationThreadProps) {
  const { toast } = useToast();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  
  const [messages, setMessages] = useState<Array<{
    id: string;
    direction: string;
    body: string;
    created_at: string;
    status: string;
    media_urls?: string[];
    media_content_types?: string[];
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Normalize phone for comparison
  const normalizedPhone = phoneNumber.replace(/\D/g, "");
  
  // Fetch users for assignment dropdown
  useEffect(() => {
    const fetchUsers = async () => {
      if (!currentUser?.dealership_id) return;
      setLoadingUsers(true);
      try {
        const usersList = await TeamService.listUsers({
          dealership_id: currentUser.dealership_id,
          is_active: true,
        });
        setUsers(usersList);
        // Default to current user
        if (currentUser?.id) {
          setAssignedTo(currentUser.id);
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, [currentUser?.dealership_id, currentUser?.id]);

  useEffect(() => {
    loadMessages();
    // Mark as read
    whatsappService.markUnknownConversationRead(phoneNumber).catch(console.error);
  }, [phoneNumber]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const response = await whatsappService.getUnknownConversationMessages(phoneNumber);
      setMessages(response.messages);
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setLoading(false);
    }
  };

  // Real-time: new message received from unknown contact
  useWebSocketEvent<{
    message_id: string;
    from_number: string;
    body_preview: string;
    has_media: boolean;
    message?: {
      id: string;
      direction: string;
      body: string;
      status: string;
      media_urls?: string[];
      media_content_types?: string[];
      created_at: string;
    };
  }>(
    "whatsapp:unknown_received",
    useCallback(
      (data) => {
        // Check if this message is for the current conversation
        const incomingPhone = data.from_number.replace(/\D/g, "");
        if (!incomingPhone.includes(normalizedPhone) && !normalizedPhone.includes(incomingPhone)) {
          return;
        }
        // Add the new message using full message data if available
        const newMsg = data.message
          ? {
              id: data.message.id,
              direction: data.message.direction,
              body: data.message.body,
              created_at: data.message.created_at,
              status: data.message.status,
              media_urls: data.message.media_urls,
              media_content_types: data.message.media_content_types,
            }
          : {
              id: data.message_id,
              direction: "inbound",
              body: data.body_preview,
              created_at: new Date().toISOString(),
              status: "received",
            };
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m.id === data.message_id)) return prev;
          return [...prev, newMsg];
        });
        // Mark as read since we're viewing this conversation
        whatsappService.markUnknownConversationRead(phoneNumber).catch(console.error);
      },
      [normalizedPhone, phoneNumber]
    ),
    [normalizedPhone]
  );

  // Real-time: message sent to unknown contact (from another tab/device)
  useWebSocketEvent<{
    message_id: string;
    phone_number: string;
    body_preview: string;
    message?: {
      id: string;
      body: string;
      status: string;
      created_at: string;
    };
  }>(
    "whatsapp:unknown_sent",
    useCallback(
      (data) => {
        // Check if this message is for the current conversation
        const targetPhone = data.phone_number.replace(/\D/g, "");
        if (!targetPhone.includes(normalizedPhone) && !normalizedPhone.includes(targetPhone)) {
          return;
        }
        // Add the new message if not already present (could be from another tab)
        const newMsg = {
          id: data.message_id,
          direction: "outbound",
          body: data.message?.body || data.body_preview,
          created_at: data.message?.created_at || new Date().toISOString(),
          status: data.message?.status || "sent",
        };
        setMessages((prev) => {
          // Avoid duplicates (we might have added it optimistically)
          if (prev.some((m) => m.id === data.message_id)) return prev;
          return [...prev, newMsg];
        });
      },
      [normalizedPhone]
    ),
    [normalizedPhone]
  );

  const handleSendMessage = async () => {
    const text = messageText.trim();
    if (!text || sending) return;

    // Optimistic update
    const tempId = `temp_${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      direction: "outbound",
      body: text,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setMessageText("");
    setSending(true);

    try {
      const response = await whatsappService.sendToUnknown(phoneNumber, text);
      if (response.success && response.message_id) {
        // Replace temp message with real one
        setMessages(prev => prev.map(m => 
          m.id === tempId 
            ? { ...m, id: response.message_id!, status: "sent" }
            : m
        ));
      } else {
        // Mark as failed
        setMessages(prev => prev.map(m => 
          m.id === tempId 
            ? { ...m, status: "failed" }
            : m
        ));
        toast({
          title: "Failed to send",
          description: response.error || "Message could not be sent",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      setMessages(prev => prev.map(m => 
        m.id === tempId 
          ? { ...m, status: "failed" }
          : m
      ));
      toast({
        title: "Failed to send",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCreateLead = async () => {
    if (!firstName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter at least a first name",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      // Determine assignment: if "assign to me" is checked, use current user
      const assigneeId = assignToMe && currentUser?.id ? currentUser.id : assignedTo || undefined;
      
      const response = await whatsappService.createLeadFromUnknown({
        phone_number: phoneNumber,
        first_name: firstName.trim(),
        last_name: lastName.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
        assigned_to: assigneeId,
      });
      
      if (response.success && response.lead_id) {
        const isExisting = response.is_existing;
        
        toast({
          title: isExisting ? "Linked to existing lead" : "Lead created",
          description: isExisting 
            ? `Messages linked to existing lead`
            : `${firstName} has been added as a lead`,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/leads/${response.lead_id}`)}
              className="ml-2"
            >
              View Lead
            </Button>
          ),
        });
        
        onLeadCreated(response.lead_id);
      }
    } catch (err) {
      console.error("Failed to create lead:", err);
      toast({
        title: "Failed to create lead",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0b141a]">
      {/* Header - dark theme like main chat */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-[#202c33] border-b border-[#2a3942]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden text-[#e9edef] hover:bg-white/10"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
        <div className="h-10 w-10 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
          <UserX className="h-5 w-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#e9edef] truncate">{displayName}</p>
          <p className="text-xs text-orange-400">Unknown contact</p>
        </div>
        <Button
          onClick={() => setShowCreateForm(true)}
          className="bg-[#00a884] hover:bg-[#008f6f] text-white"
          size="sm"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add as Lead
        </Button>
      </div>

      {/* Create lead form overlay */}
      {showCreateForm && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Create Lead from {displayName}</h3>
            <div className="space-y-4">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                    placeholder="Last name"
                  />
                </div>
              </div>
              
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                  placeholder="customer@example.com"
                />
              </div>
              
              {/* Phone (display only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <div className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-600">
                  {phoneNumber}
                </div>
              </div>
              
              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884] resize-none"
                  placeholder="Add any notes about this lead..."
                  rows={2}
                />
              </div>
              
              {/* Assignment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign to
                </label>
                <div className="space-y-2">
                  {/* Assign to me checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div 
                      onClick={() => setAssignToMe(!assignToMe)}
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                        assignToMe 
                          ? "bg-[#00a884] border-[#00a884]" 
                          : "border-gray-300 hover:border-[#00a884]"
                      }`}
                    >
                      {assignToMe && <Check className="h-3.5 w-3.5 text-white" />}
                    </div>
                    <span className="text-sm text-gray-700">Assign to me</span>
                  </label>
                  
                  {/* User dropdown (shown when not assigning to self) */}
                  {!assignToMe && (
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                      disabled={loadingUsers}
                    >
                      <option value="">Select a salesperson...</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.first_name} {user.last_name}
                          {user.id === currentUser?.id ? " (me)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateLead}
                disabled={creating}
                className="flex-1 bg-[#00a884] hover:bg-[#008f6f] text-white"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Lead"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Messages area with WhatsApp background */}
      <div 
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2317222d' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      >
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#8696a0]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-[#8696a0]">No messages yet</p>
            <p className="text-xs text-[#667781] mt-1">Send a message to start the conversation</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            const time = new Date(msg.created_at);
            const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const isFailed = msg.status === "failed";
            const isSending = msg.status === "sending";
            
            return (
              <div
                key={msg.id}
                className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 ${
                    isInbound
                      ? "bg-[#202c33] text-[#e9edef]"
                      : isFailed
                        ? "bg-red-900/50 text-[#e9edef]"
                        : "bg-[#005c4b] text-[#e9edef]"
                  }`}
                >
                  {/* Media preview */}
                  {msg.media_urls && msg.media_urls.length > 0 && (
                    <div className="mb-2">
                      {msg.media_content_types?.map((type, idx) => {
                        if (type.startsWith("image/")) {
                          return (
                            <div key={idx} className="rounded overflow-hidden">
                              <span className="text-sm text-[#8696a0]">📷 Photo</span>
                            </div>
                          );
                        } else if (type.startsWith("video/")) {
                          return <span key={idx} className="text-sm text-[#8696a0]">🎥 Video</span>;
                        } else if (type.startsWith("audio/")) {
                          return <span key={idx} className="text-sm text-[#8696a0]">🎤 Voice message</span>;
                        } else {
                          return <span key={idx} className="text-sm text-[#8696a0]">📎 File</span>;
                        }
                      })}
                    </div>
                  )}
                  {msg.body && <p className="text-sm whitespace-pre-wrap">{msg.body}</p>}
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <p className="text-[11px] text-[#8696a0]">{timeStr}</p>
                    {!isInbound && (
                      isSending ? (
                        <Loader2 className="h-3 w-3 animate-spin text-[#8696a0]" />
                      ) : isFailed ? (
                        <span className="text-red-400 text-xs">!</span>
                      ) : (
                        <span className="text-[#53bdeb]">✓✓</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message composer - dark theme */}
      <div className="shrink-0 border-t border-[#2a3942] bg-[#202c33] px-3 py-2">
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-[#2a3942] rounded-lg">
            <textarea
              ref={textareaRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message"
              rows={1}
              className="w-full bg-transparent text-[#e9edef] placeholder:text-[#8696a0] px-3 py-2 resize-none focus:outline-none text-sm"
              style={{ maxHeight: "120px" }}
            />
          </div>
          <Button
            onClick={handleSendMessage}
            disabled={!messageText.trim() || sending}
            className="h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#008f6f] p-0"
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
