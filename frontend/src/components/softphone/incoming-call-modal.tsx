"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, User, X } from "lucide-react";
import { IncomingCallInfo } from "@/lib/twilio-voice";

interface IncomingCallModalProps {
  call: IncomingCallInfo | null;
  onAccept: () => void;
  /** Stop ringing on this device only — does not hang up for other agents. */
  onIgnore: () => void;
}

export function IncomingCallModal({ call, onAccept, onIgnore }: IncomingCallModalProps) {
  const open = !!call;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // X / Esc / overlay dismiss = ignore locally, keep call ringing for others
        if (!next) onIgnore();
      }}
    >
      <DialogContent
        className="sm:max-w-md z-[100]"
        hideCloseButton
        // Keep close reliable even if another dialog was open underneath
        onPointerDownOutside={(e) => {
          e.preventDefault();
          onIgnore();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onIgnore();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          onIgnore();
        }}
      >
        <DialogTitle className="sr-only">Incoming Call</DialogTitle>

        {/* Explicit close — more reliable than relying only on the default Dialog X */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4 h-8 w-8 rounded-sm opacity-70 hover:opacity-100 z-10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onIgnore();
          }}
          aria-label="Ignore call"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="flex flex-col items-center py-6">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 animate-pulse">
            <User className="h-10 w-10 text-primary" />
          </div>

          <h2 className="text-xl font-semibold mb-1">
            {call?.leadName || "Unknown Caller"}
          </h2>
          <p className="text-muted-foreground mb-6">{call?.from}</p>

          <p className="text-sm text-muted-foreground mb-2 animate-pulse">
            Incoming call...
          </p>
          <p className="text-xs text-muted-foreground mb-8 text-center max-w-xs">
            Ignore or X only stops ringing for you. Others keep ringing until someone answers.
          </p>

          <div className="flex gap-8">
            <div className="flex flex-col items-center">
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="h-16 w-16 rounded-full"
                onClick={onIgnore}
              >
                <PhoneOff className="h-7 w-7" />
              </Button>
              <span className="mt-2 text-sm text-muted-foreground">Ignore</span>
            </div>

            <div className="flex flex-col items-center">
              <Button
                type="button"
                size="icon"
                className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600"
                onClick={onAccept}
              >
                <Phone className="h-7 w-7" />
              </Button>
              <span className="mt-2 text-sm text-muted-foreground">Accept</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
