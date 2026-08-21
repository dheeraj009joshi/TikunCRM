/**
 * Hook for managing Twilio Voice device
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { twilioVoiceManager, DeviceState, TwilioCall, IncomingCallInfo } from "@/lib/twilio-voice";
import { voiceService, VoiceConfig } from "@/services/voice-service";
import { startIncomingRingtone, stopIncomingRingtone } from "@/lib/incoming-ringtone";
import { showIncomingCallPip, dismissIncomingCallPip } from "@/lib/incoming-call-pip";
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
  const { selectedDealershipId, dealerships, isLoading: bdcDealershipsLoading } = useBdcDealership();
  
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
  const acceptCallRef = useRef<() => void>(() => {});
  const ignoreCallRef = useRef<() => void>(() => {});
  incomingCallRef.current = incomingCall;
  activeCallRef.current = currentCallInfo;

  const matchesIncomingCall = useCallback(
    (payload: {
      call_sid?: string | null;
      parent_call_sid?: string | null;
      child_call_sid?: string | null;
      call_log_id?: string | null;
    }) => {
      const incoming = incomingCallRef.current;
      if (!incoming) return false;

      // Match by call_log_id first (most reliable for ring groups)
      if (payload.call_log_id && incoming.callLogId && payload.call_log_id === incoming.callLogId) {
        return true;
      }

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
    dismissIncomingCallPip();
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
      call_log_id?: string;
      answered_by?: string;
    }) => {
      if (acceptingRef.current || activeCallRef.current) return;
      if (!matchesIncomingCall(payload)) return;
      dismissIncomingLocally(true);
    },
    [matchesIncomingCall, dismissIncomingLocally]
  );

  // Enrich incoming call info with parent SID / callLogId from backend WS event.
  // Twilio's SDK doesn't always provide ParentCallSid for <Client> ring groups,
  // but our backend sends it via WS which makes call:answered matching reliable.
  useWebSocketEvent(
    "call:incoming",
    (payload: {
      call_sid?: string;
      call_log_id?: string;
      from_number?: string;
      lead_id?: string;
      lead_name?: string;
    }) => {
      const incoming = incomingCallRef.current;
      if (!incoming) return;
      // Match by from number or if parentCallSid already matches
      const fromMatch = payload.from_number && incoming.from.includes(payload.from_number.replace(/^\+/, ""));
      const sidMatch = payload.call_sid && (
        incoming.parentCallSid === payload.call_sid || incoming.callSid === payload.call_sid
      );
      if (fromMatch || sidMatch) {
        if (payload.call_sid && !incoming.parentCallSid) {
          incoming.parentCallSid = payload.call_sid;
        }
        if (payload.call_log_id) {
          incoming.callLogId = payload.call_log_id;
        }
        setIncomingCall({ ...incoming });
      }
    },
    []
  );

  // Ring group finished (timeout / no-answer) — clear leftover modals
  useWebSocketEvent(
    "call:ring_ended",
    (payload: { call_sid?: string; status?: string; call_log_id?: string }) => {
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
   * Softphone registration dealerships (inbound).
   *
   * CRITICAL for multi-store BDC: always register on EVERY accessible store,
   * not just the UI-selected one. The dealership filter only scopes leads/UI —
   * inbound numbers live on per-store Twilio accounts, so a Device registered
   * only for store A will never receive Dial invites for store B's number.
   *
   * Sales/admin → empty list (backend uses user.dealership_id).
   */
  const inboundVoiceDealershipIds =
    dealerships.length > 0 ? dealerships.map((d) => d.id) : ([] as string[]);

  /**
   * Outbound primary dealership (selected filter, else first accessible).
   */
  const outboundVoiceDealershipId =
    selectedDealershipId ?? inboundVoiceDealershipIds[0] ?? null;

  /**
   * Check if voice is enabled (wait for BDC dealership list first)
   */
  useEffect(() => {
    if (bdcDealershipsLoading) return;

    const checkConfig = async () => {
      try {
        if (inboundVoiceDealershipIds.length === 0) {
          const config = await voiceService.getConfig();
          setIsEnabled(config.voice_enabled);
          return;
        }
        for (const id of inboundVoiceDealershipIds) {
          try {
            const config = await voiceService.getConfig(id);
            if (config.voice_enabled) {
              setIsEnabled(true);
              return;
            }
          } catch {
            /* try next store */
          }
        }
        setIsEnabled(false);
      } catch {
        console.log("Voice not configured");
        setIsEnabled(false);
      }
    };
    void checkConfig();
  }, [bdcDealershipsLoading, selectedDealershipId, dealerships]);

  /**
   * Initialize Twilio device
   */
  const initialize = useCallback(async () => {
    if (!isEnabled) {
      console.log("Voice calling not enabled");
      return;
    }
    if (bdcDealershipsLoading) {
      console.log("Voice waiting for BDC dealership list");
      return;
    }

    // Primary = preferred outbound store; extras = every other accessible store
    // so inbound rings on all dealership Twilio accounts.
    const primary = outboundVoiceDealershipId;
    const extras = inboundVoiceDealershipIds.filter((id) => id !== primary);

    try {
      await twilioVoiceManager.initialize(
        {
        onStateChange: (state) => {
          setDeviceState(state);
          if (state === "ready") {
            setIsInitialized(true);
          } else if (state === "offline") {
            setIsInitialized(false);
          }
        },
        onIncomingCall: (call, info) => {
          // Allow call-waiting: second inbound while on a call still shows the modal
          setIncomingCall(info);
          if (!activeCallRef.current) {
            setIsOnCall(false);
          }
          startIncomingRingtone();
          if (typeof document !== "undefined" && document.hidden && Notification.permission === "granted") {
            try {
              const n = new Notification(
                activeCallRef.current ? "Call Waiting" : "Incoming Call",
                {
                  body: `Call from ${info.leadName || info.from}`,
                  icon: "/icon.svg",
                  tag: `incoming-call-${info.callSid || "ring"}`,
                  requireInteraction: true,
                }
              );
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
          const stillOnCall = !!twilioVoiceManager.getCurrentCall() &&
            twilioVoiceManager.getCurrentCall()?.status() === "open";
          if (stillOnCall) {
            if (incomingCallRef.current) {
              setIncomingCall(null);
              stopIncomingRingtone();
              dismissIncomingCallPip();
            }
            return;
          }
          stopIncomingRingtone();
          dismissIncomingCallPip();
          if (activeCallRef.current) {
            setCurrentCallInfo(null);
            setIsMuted(false);
            stopDurationTimer();
            setIsOnCall(false);
          } else if (incomingCallRef.current) {
            setIncomingCall(null);
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
        primary,
        extras
      );
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to initialize Twilio:", error);
      setIsInitialized(false);
      toast({
        title: "Voice Initialization Failed",
        description: "Could not connect to voice service",
        variant: "destructive",
      });
    }
  }, [
    isEnabled,
    toast,
    startDurationTimer,
    stopDurationTimer,
    bdcDealershipsLoading,
    selectedDealershipId,
    dealerships,
  ]);

  /**
   * Auto-initialize / re-init when dealership selection changes
   */
  useEffect(() => {
    if (!isEnabled || bdcDealershipsLoading) return;
    void initialize();
  }, [isEnabled, bdcDealershipsLoading, initialize]);

  /**
   * When the tab becomes visible again, force a real Twilio signaling reconnect.
   * Browsers can drop the Voice WS while Device still reports "registered".
   */
  useEffect(() => {
    if (!isEnabled) return;

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!twilioVoiceManager.getIsInitialized()) {
        // Destroyed / offline — hook auto-init effect will rebuild
        void initialize();
        return;
      }
      void twilioVoiceManager.ensureRegistered(true);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [isEnabled, initialize]);

  /**
   * Handle service worker messages:
   * - WAKE_FOR_INCOMING_CALL: force Twilio reconnect before Dial invite arrives
   * - INCOMING_CALL_CLICK / NOTIFICATION_CLICK: focus tab + reconnect
   * - ACCEPT_INCOMING_CALL: accept if Twilio invite is already pending
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data || {};

      if (data.type === "WAKE_FOR_INCOMING_CALL") {
        // Do not force unregister+register — that drops a live Dial invite
        // (one ring, then Twilio plays "application error").
        if (twilioVoiceManager.isOnAnyCall()) {
          console.log("SW wake skipped — already ringing/on a call");
          return;
        }
        if (!twilioVoiceManager.getIsInitialized()) {
          void initialize();
        } else {
          void twilioVoiceManager.ensureRegistered(false);
        }
        return;
      }

      if (data.type === "ACCEPT_INCOMING_CALL") {
        window.focus();
        if (incomingCallRef.current && !activeCallRef.current) {
          // acceptCallRef is kept in sync below; call through it for shared accept logic
          acceptCallRef.current();
        } else {
          void twilioVoiceManager.ensureRegistered(true);
        }
        return;
      }

      if (data.type === "INCOMING_CALL_CLICK" || data.type === "NOTIFICATION_CLICK") {
        if (!twilioVoiceManager.getIsInitialized()) {
          void initialize();
        } else {
          void twilioVoiceManager.ensureRegistered(true);
        }
        window.focus();
        if (typeof data.url === "string" && data.url.startsWith("/") && data.url !== window.location.pathname) {
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
  }, [initialize]);

  /**
   * Page Lifecycle API: force reconnect when the page resumes from
   * a frozen/discarded state (aggressive browser power saving).
   */
  useEffect(() => {
    if (!isEnabled) return;

    const onResume = () => {
      console.log("Page resumed from freeze — forcing Twilio reconnect");
      if (!twilioVoiceManager.getIsInitialized()) {
        void initialize();
      } else {
        void twilioVoiceManager.ensureRegistered(true);
      }
    };

    document.addEventListener("resume", onResume);
    return () => document.removeEventListener("resume", onResume);
  }, [isEnabled, initialize]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopIncomingRingtone();
      dismissIncomingCallPip();
      stopDurationTimer();
      twilioVoiceManager.destroy();
    };
  }, [stopDurationTimer]);

  /**
   * Show Document Picture-in-Picture popup when an incoming call arrives.
   * The floating window stays on top of all other apps even when the CRM
   * tab is in the background — similar to WhatsApp/Telegram desktop.
   */
  useEffect(() => {
    if (!incomingCall) {
      dismissIncomingCallPip();
      return;
    }

    showIncomingCallPip(incomingCall, {
      onAccept: () => acceptCallRef.current(),
      onIgnore: () => ignoreCallRef.current(),
    });

    return () => {
      dismissIncomingCallPip();
    };
  }, [incomingCall]);

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
      dismissIncomingCallPip();
      setCurrentCallInfo({
        direction: "inbound",
        phoneNumber: incomingCall.from,
        leadId: incomingCall.leadId,
        leadName: incomingCall.leadName,
        startTime: new Date(),
      });
      setIncomingCall(null);
      setIsOnCall(true);
      stopDurationTimer();
      startDurationTimer();
      twilioVoiceManager.acceptCall();
    }
  }, [incomingCall, stopDurationTimer, startDurationTimer]);

  /**
   * Ignore incoming call on this device only (other agents keep ringing).
   */
  const ignoreCall = useCallback(() => {
    stopIncomingRingtone();
    dismissIncomingCallPip();
    twilioVoiceManager.ignoreCall();
    setIncomingCall(null);
    if (!activeCallRef.current) {
      setIsOnCall(false);
    }
  }, []);

  // Keep PiP button refs in sync with the latest accept/ignore callbacks
  useEffect(() => {
    acceptCallRef.current = acceptCall;
    ignoreCallRef.current = ignoreCall;
  }, [acceptCall, ignoreCall]);

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
