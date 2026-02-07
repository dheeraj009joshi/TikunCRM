"use client";

import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff, Pause, Play, Grid3X3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CallControlsProps {
  isOnCall: boolean;
  isMuted: boolean;
  isHeld?: boolean;
  showDialPad?: boolean;
  onMuteToggle: () => void;
  onHangup: () => void;
  onHoldToggle?: () => void;
  onDialPadToggle?: () => void;
}

export function CallControls({
  isOnCall,
  isMuted,
  isHeld,
  showDialPad,
  onMuteToggle,
  onHangup,
  onHoldToggle,
  onDialPadToggle,
}: CallControlsProps) {
  if (!isOnCall) return null;

  return (
    <div className="flex items-center justify-center gap-3">
      {/* Mute */}
      <Button
        variant={isMuted ? "default" : "outline"}
        size="icon"
        className={cn("h-12 w-12 rounded-full", isMuted && "bg-red-500 hover:bg-red-600")}
        onClick={onMuteToggle}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </Button>

      {/* Hold (optional) */}
      {onHoldToggle && (
        <Button
          variant={isHeld ? "default" : "outline"}
          size="icon"
          className={cn("h-12 w-12 rounded-full", isHeld && "bg-yellow-500 hover:bg-yellow-600")}
          onClick={onHoldToggle}
          title={isHeld ? "Resume" : "Hold"}
        >
          {isHeld ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </Button>
      )}

      {/* Dial Pad Toggle (optional) */}
      {onDialPadToggle && (
        <Button
          variant={showDialPad ? "default" : "outline"}
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={onDialPadToggle}
          title="Dial Pad"
        >
          <Grid3X3 className="h-5 w-5" />
        </Button>
      )}

      {/* Hang Up */}
      <Button
        variant="destructive"
        size="icon"
        className="h-14 w-14 rounded-full"
        onClick={onHangup}
        title="Hang Up"
      >
        <PhoneOff className="h-6 w-6" />
      </Button>
    </div>
  );
}
