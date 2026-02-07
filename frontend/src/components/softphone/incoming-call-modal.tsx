"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, User } from "lucide-react";
import { IncomingCallInfo } from "@/lib/twilio-voice";

interface IncomingCallModalProps {
  call: IncomingCallInfo | null;
  onAccept: () => void;
  onReject: () => void;
}

export function IncomingCallModal({ call, onAccept, onReject }: IncomingCallModalProps) {
  if (!call) return null;

  return (
    <Dialog open={!!call} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">Incoming Call</DialogTitle>
        <div className="flex flex-col items-center py-6">
          {/* Avatar/Icon */}
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 animate-pulse">
            <User className="h-10 w-10 text-primary" />
          </div>

          {/* Caller Info */}
          <h2 className="text-xl font-semibold mb-1">
            {call.leadName || "Unknown Caller"}
          </h2>
          <p className="text-muted-foreground mb-6">{call.from}</p>

          {/* Incoming indicator */}
          <p className="text-sm text-muted-foreground mb-8 animate-pulse">
            Incoming call...
          </p>

          {/* Action Buttons */}
          <div className="flex gap-8">
            {/* Reject */}
            <div className="flex flex-col items-center">
              <Button
                variant="destructive"
                size="icon"
                className="h-16 w-16 rounded-full"
                onClick={onReject}
              >
                <PhoneOff className="h-7 w-7" />
              </Button>
              <span className="mt-2 text-sm text-muted-foreground">Decline</span>
            </div>

            {/* Accept */}
            <div className="flex flex-col items-center">
              <Button
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
