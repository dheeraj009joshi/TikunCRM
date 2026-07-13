/**
 * Hook for managing Twilio Voice device
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { twilioVoiceManager, DeviceState, TwilioCall, IncomingCallInfo } from "@/lib/twilio-voice";
import { voiceService, VoiceConfig } from "@/services/voice-service";
import { startIncomingRingtone, stopIncomingRingtone } from "@/lib/incoming-ringtone";
import { useToast } from "./use-toast";
import { useWebSocketEvent } from "./use-websocket";
import { useBdcDealership } from "@/contexts/bdc-dealership-context";

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
  /** Dismiss ringing on this device only; other agents keep ringing. */
  ignoreCall: () => void;
  /** Alias of ignoreCall (kept for callers that still say reject). */
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
  const { selectedDealershipId } = useBdcDealership();
  
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
  const incomingCallRef = useRef<IncomingCallInfo | null>(null);
  const activeCallRef = useRef<CallInfo | null>(null);
  const acceptingRef = useRef(false);
  incomingCallRef.current = incomingCall;
  activeCallRef.current = currentCallInfo;

  const matchesIncomingCall = useCallback(
    (payload: {
      call_sid?: string | null;
      parent_call_sid?: string | null;
      child_call_sid?: string | null;
    }) => {
      const incoming = incomingCallRef.current;
      if (!incoming) return false;
      const ids = [payload.call_sid, payload.parent_call_sid, payload.child_call_sid].filter(
        Boolean
      ) as string[];
      if (ids.length === 0) return true;
      return (
        ids.includes(incoming.callSid) ||
        (!!incoming.parentCallSid && ids.includes(incoming.parentCallSid))
      );
    },
    []
  );

  const dismissIncomingLocally = useCallback((alsoIgnoreTwilio: boolean) => {
    stopIncomingRingtone();
    if (alsoIgnoreTwilio) {
      try {
        twilioVoiceManager.ignoreCall();
      } catch {
        /* already closed */
      }
    }
    setIncomingCall(null);
    if (!activeCallRef.current && !acceptingRef.current) {
      setIsOnCall(false);
    }
  }, []);

  // Someone else answered — clear modal for everyone still ringing
  useWebSocketEvent(
    "call:answered",
    (payload: {
      call_sid?: string;
      parent_call_sid?: string | null;
      child_call_sid?: string | null;
      answered_by?: string;
    }) => {
      if (acceptingRef.current || activeCallRef.current) return;
      if (!matchesIncomingCall(payload)) return;
      dismissIncomingLocally(true);
    },
    [matchesIncomingCall, dismissIncomingLocally]
  );

  // Ring group finished (timeout / no-answer) — clear leftover modals
  useWebSocketEvent(
    "call:ring_ended",
    (payload: { call_sid?: string; status?: string }) => {
      if (acceptingRef.current || activeCallRef.current) return;
      if (!matchesIncomingCall(payload)) return;
      dismissIncomingLocally(true);
    },
    [matchesIncomingCall, dismissIncomingLocally]
  );

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
      await twilioVoiceManager.initialize(
        {
        onStateChange: (state) => {
          setDeviceState(state);
          if (state === "ready") {
            setIsInitialized(true);
          }
        },
        onIncomingCall: (call, info) => {
          setIncomingCall(info);
          // Ringing is not an active connected call — keep Accept/Ignore modal only
          setIsOnCall(false);
          startIncomingRingtone();
          if (typeof document !== "undefined" && document.hidden && Notification.permission === "granted") {
            try {
              const n = new Notification("Incoming Call", {
                body: `Call from ${info.leadName || info.from}`,
                icon: "/icon.svg",
                tag: `incoming-call-${info.callSid || "ring"}`,
                requireInteraction: true,
              });
              n.onclick = () => {
                window.focus();
                n.close();
              };
            } catch {
              /* Notification may fail if permission revoked mid-session */
            }
          }
        },
        onCallConnected: (call) => {
          acceptingRef.current = false;
          stopIncomingRingtone();
          setIncomingCall(null);
          setIsOnCall(true);
          startDurationTimer();
          toast({
            title: "Call Connected",
            description: "You are now connected",
          });
        },
        onCallDisconnected: (call) => {
          acceptingRef.current = false;
          stopIncomingRingtone();
          // Ending YOUR connected call clears active UI.
          // Do NOT clear the incoming modal here — Ignore is local-only.
          // Clear-all for others happens via call:answered / call:ring_ended.
          if (activeCallRef.current) {
            setCurrentCallInfo(null);
            setIsMuted(false);
            stopDurationTimer();
            setIsOnCall(false);
          }
        },
        onCallError: (error) => {
          acceptingRef.current = false;
          stopIncomingRingtone();
          toast({
            title: "Call Error",
            description: error.message,
            variant: "destructive",
          });
          if (activeCallRef.current) {
            setCurrentCallInfo(null);
            setIsOnCall(false);
            stopDurationTimer();
          }
        },
        onTokenExpiring: () => {
          console.log("Token expiring, will refresh automatically");
        },
      },
        selectedDealershipId
      );
    } catch (error) {
      console.error("Failed to initialize Twilio:", error);
      toast({
        title: "Voice Initialization Failed",
        description: "Could not connect to voice service",
        variant: "destructive",
      });
    }
  }, [isEnabled, toast, startDurationTimer, stopDurationTimer, selectedDealershipId]);

  /**
   * Auto-initialize when enabled
   */
  useEffect(() => {
    if (isEnabled && !isInitialized) {
      initialize();
    }
  }, [isEnabled, isInitialized, initialize]);

  /**
   * When the tab becomes visible again, re-register Twilio (browsers throttle
   * background tabs and may drop the Voice signaling connection).
   */
  useEffect(() => {
    if (!isInitialized) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void twilioVoiceManager.ensureRegistered();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isInitialized]);

  /**
   * Focus CRM from an FCM incoming-call notification click (service worker).
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.type === "INCOMING_CALL_CLICK" || data.type === "NOTIFICATION_CLICK") {
        void twilioVoiceManager.ensureRegistered();
        window.focus();
        if (typeof data.url === "string" && data.url.startsWith("/") && data.url !== window.location.pathname) {
          // Soft navigate only if we're not already there
          try {
            window.history.pushState({}, "", data.url);
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch {
            window.location.href = data.url;
          }
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopIncomingRingtone();
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
      acceptingRef.current = true;
      stopIncomingRingtone();
      setCurrentCallInfo({
        direction: "inbound",
        phoneNumber: incomingCall.from,
        leadId: incomingCall.leadId,
        leadName: incomingCall.leadName,
        startTime: new Date(),
      });
      setIncomingCall(null);
      setIsOnCall(true);
      twilioVoiceManager.acceptCall();
    }
  }, [incomingCall]);

  /**
   * Ignore incoming call on this device only (other agents keep ringing).
   */
  const ignoreCall = useCallback(() => {
    stopIncomingRingtone();
    twilioVoiceManager.ignoreCall();
    setIncomingCall(null);
    if (!activeCallRef.current) {
      setIsOnCall(false);
    }
  }, []);

  /**
   * Alias of ignoreCall — must not reject/hang up the ring group for others.
   */
  const rejectCall = useCallback(() => {
    stopIncomingRingtone();
    twilioVoiceManager.ignoreCall();
    setIncomingCall(null);
    if (!activeCallRef.current) {
      setIsOnCall(false);
    }
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
    ignoreCall,
    rejectCall,
    hangup,
    toggleMute,
    sendDigits,
    clearPendingLeadDetails,
  };
}
