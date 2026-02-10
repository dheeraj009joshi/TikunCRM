"use client";

import { MessageSquare } from "lucide-react";

export default function SMSInboxPage() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] text-center px-4">
      <div className="bg-primary/10 rounded-full p-6 mb-6">
        <MessageSquare className="h-16 w-16 text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-3">Text (SMS) Coming Soon!</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        In-app SMS messaging is being configured and will be available soon.
      </p>
      <div className="bg-muted/50 rounded-lg p-6 max-w-md">
        <h3 className="font-semibold mb-2">In the meantime:</h3>
        <p className="text-sm text-muted-foreground">
          You can still text leads manually using your phone.
          Click on a lead&apos;s phone number to copy it, or use WhatsApp in Conversations to message them.
        </p>
      </div>
    </div>
  );
}
