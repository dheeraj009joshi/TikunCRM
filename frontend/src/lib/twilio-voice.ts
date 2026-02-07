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
  disconnect(): void;
  mute(shouldMute?: boolean): void;
  isMuted(): boolean;
  sendDigits(digits: string): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
  status(): string;
  parameters: {
    CallSid?: string;
    From?: string;
    To?: string;
  };
  customParameters: Map<string, string>;
}

export type DeviceState = "offline" | "connecting" | "ready" | "busy" | "error";

export interface IncomingCallInfo {
  callSid: string;
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
  private currentCall: TwilioCall | null = null;
  private callbacks: TwilioEventCallback = {};
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  /**
   * Initialize the Twilio Device with an access token
   */
  async initialize(callbacks: TwilioEventCallback = {}): Promise<void> {
    if (this.isInitialized) {
      console.log("Twilio already initialized");
      return;
    }

    this.callbacks = callbacks;
    this.notifyStateChange("connecting");

    try {
      // Dynamically load Twilio SDK
      const { Device } = await import("@twilio/voice-sdk");

      // Get access token from backend
      const tokenData = await voiceService.getToken();

      // Create device
      const options = {
        logLevel: 1 as const,
        codecPreferences: ["opus", "pcmu"],
        allowIncomingWhileBusy: false,
        closeProtection: true,
      };
      this.device = new Device(tokenData.token, options as ConstructorParameters<typeof Device>[1]) as unknown as TwilioDevice;

      // Set up event listeners
      this.setupDeviceListeners();

      // Register the device
      await this.device.register();

      this.isInitialized = true;
      this.notifyStateChange("ready");

      // Set up token refresh before expiry
      this.scheduleTokenRefresh(tokenData.expires_in);

      console.log("Twilio Voice initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Twilio Voice:", error);
      this.notifyStateChange("error");
      throw error;
    }
  }

  /**
   * Set up event listeners on the Twilio Device
   */
  private setupDeviceListeners(): void {
    if (!this.device) return;

    // Device ready
    this.device.on("registered", () => {
      console.log("Twilio device registered");
      this.notifyStateChange("ready");
    });

    // Device error
    this.device.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("Twilio device error:", error);
      this.callbacks.onCallError?.(error);
      this.notifyStateChange("error");
    });

    // Incoming call
    this.device.on("incoming", (call: unknown) => {
      const twilioCall = call as TwilioCall;
      console.log("Incoming call:", twilioCall.parameters);
      
      const info: IncomingCallInfo = {
        callSid: twilioCall.parameters.CallSid || "",
        from: twilioCall.parameters.From || "Unknown",
        leadId: twilioCall.customParameters.get("lead_id"),
        leadName: twilioCall.customParameters.get("lead_name"),
      };

      this.currentCall = twilioCall;
      this.setupCallListeners(twilioCall);
      this.notifyStateChange("busy");
      this.callbacks.onIncomingCall?.(twilioCall, info);
    });

    // Token about to expire
    this.device.on("tokenWillExpire", () => {
      console.log("Twilio token will expire soon");
      this.callbacks.onTokenExpiring?.();
      this.refreshToken();
    });

    // Device unregistered
    this.device.on("unregistered", () => {
      console.log("Twilio device unregistered");
      this.notifyStateChange("offline");
    });
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
      this.currentCall = null;
      this.notifyStateChange("ready");
      this.callbacks.onCallDisconnected?.(call);
    });

    call.on("cancel", () => {
      console.log("Call cancelled");
      this.currentCall = null;
      this.notifyStateChange("ready");
      this.callbacks.onCallDisconnected?.(call);
    });

    call.on("reject", () => {
      console.log("Call rejected");
      this.currentCall = null;
      this.notifyStateChange("ready");
      this.callbacks.onCallDisconnected?.(call);
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
   * Accept an incoming call
   */
  acceptCall(): void {
    if (this.currentCall) {
      this.currentCall.accept();
    }
  }

  /**
   * Reject an incoming call
   */
  rejectCall(): void {
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
      this.notifyStateChange("ready");
    }
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
    return this.currentCall !== null;
  }

  /**
   * Get current call
   */
  getCurrentCall(): TwilioCall | null {
    return this.currentCall;
  }

  /**
   * Refresh the access token
   */
  private async refreshToken(): Promise<void> {
    try {
      const tokenData = await voiceService.getToken();
      
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

    if (this.currentCall) {
      this.currentCall.disconnect();
      this.currentCall = null;
    }

    if (this.device) {
      this.device.destroy();
      this.device = null;
    }

    this.isInitialized = false;
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
