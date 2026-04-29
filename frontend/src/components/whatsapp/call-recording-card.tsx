"use client";

import { useState, useRef } from "react";
import { format } from "date-fns";
import { 
  Phone, 
  PhoneIncoming, 
  PhoneOutgoing, 
  PhoneMissed, 
  Play, 
  Pause,
  Download,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CallLogItem } from "@/services/whatsapp-service";

interface CallRecordingCardProps {
  call: CallLogItem;
}

export function CallRecordingCard({ call }: CallRecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getCallIcon = () => {
    if (call.status === "no-answer" || call.status === "failed" || call.status === "canceled") {
      return <PhoneMissed className="h-5 w-5 text-red-400" />;
    }
    if (call.direction === "inbound") {
      return <PhoneIncoming className="h-5 w-5 text-[#00a884]" />;
    }
    return <PhoneOutgoing className="h-5 w-5 text-[#00a884]" />;
  };

  const getCallTitle = () => {
    if (call.status === "no-answer") return "Missed call";
    if (call.status === "failed") return "Failed call";
    if (call.status === "canceled") return "Canceled call";
    if (call.status === "busy") return "Busy";
    if (call.direction === "inbound") return "Incoming call";
    return "Outgoing call";
  };

  const getStatusColor = () => {
    if (["no-answer", "failed", "canceled"].includes(call.status)) {
      return "text-red-400";
    }
    if (call.status === "completed") {
      return "text-[#00a884]";
    }
    return "text-[#8696a0]";
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleDownload = async () => {
    if (!call.recording_url) return;
    
    try {
      const response = await fetch(call.recording_url, { credentials: "include" });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `call-recording-${call.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  return (
    <div className="flex justify-center py-2">
      <div className="bg-[#182229] border border-[#2a3942] rounded-lg px-4 py-3 max-w-[85%] min-w-[240px]">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-[#2a3942]">
            {getCallIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn("text-sm font-medium", getStatusColor())}>
              {getCallTitle()}
            </p>
            <div className="flex items-center gap-2 text-xs text-[#8696a0]">
              <Clock className="h-3 w-3" />
              <span>{format(new Date(call.started_at), "h:mm a")}</span>
              {call.duration_seconds > 0 && (
                <>
                  <span className="text-[#3b4a54]">|</span>
                  <span>{formatDuration(call.duration_seconds)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Recording player */}
        {call.recording_url && (
          <div className="mt-3 flex items-center gap-2 bg-[#2a3942] rounded-lg p-2">
            {call.recording_url && (
              <audio
                ref={audioRef}
                src={call.recording_url}
                onEnded={() => setIsPlaying(false)}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlayback}
              className="h-8 w-8 rounded-full bg-[#00a884] hover:bg-[#00a884]/90 text-white"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <div className="flex-1 h-1 bg-[#3b4a54] rounded">
              <div className="h-full bg-[#00a884] rounded" style={{ width: "0%" }} />
            </div>
            {call.recording_duration_seconds && (
              <span className="text-xs text-[#8696a0] min-w-[40px] text-right">
                {formatDuration(call.recording_duration_seconds)}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDownload}
              className="h-8 w-8 text-[#8696a0] hover:text-white hover:bg-[#3b4a54]"
              title="Download recording"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Notes */}
        {call.notes && (
          <p className="mt-2 text-xs text-[#8696a0] italic">
            Note: {call.notes}
          </p>
        )}

        {/* Outcome badge */}
        {call.outcome && (
          <div className="mt-2">
            <span className={cn(
              "inline-block text-xs px-2 py-0.5 rounded-full",
              call.outcome === "interested" && "bg-green-900/50 text-green-300",
              call.outcome === "callback" && "bg-yellow-900/50 text-yellow-300",
              call.outcome === "not_interested" && "bg-red-900/50 text-red-300",
              call.outcome === "voicemail" && "bg-blue-900/50 text-blue-300",
              !["interested", "callback", "not_interested", "voicemail"].includes(call.outcome) && "bg-[#2a3942] text-[#8696a0]"
            )}>
              {call.outcome.replace("_", " ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
