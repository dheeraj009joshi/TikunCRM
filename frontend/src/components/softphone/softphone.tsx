"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Phone, PhoneOff, X, Minimize2, Maximize2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTwilioDevice } from "@/hooks/use-twilio-device";
import { useCallLeadOptional } from "@/contexts/call-lead-context";
import { DialPad } from "./dial-pad";
import { CallControls } from "./call-controls";
import { IncomingCallModal } from "./incoming-call-modal";
import { LeadDetailsModal } from "./lead-details-modal";
import { voiceService } from "@/services/voice-service";
import { useToast } from "@/hooks/use-toast";

interface SoftphoneProps {
  className?: string;
  leadPhone?: string;
  leadId?: string;
  leadName?: string;
  asButton?: boolean;
}

export function Softphone({ className, leadPhone, leadId, leadName, asButton }: SoftphoneProps) {
  const {
    isEnabled,
    isInitialized,
    deviceState,
    isOnCall,
    isMuted,
    callDuration,
    currentCallInfo,
    incomingCall,
    pendingLeadDetails,
    makeCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMute,
    sendDigits,
    clearPendingLeadDetails,
  } = useTwilioDevice();
  
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(leadPhone || "");
  const [showDialPad, setShowDialPad] = useState(true);
  const [pendingLeadId, setPendingLeadId] = useState<string | undefined>(undefined);
  const callLeadCtx = useCallLeadOptional();

  // When "Call lead" is set from context (e.g. lead page), open softphone and prefill number
  useEffect(() => {
    const lead = callLeadCtx?.callLead;
    if (!lead?.phone) return;
    setPhoneNumber(lead.phone);
    setPendingLeadId(lead.leadId);
    setIsOpen(true);
    setIsMinimized(false);
    callLeadCtx?.clearCallLead();
  }, [callLeadCtx?.callLead]);

  // Update phone number when leadPhone prop changes (e.g. from context via layout)
  useEffect(() => {
    if (leadPhone) {
      setPhoneNumber(leadPhone);
    }
  }, [leadPhone]);

  // Auto-open when there's an incoming call
  useEffect(() => {
    if (incomingCall) {
      setIsOpen(true);
      setIsMinimized(false);
    }
  }, [incomingCall]);

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle dial pad input
  const handleDigit = useCallback(
    (digit: string) => {
      if (isOnCall) {
        sendDigits(digit);
      } else {
        setPhoneNumber((prev) => prev + digit);
      }
    },
    [isOnCall, sendDigits]
  );

  // Handle call button click (use prop leadId or pending from context)
  const effectiveLeadId = leadId ?? pendingLeadId;
  const handleCall = useCallback(async () => {
    if (!phoneNumber.trim()) return;
    await makeCall(phoneNumber, effectiveLeadId);
  }, [phoneNumber, effectiveLeadId, makeCall]);

  // Handle backspace
  const handleBackspace = useCallback(() => {
    if (!isOnCall) {
      setPhoneNumber((prev) => prev.slice(0, -1));
    }
  }, [isOnCall]);

  // Clear number
  const handleClear = useCallback(() => {
    if (!isOnCall) {
      setPhoneNumber("");
    }
  }, [isOnCall]);

  // Handle saving lead details for unknown caller
  const handleSaveLeadDetails = useCallback(async (data: {
    firstName: string;
    lastName: string;
    email?: string;
  }) => {
    if (!pendingLeadDetails) return;
    
    await voiceService.updateLeadDetails(pendingLeadDetails.callLogId, {
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
    });
    
    toast({
      title: "Lead Saved",
      description: `${data.firstName} ${data.lastName} has been added as a lead`,
    });
    
    clearPendingLeadDetails();
  }, [pendingLeadDetails, toast, clearPendingLeadDetails]);

  // If not enabled, show "Coming Soon" message
  if (!isEnabled) {
    if (asButton) {
      return (
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Voice calling coming soon"
        >
          <Phone className="h-4 w-4 mr-2" />
          Call (Coming Soon)
        </Button>
      );
    }
    // Don't show the floating softphone widget if not enabled
    return null;
  }

  // If used as a button (click-to-call from lead page)
  if (asButton) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPhoneNumber(leadPhone || "");
            setIsOpen(true);
          }}
          disabled={!isInitialized || deviceState !== "ready"}
        >
          <Phone className="h-4 w-4 mr-2" />
          Call
        </Button>

        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) setPendingLeadId(undefined); setIsOpen(open); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {isOnCall
                  ? currentCallInfo?.leadName || "On Call"
                  : `Call ${leadName || "Contact"}`}
              </DialogTitle>
            </DialogHeader>
            <SoftphoneContent
              phoneNumber={phoneNumber}
              setPhoneNumber={setPhoneNumber}
              isOnCall={isOnCall}
              isMuted={isMuted}
              callDuration={callDuration}
              currentCallInfo={currentCallInfo}
              deviceState={deviceState}
              showDialPad={showDialPad}
              onDigit={handleDigit}
              onCall={handleCall}
              onHangup={hangup}
              onMuteToggle={toggleMute}
              onBackspace={handleBackspace}
              onClear={handleClear}
              onDialPadToggle={() => setShowDialPad(!showDialPad)}
              formatDuration={formatDuration}
            />
          </DialogContent>
        </Dialog>

        <IncomingCallModal
          call={incomingCall}
          onAccept={acceptCall}
          onReject={rejectCall}
        />

        <LeadDetailsModal
          info={pendingLeadDetails}
          onSave={handleSaveLeadDetails}
          onSkip={clearPendingLeadDetails}
        />
      </>
    );
  }

  // Floating softphone widget – only show FAB when there's a lead to call or we're on a call (not on every page forever)
  const showFloatingButton = !isOpen && (!!leadPhone || !!leadId || isOnCall);
  return (
    <>
      {/* Floating button when minimized or closed – only when lead context or on call */}
      {showFloatingButton && (
        <Button
          className={cn(
            "fixed bottom-4 right-4 h-14 w-14 rounded-full shadow-lg z-50",
            isOnCall && "bg-green-500 hover:bg-green-600 animate-pulse",
            className
          )}
          onClick={() => setIsOpen(true)}
        >
          <Phone className="h-6 w-6" />
        </Button>
      )}

      {/* Softphone window */}
      {isOpen && (
        <Card
          className={cn(
            "fixed bottom-4 right-4 z-50 shadow-xl",
            isMinimized ? "w-64" : "w-80",
            className
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b bg-muted/50">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  deviceState === "ready" && "bg-green-500",
                  deviceState === "busy" && "bg-yellow-500",
                  deviceState === "connecting" && "bg-yellow-500 animate-pulse",
                  deviceState === "offline" && "bg-gray-400",
                  deviceState === "error" && "bg-red-500"
                )}
              />
              <span className="text-sm font-medium">
                {isOnCall
                  ? formatDuration(callDuration)
                  : deviceState === "ready"
                  ? "Ready"
                  : deviceState}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsMinimized(!isMinimized)}
              >
                {isMinimized ? (
                  <Maximize2 className="h-3 w-3" />
                ) : (
                  <Minimize2 className="h-3 w-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Content */}
          {!isMinimized && (
            <CardContent className="p-4">
              <SoftphoneContent
                phoneNumber={phoneNumber}
                setPhoneNumber={setPhoneNumber}
                isOnCall={isOnCall}
                isMuted={isMuted}
                callDuration={callDuration}
                currentCallInfo={currentCallInfo}
                deviceState={deviceState}
                showDialPad={showDialPad}
                onDigit={handleDigit}
                onCall={handleCall}
                onHangup={hangup}
                onMuteToggle={toggleMute}
                onBackspace={handleBackspace}
                onClear={handleClear}
                onDialPadToggle={() => setShowDialPad(!showDialPad)}
                formatDuration={formatDuration}
              />
            </CardContent>
          )}

          {/* Minimized view - show call info */}
          {isMinimized && isOnCall && (
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="text-sm truncate max-w-[120px]">
                    {currentCallInfo?.leadName || currentCallInfo?.phoneNumber}
                  </span>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8"
                  onClick={hangup}
                >
                  <PhoneOff className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Incoming call modal */}
      <IncomingCallModal
        call={incomingCall}
        onAccept={acceptCall}
        onReject={rejectCall}
      />

      {/* Lead details modal for unknown callers */}
      <LeadDetailsModal
        info={pendingLeadDetails}
        onSave={handleSaveLeadDetails}
        onSkip={clearPendingLeadDetails}
      />
    </>
  );
}

// Internal content component
interface SoftphoneContentProps {
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  isOnCall: boolean;
  isMuted: boolean;
  callDuration: number;
  currentCallInfo: {
    direction: "inbound" | "outbound";
    phoneNumber: string;
    leadId?: string;
    leadName?: string;
    startTime: Date;
  } | null;
  deviceState: string;
  showDialPad: boolean;
  onDigit: (digit: string) => void;
  onCall: () => void;
  onHangup: () => void;
  onMuteToggle: () => void;
  onBackspace: () => void;
  onClear: () => void;
  onDialPadToggle: () => void;
  formatDuration: (seconds: number) => string;
}

function SoftphoneContent({
  phoneNumber,
  setPhoneNumber,
  isOnCall,
  isMuted,
  callDuration,
  currentCallInfo,
  deviceState,
  showDialPad,
  onDigit,
  onCall,
  onHangup,
  onMuteToggle,
  onBackspace,
  onClear,
  onDialPadToggle,
  formatDuration,
}: SoftphoneContentProps) {
  return (
    <div className="space-y-4">
      {/* Current call info */}
      {isOnCall && currentCallInfo && (
        <div className="text-center py-4">
          <div className="flex justify-center mb-2">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-8 w-8 text-primary" />
            </div>
          </div>
          <p className="font-medium">
            {currentCallInfo.leadName || currentCallInfo.phoneNumber}
          </p>
          <p className="text-sm text-muted-foreground">
            {currentCallInfo.direction === "inbound" ? "Inbound" : "Outbound"} call
          </p>
          <p className="text-2xl font-mono mt-2">{formatDuration(callDuration)}</p>
        </div>
      )}

      {/* Phone number input */}
      {!isOnCall && (
        <div className="relative">
          <Input
            type="tel"
            placeholder="Enter phone number"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="text-center text-xl font-mono pr-8"
          />
          {phoneNumber && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={onClear}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Dial pad */}
      {showDialPad && (
        <div className="space-y-2">
          <DialPad onDigit={onDigit} />
          {!isOnCall && phoneNumber && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={onBackspace}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Call controls */}
      {isOnCall ? (
        <CallControls
          isOnCall={isOnCall}
          isMuted={isMuted}
          onMuteToggle={onMuteToggle}
          onHangup={onHangup}
          onDialPadToggle={onDialPadToggle}
          showDialPad={showDialPad}
        />
      ) : (
        <Button
          className="w-full bg-green-500 hover:bg-green-600"
          size="lg"
          onClick={onCall}
          disabled={!phoneNumber.trim() || deviceState !== "ready"}
        >
          <Phone className="h-5 w-5 mr-2" />
          Call
        </Button>
      )}
    </div>
  );
}
