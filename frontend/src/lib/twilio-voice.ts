/**
 * Twilio Voice SDK Wrapper
 * Manages WebRTC device and call connections
 */

import { voiceService } from "@/services/voice-service";

// Types for Twilio Voice SDK (loaded dynamically)
export interface TwilioDevice {
  register(): Promise<void>;
  unregister(): Promise<void>;
  destroy(): void;
  connect(params: { params: Record<string, string> }): Promise<TwilioCall>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
  state: "unregistered" | "registering" | "registered" | "destroying" | "destroyed";
  isBusy: boolean;
}

export interface TwilioCall {
  accept(): void;
  reject(): void;
  ignore(): void;
  disconnect(): void;
  mute(shouldMute?: boolean): void;
  isMuted(): boolean;
  sendDigits(digits: string): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
  status(): string;
  parameters: {
    CallSid?: string;
    ParentCallSid?: string;
    From?: string;
    To?: string;
  };
  customParameters: Map<string, string>;
}

export type DeviceState = "offline" | "connecting" | "ready" | "busy" | "error";

export interface IncomingCallInfo {
  callSid: string;
  parentCallSid?: string;
  callLogId?: string;
  from: string;
  leadId?: string;
  leadName?: string;
}

export type TwilioEventCallback = {
  onStateChange?: (state: DeviceState) => void;
  onIncomingCall?: (call: TwilioCall, info: IncomingCallInfo) => void;
  onCallConnected?: (call: TwilioCall) => void;
  onCallDisconnected?: (call: TwilioCall | null) => void;
  onCallError?: (error: Error) => void;
  onTokenExpiring?: () => void;
};

class TwilioVoiceManager {
  private device: TwilioDevice | null = null;
  /** Extra Devices so BDC can receive inbound on every accessible store's Twilio account */
  private extraDevices: Map<string, TwilioDevice> = new Map();
  /** Active connected (or ringing-only when not busy) call */
  private currentCall: TwilioCall | null = null;
  /** Second inbound while already on a call (call waiting) */
  private pendingIncomingCall: TwilioCall | null = null;
  private callbacks: TwilioEventCallback = {};
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private keepAliveWorker: Worker | null = null;
  private keepAliveTicks = 0;
  private reconnectInFlight: Promise<void> | null = null;
  private isInitialized = false;
  private dealershipId: string | null = null;
  /** Dealerships currently registered (for change detection) */
  private registeredDealershipKey = "";

  /**
   * Initialize the Twilio Device with an access token.
   * Pass extraDealershipIds for BDC "All stores" so inbound Dial on any
   * store Twilio account can reach this softphone.
   */
  async initialize(
    callbacks: TwilioEventCallback = {},
    dealershipId?: string | null,
    extraDealershipIds: string[] = []
  ): Promise<void> {
    const primary = dealershipId ?? null;
    const extras = [
      ...new Set(extraDealershipIds.filter((id): id is string => !!id && id !== primary)),
    ];
    const key = [primary ?? "", ...extras].sort().join(",");

    if (this.isInitialized && this.registeredDealershipKey === key) {
      console.log("Twilio already initialized for dealerships:", key || "(user default)");
      this.callbacks = callbacks;
      return;
    }

    if (this.isInitialized) {
      console.log("Twilio dealership set changed — reinitializing", key);
      this.destroy();
    }

    this.callbacks = callbacks;
    this.dealershipId = primary;
    this.registeredDealershipKey = key;
    this.notifyStateChange("connecting");

    try {
      const { Device } = await import("@twilio/voice-sdk");

      const tokenData = await voiceService.getToken(this.dealershipId);
      const options = {
        logLevel: 1 as const,
        codecPreferences: ["opus", "pcmu"],
        allowIncomingWhileBusy: true,
        closeProtection: true,
      };
      this.device = new Device(
        tokenData.token,
        options as ConstructorParameters<typeof Device>[1]
      ) as unknown as TwilioDevice;

      this.setupDeviceListeners(this.device, true);
      await this.device.register();

      this.isInitialized = true;
      this.notifyStateChange("ready");
      this.scheduleTokenRefresh(tokenData.expires_in);
      this.startKeepAlive();

      console.log(
        "Twilio Voice initialized (primary dealership=%s)",
        this.dealershipId || "user-default"
      );

      for (const extraId of extras) {
        try {
          const extraToken = await voiceService.getToken(extraId);
          const extraDevice = new Device(
            extraToken.token,
            options as ConstructorParameters<typeof Device>[1]
          ) as unknown as TwilioDevice;
          this.setupDeviceListeners(extraDevice, false);
          await extraDevice.register();
          this.extraDevices.set(extraId, extraDevice);
          console.log("Twilio Voice extra device registered for dealership", extraId);
        } catch (e) {
          console.warn("Twilio extra device failed for dealership", extraId, e);
        }
      }
    } catch (error) {
      console.error("Failed to initialize Twilio Voice:", error);
      this.notifyStateChange("error");
      this.isInitialized = false;
      this.registeredDealershipKey = "";
      throw error;
    }
  }

  /**
   * Set up event listeners on a Twilio Device
   */
  private setupDeviceListeners(device: TwilioDevice, isPrimary: boolean): void {
    device.on("registered", () => {
      console.log("Twilio device registered", isPrimary ? "(primary)" : "(extra)");
      if (isPrimary) this.notifyStateChange("ready");
    });

    device.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Twilio device error:", error);
      this.callbacks.onCallError?.(error);
      if (isPrimary) this.notifyStateChange("error");
    });

    device.on("incoming", (call: unknown) => {
      this.handleIncomingInvite(call as TwilioCall);
    });

    if (isPrimary) {
      device.on("tokenWillExpire", () => {
        console.log("Twilio token will expire soon");
        this.callbacks.onTokenExpiring?.();
        this.refreshToken();
      });

      device.on("unregistered", () => {
        console.log("Twilio device unregistered");
        this.notifyStateChange("offline");
      });
    }
  }

  private handleIncomingInvite(twilioCall: TwilioCall): void {
      console.log("Incoming call:", twilioCall.parameters);

      const info: IncomingCallInfo = {
        callSid: twilioCall.parameters.CallSid || "",
        parentCallSid: twilioCall.parameters.ParentCallSid || undefined,
        from: twilioCall.parameters.From || "Unknown",
        leadId: twilioCall.customParameters.get("lead_id"),
        leadName: twilioCall.customParameters.get("lead_name"),
      };

      const currentStatus = this.currentCall?.status();
      const currentSid = this.currentCall?.parameters?.CallSid;
      const incomingSid = twilioCall.parameters.CallSid;

      // Duplicate invite for the same Twilio call — ignore
      if (this.currentCall && currentSid && incomingSid && currentSid === incomingSid) {
        console.log("Ignoring duplicate incoming invite", incomingSid);
        return;
      }

      // Already talking — keep active call; queue this as call-waiting
      if (this.currentCall && currentStatus === "open") {
        this.pendingIncomingCall = twilioCall;
        this.setupCallListeners(twilioCall);
        this.callbacks.onIncomingCall?.(twilioCall, info);
        return;
      }

      // Already ringing another call — do not replace (that dropped the first invite)
      if (this.currentCall && currentStatus && ["connecting", "ringing", "pending"].includes(currentStatus)) {
        this.pendingIncomingCall = twilioCall;
        this.setupCallListeners(twilioCall);
        this.callbacks.onIncomingCall?.(twilioCall, info);
        return;
      }

      this.currentCall = twilioCall;
      this.setupCallListeners(twilioCall);
      this.notifyStateChange("busy");
      this.callbacks.onIncomingCall?.(twilioCall, info);
  }

  /**
   * Set up event listeners on a call
   */
  private setupCallListeners(call: TwilioCall): void {
    call.on("accept", () => {
      console.log("Call accepted");
      this.callbacks.onCallConnected?.(call);
    });

    call.on("disconnect", () => {
      console.log("Call disconnected");
      if (this.pendingIncomingCall === call) {
        this.pendingIncomingCall = null;
        this.callbacks.onCallDisconnected?.(call);
        return;
      }
      if (this.currentCall === call) {
        this.currentCall = null;
        this.notifyStateChange(this.pendingIncomingCall ? "busy" : "ready");
        this.callbacks.onCallDisconnected?.(call);
      }
    });

    call.on("cancel", () => {
      console.log("Call cancelled");
      if (this.pendingIncomingCall === call) {
        this.pendingIncomingCall = null;
        this.callbacks.onCallDisconnected?.(call);
        return;
      }
      if (this.currentCall === call) {
        this.currentCall = null;
        this.notifyStateChange(this.pendingIncomingCall ? "busy" : "ready");
        this.callbacks.onCallDisconnected?.(call);
      }
    });

    call.on("reject", () => {
      console.log("Call rejected");
      if (this.pendingIncomingCall === call) {
        this.pendingIncomingCall = null;
        this.callbacks.onCallDisconnected?.(call);
        return;
      }
      if (this.currentCall === call) {
        this.currentCall = null;
        this.notifyStateChange(this.pendingIncomingCall ? "busy" : "ready");
        this.callbacks.onCallDisconnected?.(call);
      }
    });

    call.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Call error:", error);
      this.callbacks.onCallError?.(error);
    });
  }

  /**
   * Make an outbound call
   */
  async call(toNumber: string, leadId?: string): Promise<TwilioCall> {
    if (!this.device) {
      throw new Error("Twilio device not initialized");
    }

    if (this.currentCall) {
      throw new Error("Already on a call");
    }

    this.notifyStateChange("busy");

    try {
      const params: Record<string, string> = {
        To: toNumber,
      };
      if (leadId) {
        params.lead_id = leadId;
      }

      const call = await this.device.connect({ params });
      this.currentCall = call;
      this.setupCallListeners(call);

      return call;
    } catch (error) {
      this.notifyStateChange("ready");
      throw error;
    }
  }

  /**
   * Accept an incoming call.
   * If already on an active call, puts the first on mute/hold and accepts the waiting leg.
   */
  acceptCall(): void {
    if (this.pendingIncomingCall) {
      const waiting = this.pendingIncomingCall;
      this.pendingIncomingCall = null;
      // Hold current conversation so the waiting call can be answered
      if (this.currentCall && this.currentCall.status() === "open") {
        try {
          this.currentCall.mute(true);
          this.currentCall.disconnect();
        } catch (e) {
          console.warn("Failed to end previous call before accepting waiting:", e);
        }
      }
      this.currentCall = waiting;
      waiting.accept();
      this.notifyStateChange("busy");
      return;
    }
    if (this.currentCall) {
      this.currentCall.accept();
    }
  }

  /**
   * Ignore an incoming call on this device only.
   * Does not hang up for the caller or other ring-group agents.
   * Prefer pending (call-waiting) over the active connected call.
   */
  ignoreCall(): void {
    if (this.pendingIncomingCall) {
      try {
        this.pendingIncomingCall.ignore();
      } catch (e) {
        console.warn("Failed to ignore waiting call:", e);
      }
      this.pendingIncomingCall = null;
      return;
    }
    if (this.currentCall && this.currentCall.status() !== "open") {
      try {
        this.currentCall.ignore();
      } catch (e) {
        console.warn("Failed to ignore call:", e);
      }
      this.currentCall = null;
      this.notifyStateChange("ready");
    }
  }

  /**
   * Reject an incoming call (sends busy/hangup toward the dial leg).
   * Prefer ignoreCall() for ring groups so other agents can still answer.
   */
  rejectCall(): void {
    if (this.pendingIncomingCall) {
      this.pendingIncomingCall.reject();
      this.pendingIncomingCall = null;
      return;
    }
    if (this.currentCall) {
      this.currentCall.reject();
      this.currentCall = null;
      this.notifyStateChange("ready");
    }
  }

  /**
   * Hang up the current call
   */
  hangup(): void {
    if (this.currentCall) {
      this.currentCall.disconnect();
      this.currentCall = null;
      this.notifyStateChange(this.pendingIncomingCall ? "busy" : "ready");
    }
  }

  /**
   * Whether a second inbound is waiting while on an active call
   */
  hasPendingIncoming(): boolean {
    return this.pendingIncomingCall !== null;
  }

  /**
   * True if any call is active or ringing on this device
   */
  isOnAnyCall(): boolean {
    return this.currentCall !== null || this.pendingIncomingCall !== null;
  }

  /**
   * Toggle mute on the current call
   */
  toggleMute(): boolean {
    if (this.currentCall) {
      const isMuted = this.currentCall.isMuted();
      this.currentCall.mute(!isMuted);
      return !isMuted;
    }
    return false;
  }

  /**
   * Send DTMF digits
   */
  sendDigits(digits: string): void {
    if (this.currentCall) {
      this.currentCall.sendDigits(digits);
    }
  }

  /**
   * Get current call status
   */
  getCallStatus(): string | null {
    return this.currentCall?.status() || null;
  }

  /**
   * Check if currently on a call
   */
  isOnCall(): boolean {
    return this.currentCall !== null || this.pendingIncomingCall !== null;
  }

  /**
   * Get current call
   */
  getCurrentCall(): TwilioCall | null {
    return this.currentCall;
  }

  /**
   * Mark device destroyed so the React hook can full re-initialize.
   */
  private markNeedsReinit(reason: string): void {
    console.warn(`Twilio needs full re-init: ${reason}`);
    this.stopKeepAlive();
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    this.device = null;
    this.isInitialized = false;
    this.notifyStateChange("offline");
  }

  /**
   * Re-register if the browser suspended Twilio while the tab was backgrounded.
   *
   * @param force When true, unregister+register even if state is "registered".
   *   Browsers can kill the Twilio signaling socket without flipping Device state,
   *   so wake/visibility handlers must force a real reconnect.
   */
  async ensureRegistered(force = false): Promise<void> {
    if (!this.isInitialized && !this.device) return;
    if (this.reconnectInFlight) {
      await this.reconnectInFlight;
      return;
    }

    this.reconnectInFlight = this.doEnsureRegistered(force);
    try {
      await this.reconnectInFlight;
    } finally {
      this.reconnectInFlight = null;
    }
  }

  private async doEnsureRegistered(force: boolean): Promise<void> {
    if (!this.device || !this.isInitialized) return;

    // Never tear down signaling mid-call / mid-ring
    if (this.currentCall || this.pendingIncomingCall) {
      console.log("Twilio ensureRegistered skipped — call in progress");
      return;
    }

    try {
      const state = this.device.state;
      if (state === "destroyed" || state === "destroying") {
        this.markNeedsReinit(`state=${state}`);
        return;
      }

      if (state === "registered" && !force) {
        return;
      }

      console.log(
        `Twilio device state="${state}" — ${force ? "forcing signaling reconnect" : "re-registering"}`
      );

      if (force && state === "registered") {
        try {
          await this.device.unregister();
        } catch (e) {
          console.warn("Twilio unregister during force reconnect failed:", e);
        }
      }

      if (this.device.state === "destroyed") {
        this.markNeedsReinit("destroyed after unregister");
        return;
      }

      await this.device.register();
      this.keepAliveTicks = 0;
      console.log("Twilio device re-registered successfully");
    } catch (e) {
      console.warn("Twilio ensureRegistered failed:", e);
      // If register keeps failing, request a full re-init from the hook
      const state = this.device?.state;
      if (state === "destroyed" || state === "unregistered") {
        this.markNeedsReinit(`register failed (state=${state})`);
      }
    }
  }

  /**
   * Periodic keep-alive using a Web Worker so it runs even when the browser
   * throttles background tabs. Falls back to setInterval if Workers unavailable.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTicks = 0;

    const doKeepAlive = () => {
      if (!this.device || !this.isInitialized) return;
      if (this.currentCall || this.pendingIncomingCall) return;

      const state = this.device.state;
      if (state === "destroyed" || state === "destroying") {
        this.markNeedsReinit(`keep-alive saw state=${state}`);
        return;
      }

      this.keepAliveTicks += 1;
      const tabHidden =
        typeof document !== "undefined" && document.visibilityState === "hidden";

      // While backgrounded, force a real reconnect every ~60s (5 × 12s ticks).
      // Device often still reports "registered" after the signaling WS dies.
      const shouldForce = tabHidden && this.keepAliveTicks % 5 === 0;

      if (state === "unregistered" || state === "registering" || shouldForce) {
        console.log(
          `Twilio keep-alive: state=${state} hidden=${tabHidden} force=${shouldForce}`
        );
        void this.ensureRegistered(shouldForce || state !== "registered");
      }
    };

    if (typeof Worker !== "undefined") {
      try {
        this.keepAliveWorker = new Worker("/twilio-keepalive-worker.js");
        this.keepAliveWorker.addEventListener("message", (e) => {
          if (e.data?.type === "keepalive") doKeepAlive();
        });
        this.keepAliveWorker.postMessage({ type: "start" });
        return;
      } catch (e) {
        console.warn("Twilio keep-alive Worker failed, falling back to setInterval:", e);
      }
    }

    // Fallback for environments without Worker support
    this.keepAliveTimer = setInterval(doKeepAlive, 15_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveWorker) {
      this.keepAliveWorker.postMessage({ type: "stop" });
      this.keepAliveWorker.terminate();
      this.keepAliveWorker = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Refresh the access token
   */
  private async refreshToken(): Promise<void> {
    try {
      const tokenData = await voiceService.getToken(this.dealershipId);
      
      if (this.device) {
        // Update token on existing device
        const { Device } = await import("@twilio/voice-sdk");
        (this.device as unknown as { updateToken: (token: string) => void }).updateToken(tokenData.token);
        console.log("Twilio token refreshed");
        
        // Schedule next refresh
        this.scheduleTokenRefresh(tokenData.expires_in);
      }
    } catch (error) {
      console.error("Failed to refresh Twilio token:", error);
    }
  }

  /**
   * Schedule token refresh before expiry
   */
  private scheduleTokenRefresh(expiresIn: number): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    // Refresh 5 minutes before expiry
    const refreshIn = Math.max((expiresIn - 300) * 1000, 60000);
    this.tokenRefreshTimer = setTimeout(() => {
      this.refreshToken();
    }, refreshIn);
  }

  /**
   * Notify state change
   */
  private notifyStateChange(state: DeviceState): void {
    this.callbacks.onStateChange?.(state);
  }

  /**
   * Destroy the device and clean up
   */
  destroy(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    this.stopKeepAlive();

    if (this.pendingIncomingCall) {
      try {
        this.pendingIncomingCall.ignore();
      } catch {
        /* noop */
      }
      this.pendingIncomingCall = null;
    }

    if (this.currentCall) {
      this.currentCall.disconnect();
      this.currentCall = null;
    }

    for (const [, extra] of this.extraDevices) {
      try {
        extra.destroy();
      } catch {
        /* noop */
      }
    }
    this.extraDevices.clear();

    if (this.device) {
      this.device.destroy();
      this.device = null;
    }

    this.isInitialized = false;
    this.registeredDealershipKey = "";
    this.dealershipId = null;
    this.callbacks = {};
  }

  /**
   * Check if initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
export const twilioVoiceManager = new TwilioVoiceManager();
export default twilioVoiceManager;
