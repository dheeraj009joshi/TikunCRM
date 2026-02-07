"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { SMSMessage, smsService } from "@/services/sms-service";
import { useToast } from "@/hooks/use-toast";

interface ConversationThreadProps {
  leadId: string;
  leadName: string;
  leadPhone?: string | null;
  onBack?: () => void;
}

export function ConversationThread({ leadId, leadName, leadPhone, onBack }: ConversationThreadProps) {
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [messages, setMessages] = useState<SMSMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Load conversation
  const loadConversation = useCallback(async () => {
    try {
      setLoading(true);
      const conversation = await smsService.getConversation(leadId);
      setMessages(conversation.messages);
      setError(null);
    } catch (err) {
      setError("Failed to load conversation");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [leadId]);
  
  useEffect(() => {
    loadConversation();
  }, [loadConversation]);
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  
  // Send message
  const handleSend = async (body: string) => {
    try {
      const result = await smsService.sendToLead(leadId, body);
      
      if (result.success && result.message_id) {
        // Add optimistic message
        const newMessage: SMSMessage = {
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
          delivered_at: null
        };
        
        setMessages((prev) => [...prev, newMessage]);
      } else {
        toast({
          title: "Failed to send",
          description: result.error || "Could not send message",
          variant: "destructive"
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
    }
  };
  
  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = new Date(message.created_at);
    let dateKey: string;
    
    if (isToday(date)) {
      dateKey = "Today";
    } else if (isYesterday(date)) {
      dateKey = "Yesterday";
    } else {
      dateKey = format(date, "MMMM d, yyyy");
    }
    
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(message);
    
    return groups;
  }, {} as Record<string, SMSMessage[]>);
  
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h2 className="font-semibold">{leadName}</h2>
          {leadPhone && (
            <p className="text-sm text-muted-foreground">{leadPhone}</p>
          )}
        </div>
      </div>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No messages yet. Send a message to start the conversation.
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              {/* Date divider */}
              <div className="flex items-center gap-4 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{date}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              
              {/* Messages for this date */}
              <div className="space-y-2">
                {msgs.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Composer */}
      <MessageComposer onSend={handleSend} />
    </div>
  );
}
