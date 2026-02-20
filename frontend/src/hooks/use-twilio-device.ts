/**
 * Hook for managing Twilio Voice device
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { twilioVoiceManager, DeviceState, TwilioCall, IncomingCallInfo } from "@/lib/twilio-voice";
import { voiceService, VoiceConfig } from "@/services/voice-service";
import { useToast } from "./use-toast";
import { useWebSocketEvent } from "./use-websocket";

export interface LeadDetailsPrompt {
  callLogId: string;
  leadId: string | null;
  phoneNumber: string;
  durationSeconds?: number;
}

export interface UseTwilioDeviceReturn {
  // State
  isEnabled: boolean;
  isInitialized: boolean;
  deviceState: DeviceState;
  isOnCall: boolean;
  isMuted: boolean;
  callDuration: number;
  currentCallInfo: CallInfo | null;
  incomingCall: IncomingCallInfo | null;
  pendingLeadDetails: LeadDetailsPrompt | null;
  
  // Actions
  initialize: () => Promise<void>;
  makeCall: (toNumber: string, leadId?: string) => Promise<void>;
  acceptCall: () => void;
  rejectCall: () => void;
  hangup: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
  clearPendingLeadDetails: () => void;
}

interface CallInfo {
  direction: "inbound" | "outbound";
  phoneNumber: string;
  leadId?: string;
  leadName?: string;
  startTime: Date;
}

export function useTwilioDevice(): UseTwilioDeviceReturn {
  const { toast } = useToast();
  
  // State
  const [isEnabled, setIsEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>("offline");
  const [isOnCall, setIsOnCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [currentCallInfo, setCurrentCallInfo] = useState<CallInfo | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [pendingLeadDetails, setPendingLeadDetails] = useState<LeadDetailsPrompt | null>(null);
  
  // Refs
  const durationInterval = useRef<NodeJS.Timeout | null>(null);

  // Listen for WebSocket event when unknown caller needs lead details
  useWebSocketEvent("call:needs_lead_details", (payload: {
    call_log_id: string;
    lead_id: string | null;
    phone_number: string;
  }) => {
    setPendingLeadDetails({
      callLogId: payload.call_log_id,
      leadId: payload.lead_id,
      phoneNumber: payload.phone_number,
    });
    toast({
      title: "New Contact",
      description: "Add details for the caller you just spoke with",
    });
  });

  // Clear pending lead details
  const clearPendingLeadDetails = useCallback(() => {
    setPendingLeadDetails(null);
  }, []);

  /**
   * Start call duration timer
   */
  const startDurationTimer = useCallback(() => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
    }
    setCallDuration(0);
    durationInterval.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  }, []);

  /**
   * Stop call duration timer
   */
  const stopDurationTimer = useCallback(() => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
  }, []);

  /**
   * Check if voice is enabled
   */
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const config = await voiceService.getConfig();
        setIsEnabled(config.voice_enabled);
      } catch {
        console.log("Voice not configured");
        setIsEnabled(false);
      }
    };
    checkConfig();
  }, []);

  /**
   * Initialize Twilio device
   */
  const initialize = useCallback(async () => {
    if (!isEnabled) {
      console.log("Voice calling not enabled");
      return;
    }

    try {
      await twilioVoiceManager.initialize({
        onStateChange: (state) => {
          setDeviceState(state);
          if (state === "ready") {
            setIsInitialized(true);
          }
        },
        onIncomingCall: (call, info) => {
          setIncomingCall(info);
          setIsOnCall(true);
          // Play ringtone or browser notification
          if (Notification.permission === "granted") {
            new Notification("Incoming Call", {
              body: `Call from ${info.leadName || info.from}`,
              icon: "/icon.png",
              tag: "incoming-call",
            });
          }
        },
        onCallConnected: (call) => {
          setIncomingCall(null);
          startDurationTimer();
          toast({
            title: "Call Connected",
            description: "You are now connected",
          });
        },
        onCallDisconnected: (call) => {
          setIsOnCall(false);
          setCurrentCallInfo(null);
          setIsMuted(false);
          stopDurationTimer();
        },
        onCallError: (error) => {
          toast({
            title: "Call Error",
            description: error.message,
            variant: "destructive",
          });
          setIsOnCall(false);
          setCurrentCallInfo(null);
          stopDurationTimer();
        },
        onTokenExpiring: () => {
          console.log("Token expiring, will refresh automatically");
        },
      });
    } catch (error) {
      console.error("Failed to initialize Twilio:", error);
      toast({
        title: "Voice Initialization Failed",
        description: "Could not connect to voice service",
        variant: "destructive",
      });
    }
  }, [isEnabled, toast, startDurationTimer, stopDurationTimer]);

  /**
   * Auto-initialize when enabled
   */
  useEffect(() => {
    if (isEnabled && !isInitialized) {
      initialize();
    }
  }, [isEnabled, isInitialized, initialize]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopDurationTimer();
      twilioVoiceManager.destroy();
    };
  }, [stopDurationTimer]);

  /**
   * Make an outbound call
   */
  const makeCall = useCallback(async (toNumber: string, leadId?: string) => {
    if (!isInitialized) {
      toast({
        title: "Not Ready",
        description: "Voice service is not initialized",
        variant: "destructive",
      });
      return;
    }

    if (isOnCall) {
      toast({
        title: "Already on Call",
        description: "Please end the current call first",
        variant: "destructive",
      });
      return;
    }

    try {
      // Notify backend of call initiation
      await voiceService.initiateCall({ to_number: toNumber, lead_id: leadId });
      
      // Start the WebRTC call
      await twilioVoiceManager.call(toNumber, leadId);
      
      setIsOnCall(true);
      setCurrentCallInfo({
        direction: "outbound",
        phoneNumber: toNumber,
        leadId,
        startTime: new Date(),
      });
      
      toast({
        title: "Calling...",
        description: `Calling ${toNumber}`,
      });
    } catch (error) {
      console.error("Failed to make call:", error);
      toast({
        title: "Call Failed",
        description: error instanceof Error ? error.message : "Could not place call",
        variant: "destructive",
      });
    }
  }, [isInitialized, isOnCall, toast]);

  /**
   * Accept incoming call
   */
  const acceptCall = useCallback(() => {
    if (incomingCall) {
      twilioVoiceManager.acceptCall();
      setCurrentCallInfo({
        direction: "inbound",
        phoneNumber: incomingCall.from,
        leadId: incomingCall.leadId,
        leadName: incomingCall.leadName,
        startTime: new Date(),
      });
      setIncomingCall(null);
    }
  }, [incomingCall]);

  /**
   * Reject incoming call
   */
  const rejectCall = useCallback(() => {
    twilioVoiceManager.rejectCall();
    setIncomingCall(null);
    setIsOnCall(false);
  }, []);

  /**
   * Hang up current call
   */
  const hangup = useCallback(() => {
    twilioVoiceManager.hangup();
    setIsOnCall(false);
    setCurrentCallInfo(null);
    setIsMuted(false);
    stopDurationTimer();
  }, [stopDurationTimer]);

  /**
   * Toggle mute
   */
  const toggleMute = useCallback(() => {
    const newMuteState = twilioVoiceManager.toggleMute();
    setIsMuted(newMuteState);
  }, []);

  /**
   * Send DTMF digits
   */
  const sendDigits = useCallback((digits: string) => {
    twilioVoiceManager.sendDigits(digits);
  }, []);

  return {
    isEnabled,
    isInitialized,
    deviceState,
    isOnCall,
    isMuted,
    callDuration,
    currentCallInfo,
    incomingCall,
    pendingLeadDetails,
    initialize,
    makeCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleMute,
    sendDigits,
    clearPendingLeadDetails,
  };
}
