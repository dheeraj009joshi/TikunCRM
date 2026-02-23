"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MessageCircle,
  Loader2,
  RefreshCw,
  Send,
  Users,
  QrCode,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  History,
  AlertCircle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import {
  whatsappBaileysService,
  BaileysStatus,
  ConversationItem,
  MessageItem,
  RecipientPreview,
  BulkSendHistoryItem,
} from "@/services/whatsapp-baileys-service";
import { ChatList } from "./components/ChatList";
import { ChatView } from "./components/ChatView";
import { NewChatDialog } from "./components/NewChatDialog";
import { useWhatsAppSocket, WhatsAppSocketMessage, MessageStatusUpdate } from "./hooks/useWhatsAppSocket";

const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "in_showroom", label: "In Showroom" },
];

const normalizePhone = (phone: string): string => phone.replace(/\D/g, "");

const getPhoneSuffix = (phone: string, length: number = 10): string => {
  const digits = normalizePhone(phone);
  return digits.length >= length ? digits.slice(-length) : digits;
};

const deduplicateConversations = (convs: ConversationItem[]): ConversationItem[] => {
  const seen = new Map<string, ConversationItem>();
  for (const conv of convs) {
    const key = getPhoneSuffix(conv.phone_number);
    const existing = seen.get(key);
    if (!existing || new Date(conv.last_message_at || 0) > new Date(existing.last_message_at || 0)) {
      seen.set(key, conv);
    }
  }
  return Array.from(seen.values());
};

export default function WhatsAppAdminPage() {
  const { toast } = useToast();
  const { user } = useAuthStore();

  // Connection state
  const [status, setStatus] = useState<BaileysStatus | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  // Bulk send state
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [recipients, setRecipients] = useState<RecipientPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Conversations state
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCustomerName, setSelectedCustomerName] = useState<string>("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // New chat dialog
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Bulk send history
  const [bulkHistory, setBulkHistory] = useState<BulkSendHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Check if user is admin
  const isAdmin =
    user?.role &&
    ["super_admin", "dealership_admin", "dealership_owner"].includes(user.role);

  // Handle incoming WebSocket message
  const handleWebSocketMessage = useCallback((wsMessage: WhatsAppSocketMessage) => {
    const normalizedPhone = normalizePhone(wsMessage.phone);
    const phoneSuffix = getPhoneSuffix(normalizedPhone);

    // If this message is for the currently selected conversation, add it
    if (selectedPhone && phoneSuffix === getPhoneSuffix(selectedPhone)) {
      const newMessage: MessageItem = {
        id: wsMessage.id,
        wa_message_id: wsMessage.id,
        direction: "inbound",
        body: wsMessage.content,
        media_url: wsMessage.mediaUrl,
        media_type: wsMessage.mediaType,
        status: "received",
        received_at: new Date(wsMessage.timestamp * 1000).toISOString(),
        created_at: new Date(wsMessage.timestamp * 1000).toISOString(),
        is_read: false,
      };
      setMessages((prev) => [...prev, newMessage]);
    }

    // Update conversation list with new message (match by phone suffix)
    setConversations((prev) => {
      const existingIndex = prev.findIndex(
        (c) => getPhoneSuffix(c.phone_number) === phoneSuffix
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          last_message: wsMessage.content,
          last_message_at: new Date(wsMessage.timestamp * 1000).toISOString(),
          unread_count: updated[existingIndex].unread_count + 1,
          direction: "inbound",
        };
        // Move to top
        const [item] = updated.splice(existingIndex, 1);
        return [item, ...updated];
      } else {
        // New conversation - store with normalized phone
        return [
          {
            phone_number: normalizedPhone,
            customer_name: wsMessage.pushName,
            last_message: wsMessage.content,
            last_message_at: new Date(wsMessage.timestamp * 1000).toISOString(),
            direction: "inbound",
            unread_count: 1,
          },
          ...prev,
        ];
      }
    });
  }, [selectedPhone]);

  // Handle message status updates from WebSocket
  const handleMessageStatusUpdate = useCallback((update: MessageStatusUpdate) => {
    console.log("[WhatsApp] Status update received:", update);

    // Get phone suffix from remoteJid for matching
    const updatePhoneSuffix = getPhoneSuffix(
      update.remoteJid?.replace(/@.*$/, "") || ""
    );

    setMessages((prev) => {
      const matchingMsg = prev.find((msg) => msg.wa_message_id === update.messageId);
      if (matchingMsg) {
        console.log("[WhatsApp] Found matching message, updating status:", {
          messageId: update.messageId,
          oldStatus: matchingMsg.status,
          newStatus: update.status,
        });
      } else {
        console.log("[WhatsApp] No matching message found for ID:", update.messageId);
        console.log("[WhatsApp] Current message IDs:", prev.map((m) => m.wa_message_id));
      }

      return prev.map((msg) =>
        msg.wa_message_id === update.messageId
          ? { ...msg, status: update.status }
          : msg
      );
    });

    // Also update the conversation list status using phone suffix comparison
    if (updatePhoneSuffix) {
      setConversations((prev) =>
        prev.map((conv) => {
          const convPhoneSuffix = getPhoneSuffix(conv.phone_number);
          if (convPhoneSuffix === updatePhoneSuffix) {
            return { ...conv, last_message_status: update.status };
          }
          return conv;
        })
      );
    }
  }, []);

  // WebSocket connection for real-time updates
  const { whatsappStatus, isConnected: wsConnected } = useWhatsAppSocket({
    onMessage: handleWebSocketMessage,
    onMessageStatus: handleMessageStatusUpdate,
    onStatusChange: (wsStatus) => {
      setStatus({
        connected: wsStatus.isConnected,
        status: wsStatus.state,
        phone_number: wsStatus.phoneNumber,
        qr_available: wsStatus.hasQr,
      });
      if (wsStatus.qr) {
        setQrCode(wsStatus.qr);
      } else if (wsStatus.isConnected) {
        setQrCode(null);
      }
      setStatusLoading(false);
    },
    enabled: isAdmin,
  });

  // Fetch status on mount (fallback if WebSocket not connected)
  const fetchStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const s = await whatsappBaileysService.getStatus();
      setStatus(s);

      if (!s.connected && s.qr_available) {
        const qr = await whatsappBaileysService.getQR();
        setQrCode(qr.qr || null);
      } else {
        setQrCode(null);
      }
    } catch (error) {
      console.error("Failed to fetch status:", error);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Initial status fetch (WebSocket will take over after connection)
  useEffect(() => {
    if (!wsConnected) {
      fetchStatus();
    }
  }, [fetchStatus, wsConnected]);

  // Fetch conversations (deduplicated by last 10 digits of phone)
  const fetchConversations = useCallback(async () => {
    try {
      setConversationsLoading(true);
      const response = await whatsappBaileysService.getConversations();
      const dedupedConversations = deduplicateConversations(response.items);
      setConversations(dedupedConversations);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  // Fetch messages for selected phone (initial load only - WebSocket handles updates)
  const fetchMessages = useCallback(async (phone: string, showLoading = true) => {
    try {
      if (showLoading) {
        setMessagesLoading(true);
      }
      const response = await whatsappBaileysService.getMessages(phone);
      setMessages(response.messages);
      if (response.customer_name) {
        setSelectedCustomerName(response.customer_name);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // Fetch bulk send history
  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const response = await whatsappBaileysService.getBulkSendHistory();
      setBulkHistory(response.items);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Preview recipients
  const previewRecipients = async () => {
    if (selectedStatuses.length === 0) {
      toast({
        title: "Select statuses",
        description:
          "Please select at least one lead status to filter recipients.",
        variant: "destructive",
      });
      return;
    }

    try {
      setPreviewLoading(true);
      const response = await whatsappBaileysService.previewRecipients({
        message: message || "Preview",
        lead_statuses: selectedStatuses,
      });
      setRecipients(response.recipients);

      if (response.total === 0) {
        toast({
          title: "No recipients found",
          description: "No customers match the selected criteria.",
        });
      }
    } catch (error) {
      console.error("Failed to preview recipients:", error);
      toast({
        title: "Error",
        description: "Failed to preview recipients.",
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  // Send bulk messages
  const sendBulkMessages = async () => {
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to send.",
        variant: "destructive",
      });
      return;
    }

    if (recipients.length === 0) {
      toast({
        title: "No recipients",
        description: "Please preview recipients first.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSendingBulk(true);
      const response = await whatsappBaileysService.sendBulk({
        message: message.trim(),
        lead_statuses: selectedStatuses,
        name: campaignName || undefined,
      });

      setConfirmDialogOpen(false);

      if (response.success) {
        toast({
          title: "Bulk send started",
          description: `Sent: ${response.sent}/${response.total}, Failed: ${response.failed}`,
        });
        setMessage("");
        setCampaignName("");
        setSelectedStatuses([]);
        setRecipients([]);
        fetchHistory();
      } else {
        toast({
          title: "Bulk send failed",
          description: response.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to send bulk:", error);
      toast({
        title: "Error",
        description: "Failed to send bulk messages.",
        variant: "destructive",
      });
    } finally {
      setSendingBulk(false);
    }
  };

  // Send message in conversation
  const sendMessage = async (messageText: string) => {
    if (!selectedPhone || !messageText.trim()) return;

    const selectedPhoneSuffix = getPhoneSuffix(selectedPhone);

    // Optimistically add the message to UI
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: MessageItem = {
      id: tempId,
      wa_message_id: tempId,
      direction: "outbound",
      body: messageText.trim(),
      status: "pending",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      is_read: false,
    };
    
    setMessages((prev) => [...prev, optimisticMessage]);

    // Update conversation list with pending status (or add new conversation)
    setConversations((prev) => {
      const idx = prev.findIndex(
        (c) => getPhoneSuffix(c.phone_number) === selectedPhoneSuffix
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          last_message: messageText.trim(),
          last_message_at: new Date().toISOString(),
          direction: "outbound",
          last_message_status: "pending",
        };
        const [item] = updated.splice(idx, 1);
        return [item, ...updated];
      }
      // Add new conversation if it doesn't exist
      const newConversation: ConversationItem = {
        phone_number: selectedPhone,
        customer_name: selectedCustomerName || undefined,
        last_message: messageText.trim(),
        last_message_at: new Date().toISOString(),
        direction: "outbound",
        last_message_status: "pending",
        unread_count: 0,
      };
      return [newConversation, ...prev];
    });

    try {
      const response = await whatsappBaileysService.sendMessage({
        phone: selectedPhone,
        message: messageText.trim(),
      });

      if (response.success) {
        // Update the optimistic message with the real message ID and status
        const realMsgId = response.wa_message_id || response.message_id || tempId;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempId
              ? {
                  ...msg,
                  id: realMsgId,
                  wa_message_id: realMsgId,
                  status: "sent",
                }
              : msg
          )
        );
        // Update conversation list status to sent
        setConversations((prev) =>
          prev.map((conv) =>
            getPhoneSuffix(conv.phone_number) === selectedPhoneSuffix
              ? { ...conv, last_message_status: "sent" }
              : conv
          )
        );
      } else {
        // Mark as failed
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempId ? { ...msg, status: "failed" } : msg
          )
        );
        // Update conversation list status to failed
        setConversations((prev) =>
          prev.map((conv) =>
            getPhoneSuffix(conv.phone_number) === selectedPhoneSuffix
              ? { ...conv, last_message_status: "failed" }
              : conv
          )
        );
        toast({
          title: "Failed to send",
          description: response.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      // Mark as failed
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId ? { ...msg, status: "failed" } : msg
        )
      );
      // Update conversation list status to failed
      setConversations((prev) =>
        prev.map((conv) =>
          getPhoneSuffix(conv.phone_number) === selectedPhoneSuffix
            ? { ...conv, last_message_status: "failed" }
            : conv
        )
      );
      toast({
        title: "Error",
        description: "Failed to send message.",
        variant: "destructive",
      });
    }
  };

  // Handle selecting a conversation
  const handleSelectConversation = (phone: string) => {
    const normalizedPhone = normalizePhone(phone);
    setSelectedPhone(normalizedPhone);
    const conversation = conversations.find(
      (c) => getPhoneSuffix(c.phone_number) === getPhoneSuffix(normalizedPhone)
    );
    setSelectedCustomerName(conversation?.customer_name || conversation?.lead_name || "");
    fetchMessages(normalizedPhone);
  };

  // Handle new chat from customer selection
  const handleSelectCustomer = (customer: {
    id: string;
    name: string;
    phone?: string;
  }) => {
    if (customer.phone) {
      const normalizedPhone = normalizePhone(customer.phone);
      setSelectedPhone(normalizedPhone);
      setSelectedCustomerName(customer.name);
      setMessages([]);
      fetchMessages(normalizedPhone);
      fetchConversations();
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    try {
      await whatsappBaileysService.disconnect();
      toast({ title: "Disconnected" });
      fetchStatus();
    } catch (error) {
      console.error("Failed to disconnect:", error);
    }
  };

  // Delete all conversations
  const handleDeleteAllConversations = async () => {
    if (!confirm("Are you sure you want to delete ALL WhatsApp conversations? This cannot be undone.")) {
      return;
    }
    try {
      const result = await whatsappBaileysService.deleteAllMessages();
      toast({ 
        title: "Deleted", 
        description: result.message 
      });
      setConversations([]);
      setMessages([]);
      setSelectedPhone(null);
    } catch (error) {
      console.error("Failed to delete conversations:", error);
      toast({ 
        title: "Error", 
        description: "Failed to delete conversations",
        variant: "destructive"
      });
    }
  };

  // Cleanup and normalize conversations
  const handleCleanupConversations = async () => {
    try {
      const result = await whatsappBaileysService.cleanupMessages();
      toast({ 
        title: "Cleanup Complete", 
        description: result.message 
      });
      fetchConversations();
    } catch (error) {
      console.error("Failed to cleanup conversations:", error);
      toast({ 
        title: "Error", 
        description: "Failed to cleanup conversations",
        variant: "destructive"
      });
    }
  };

  // Reconnect
  const handleReconnect = async () => {
    try {
      setReconnecting(true);
      await whatsappBaileysService.reconnect();
      toast({ title: "Reconnecting..." });
      fetchStatus();
    } catch (error) {
      console.error("Failed to reconnect:", error);
    } finally {
      setReconnecting(false);
    }
  };

  // Get existing phone numbers for new chat dialog
  const existingPhones = new Set(conversations.map((c) => c.phone_number));

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Access Denied
            </CardTitle>
            <CardDescription>
              Admin access is required to use WhatsApp bulk messaging.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6 text-green-600" />
            <div>
              <h1 className="text-xl font-semibold">WhatsApp Admin</h1>
              <p className="text-sm text-muted-foreground">
                Bulk messaging and conversations
              </p>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-3">
            {statusLoading ? (
              <Badge variant="secondary">
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Checking...
              </Badge>
            ) : status?.connected ? (
              <Badge variant="default" className="bg-green-600">
                <Wifi className="h-3 w-3 mr-1" />
                Connected {status.phone_number && `(${status.phone_number})`}
              </Badge>
            ) : (
              <Badge variant="destructive">
                <WifiOff className="h-3 w-3 mr-1" />
                Disconnected
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              disabled={statusLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`}
              />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCleanupConversations}
              title="Cleanup & normalize phone numbers"
            >
              Cleanup
            </Button>

            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteAllConversations}
              title="Delete all conversations"
            >
              Delete All
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!status?.connected ? (
          // QR Code / Connection View
          <div className="h-full flex items-center justify-center p-8">
            <Card className="max-w-md w-full">
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <QrCode className="h-6 w-6" />
                  Connect WhatsApp
                </CardTitle>
                <CardDescription>
                  Scan the QR code with your WhatsApp app to connect
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                {qrCode ? (
                  <div className="p-4 bg-white rounded-lg shadow-inner">
                    <img
                      src={`data:image/png;base64,${qrCode}`}
                      alt="WhatsApp QR Code"
                      className="w-64 h-64"
                    />
                  </div>
                ) : (
                  <div className="w-64 h-64 bg-muted rounded-lg flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}

                <p className="text-sm text-muted-foreground text-center">
                  Open WhatsApp on your phone → Settings → Linked Devices → Link
                  a Device
                </p>

                <Button
                  variant="outline"
                  onClick={handleReconnect}
                  disabled={reconnecting}
                >
                  {reconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh QR
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          // Main Interface
          <Tabs defaultValue="conversations" className="h-full flex flex-col">
            <div className="px-4 pt-2 border-b">
              <TabsList>
                <TabsTrigger
                  value="conversations"
                  className="gap-2"
                  onClick={() => {
                    if (conversations.length === 0) fetchConversations();
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  Conversations
                </TabsTrigger>
                <TabsTrigger value="bulk" className="gap-2">
                  <Users className="h-4 w-4" />
                  Bulk Send
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="gap-2"
                  onClick={() => {
                    if (bulkHistory.length === 0) fetchHistory();
                  }}
                >
                  <History className="h-4 w-4" />
                  History
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Conversations Tab - WhatsApp Style */}
            <TabsContent
              value="conversations"
              className="flex-1 overflow-hidden m-0"
            >
              <div className="h-full flex">
                {/* Chat List Sidebar */}
                <div className="w-[350px] lg:w-[400px] h-full flex-shrink-0">
                  <ChatList
                    conversations={conversations}
                    selectedPhone={selectedPhone}
                    onSelectConversation={handleSelectConversation}
                    onNewChat={() => setNewChatOpen(true)}
                    onRefresh={fetchConversations}
                    loading={conversationsLoading}
                  />
                </div>

                {/* Chat View */}
                <div className="flex-1 h-full relative">
                  {selectedPhone ? (
                    <ChatView
                      phoneNumber={selectedPhone}
                      customerName={selectedCustomerName}
                      messages={messages}
                      loading={messagesLoading}
                      onSendMessage={sendMessage}
                      onBack={() => setSelectedPhone(null)}
                      showBackButton={true}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35]">
                      <div className="text-center max-w-md">
                        <div className="w-64 h-64 mx-auto mb-6 opacity-20">
                          <MessageCircle className="w-full h-full text-[#00a884]" />
                        </div>
                        <h2 className="text-2xl font-light text-[#41525d] dark:text-[#d1d7db] mb-2">
                          WhatsApp Web
                        </h2>
                        <p className="text-sm text-[#667781] dark:text-[#8696a0]">
                          Send and receive messages without keeping your phone
                          online.
                          <br />
                          Select a conversation or start a new chat.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* New Chat Dialog */}
              <NewChatDialog
                open={newChatOpen}
                onOpenChange={setNewChatOpen}
                onSelectCustomer={handleSelectCustomer}
                existingPhones={existingPhones}
              />
            </TabsContent>

            {/* Bulk Send Tab */}
            <TabsContent value="bulk" className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Filters & Message */}
                <Card>
                  <CardHeader>
                    <CardTitle>Compose Message</CardTitle>
                    <CardDescription>
                      Select recipients and compose your message
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">
                        Campaign Name (optional)
                      </label>
                      <Input
                        placeholder="e.g., January Promo"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium">
                        Filter by Lead Status
                      </label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {LEAD_STATUSES.map((s) => (
                          <Badge
                            key={s.value}
                            variant={
                              selectedStatuses.includes(s.value)
                                ? "default"
                                : "outline"
                            }
                            className="cursor-pointer"
                            onClick={() => {
                              setSelectedStatuses((prev) =>
                                prev.includes(s.value)
                                  ? prev.filter((v) => v !== s.value)
                                  : [...prev, s.value]
                              );
                            }}
                          >
                            {s.label}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Message</label>
                      <Textarea
                        placeholder="Type your message here..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={5}
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {message.length}/4096 characters
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={previewRecipients}
                        disabled={
                          previewLoading || selectedStatuses.length === 0
                        }
                      >
                        {previewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Users className="h-4 w-4 mr-2" />
                        )}
                        Preview Recipients
                      </Button>

                      <Button
                        onClick={() => setConfirmDialogOpen(true)}
                        disabled={recipients.length === 0 || !message.trim()}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Send to {recipients.length} Recipients
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Right: Recipients Preview */}
                <Card>
                  <CardHeader>
                    <CardTitle>Recipients Preview</CardTitle>
                    <CardDescription>
                      {recipients.length} customers will receive this message
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[400px] overflow-auto">
                      {recipients.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          Click "Preview Recipients" to see who will receive the
                          message
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {recipients.map((r) => (
                            <div
                              key={r.customer_id}
                              className="flex items-center justify-between p-2 rounded border"
                            >
                              <div>
                                <p className="font-medium">{r.customer_name}</p>
                                <p className="text-sm text-muted-foreground flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {r.phone}
                                </p>
                              </div>
                              {r.lead_status && (
                                <Badge variant="secondary">
                                  {r.lead_status}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="flex-1 overflow-auto p-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Bulk Send History</CardTitle>
                    <CardDescription>
                      Past bulk messaging campaigns
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchHistory}
                    disabled={historyLoading}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${historyLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </CardHeader>
                <CardContent>
                  {historyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : bulkHistory.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      No bulk sends yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {bulkHistory.map((h) => (
                        <div key={h.id} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">
                              {h.name || "Unnamed Campaign"}
                            </span>
                            <Badge
                              variant={
                                h.status === "completed"
                                  ? "default"
                                  : h.status === "in_progress"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {h.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                            {h.message_template}
                          </p>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {h.total_recipients} recipients
                            </span>
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              {h.sent_count} sent
                            </span>
                            {h.failed_count > 0 && (
                              <span className="flex items-center gap-1 text-destructive">
                                <XCircle className="h-4 w-4" />
                                {h.failed_count} failed
                              </span>
                            )}
                            {h.created_at && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                {new Date(h.created_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Send</DialogTitle>
            <DialogDescription>
              You are about to send a message to {recipients.length} recipients.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm font-medium mb-2">Message Preview:</p>
            <div className="p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
              {message}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={sendBulkMessages} disabled={sendingBulk}>
              {sendingBulk ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Messages
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
