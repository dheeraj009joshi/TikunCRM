"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Volume2, VolumeX, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  title?: string;
  className?: string;
  showDownload?: boolean;
  onError?: (error: Error) => void;
}

export function AudioPlayer({
  src,
  title,
  className,
  showDownload = true,
  onError,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle play/pause
  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((e) => {
        setError("Failed to play audio");
        onError?.(e);
      });
    }
    setIsPlaying(!isPlaying);
  };

  // Handle mute toggle
  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Handle seek
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  // Handle volume change
  const handleVolumeChange = (value: number[]) => {
    if (!audioRef.current) return;
    audioRef.current.volume = value[0];
    setVolume(value[0]);
    setIsMuted(value[0] === 0);
  };

  // Handle download
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = src;
    link.download = title || "recording.wav";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Set up audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setError("Failed to load audio");
      setIsLoading(false);
      onError?.(new Error("Failed to load audio"));
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("canplay", handleCanPlay);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [onError]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  if (error) {
    return (
      <div className={cn("p-4 text-center text-sm text-muted-foreground", className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 p-3 bg-muted/50 rounded-lg", className)}>
      {/* Hidden audio element */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 rounded-full shrink-0"
        onClick={togglePlay}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </Button>

      {/* Progress section */}
      <div className="flex-1 space-y-1">
        {/* Title */}
        {title && (
          <p className="text-sm font-medium truncate">{title}</p>
        )}

        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-10">
            {formatTime(currentTime)}
          </span>
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="flex-1"
            disabled={isLoading || !duration}
          />
          <span className="text-xs text-muted-foreground w-10">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume control */}
      <div className="hidden sm:flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleMute}
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
        <Slider
          value={[isMuted ? 0 : volume]}
          max={1}
          step={0.1}
          onValueChange={handleVolumeChange}
          className="w-20"
        />
      </div>

      {/* Download button */}
      {showDownload && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleDownload}
          title="Download recording"
        >
          <Download className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
