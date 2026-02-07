"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConversationList, ConversationThread } from "@/components/sms";
import { smsService, ConversationListItem, SMSConfig } from "@/services/sms-service";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";

export default function SMSInboxPage() {
  const { toast } = useToast();
  const { lastMessage } = useWebSocket();
  
  const [config, setConfig] = useState<SMSConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  
  // Find selected conversation
  const selectedConversation = conversations.find((c) => c.lead_id === selectedLeadId);
  
  // Load config first
  useEffect(() => {
    smsService.getConfig()
      .then(setConfig)
      .catch(console.error)
      .finally(() => setConfigLoading(false));
  }, []);
  
  // Load conversations only if SMS is enabled
  const loadConversations = useCallback(async () => {
    if (!config?.sms_enabled) return;
    
    try {
      setLoading(true);
      const response = await smsService.listConversations();
      setConversations(response.items);
      setTotalUnread(response.total_unread);
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      setLoading(false);
    }
  }, [config?.sms_enabled]);
  
  // Load conversations when config is loaded and SMS is enabled
  useEffect(() => {
    if (config?.sms_enabled) {
      loadConversations();
    }
  }, [config?.sms_enabled, loadConversations]);
  
  // Handle real-time updates
  useEffect(() => {
    if (!lastMessage || !config?.sms_enabled) return;
    
    if (lastMessage.type === "sms:received" || lastMessage.type === "sms:sent") {
      // Refresh conversations
      loadConversations();
      
      // Show toast for received messages
      if (lastMessage.type === "sms:received") {
        toast({
          title: "New SMS",
          description: lastMessage.payload.body_preview || "New message received",
        });
      }
    }
  }, [lastMessage, loadConversations, toast, config?.sms_enabled]);
  
  // Handle conversation selection
  const handleSelect = (leadId: string) => {
    setSelectedLeadId(leadId);
    
    // Update unread count for this conversation
    const conv = conversations.find((c) => c.lead_id === leadId);
    if (conv && conv.unread_count > 0) {
      setConversations((prev) =>
        prev.map((c) =>
          c.lead_id === leadId ? { ...c, unread_count: 0 } : c
        )
      );
      setTotalUnread((prev) => Math.max(0, prev - conv.unread_count));
    }
  };
  
  // Still loading config
  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // Not configured - show Coming Soon
  if (!config?.sms_enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] text-center px-4">
        <div className="bg-primary/10 rounded-full p-6 mb-6">
          <MessageSquare className="h-16 w-16 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-3">SMS Messaging Coming Soon!</h2>
        <p className="text-muted-foreground max-w-md mb-6">
          In-app SMS messaging is being configured and will be available soon.
        </p>
        <div className="bg-muted/50 rounded-lg p-6 max-w-md">
          <h3 className="font-semibold mb-2">In the meantime:</h3>
          <p className="text-sm text-muted-foreground">
            You can still text leads manually using your phone. 
            Click on a lead&apos;s phone number to copy it, or use the phone icon 
            to call them directly from your device.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">SMS Inbox</h1>
          <p className="text-muted-foreground">
            {totalUnread > 0
              ? `${totalUnread} unread message${totalUnread > 1 ? "s" : ""}`
              : "All caught up"}
          </p>
        </div>
        <Button variant="outline" onClick={loadConversations} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      
      {/* Content */}
      <Card className="flex-1 flex overflow-hidden">
        {/* Conversation List (left panel) */}
        <div className={`w-full md:w-80 lg:w-96 border-r overflow-y-auto ${selectedLeadId ? "hidden md:block" : ""}`}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedLeadId={selectedLeadId || undefined}
              onSelect={handleSelect}
            />
          )}
        </div>
        
        {/* Conversation Thread (right panel) */}
        <div className={`flex-1 ${!selectedLeadId ? "hidden md:flex" : "flex"}`}>
          {selectedLeadId && selectedConversation ? (
            <ConversationThread
              leadId={selectedLeadId}
              leadName={selectedConversation.lead_name}
              leadPhone={selectedConversation.lead_phone}
              onBack={() => setSelectedLeadId(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Select a conversation to start messaging</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
