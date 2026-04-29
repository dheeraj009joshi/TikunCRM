"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, Loader2, RefreshCw, Search, UserPlus, User, UserX } from "lucide-react";
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
import { useWebSocketEvent } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

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
            onLeadCreated={() => {
              setSelectedUnknownPhone(null);
              loadConversations({ silent: true });
              loadUnknownConversations({ silent: true });
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
  onLeadCreated: () => void;
}

function UnknownConversationThread({ phoneNumber, displayName, onBack, onLeadCreated }: UnknownConversationThreadProps) {
  const { toast } = useToast();
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      const response = await whatsappService.createLeadFromUnknown({
        phone_number: phoneNumber,
        first_name: firstName.trim(),
        last_name: lastName.trim() || undefined,
      });
      
      if (response.success) {
        toast({
          title: "Lead created",
          description: `${firstName} has been added as a lead`,
        });
        onLeadCreated();
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
    <div className="flex flex-col h-full w-full bg-[#efeae2]">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#f0f2f5] border-b border-[#e9edef]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="md:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
          <UserX className="h-5 w-5 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#111b21] truncate">{displayName}</p>
          <p className="text-xs text-orange-500">Unknown contact</p>
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
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Create Lead from {displayName}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00a884]"
                  placeholder="Enter first name"
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
                  placeholder="Enter last name"
                />
              </div>
              <div className="text-sm text-gray-500">
                Phone: {phoneNumber}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#8696a0]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-[#667781]">No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            const time = new Date(msg.created_at);
            const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            
            return (
              <div
                key={msg.id}
                className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 ${
                    isInbound
                      ? "bg-white text-[#111b21]"
                      : "bg-[#d9fdd3] text-[#111b21]"
                  }`}
                >
                  {/* Media preview */}
                  {msg.media_urls && msg.media_urls.length > 0 && (
                    <div className="mb-2">
                      {msg.media_content_types?.map((type, idx) => {
                        if (type.startsWith("image/")) {
                          return (
                            <div key={idx} className="rounded overflow-hidden">
                              <span className="text-sm text-[#667781]">📷 Photo</span>
                            </div>
                          );
                        } else if (type.startsWith("video/")) {
                          return <span key={idx} className="text-sm text-[#667781]">🎥 Video</span>;
                        } else if (type.startsWith("audio/")) {
                          return <span key={idx} className="text-sm text-[#667781]">🎤 Voice message</span>;
                        } else {
                          return <span key={idx} className="text-sm text-[#667781]">📎 File</span>;
                        }
                      })}
                    </div>
                  )}
                  {msg.body && <p className="text-sm whitespace-pre-wrap">{msg.body}</p>}
                  <p className="text-[11px] text-[#667781] text-right mt-1">{timeStr}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer - info bar */}
      <div className="shrink-0 px-4 py-3 bg-[#f0f2f5] border-t border-[#e9edef] text-center">
        <p className="text-sm text-[#667781]">
          This is an unknown contact. Click &quot;Add as Lead&quot; to start a conversation.
        </p>
      </div>
    </div>
  );
}
