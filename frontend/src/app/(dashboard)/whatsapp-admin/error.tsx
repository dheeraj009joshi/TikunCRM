"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function WhatsAppAdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("WhatsApp Admin Error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-[calc(100vh-200px)]">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Something went wrong
          </CardTitle>
          <CardDescription>
            An error occurred while loading the WhatsApp Admin page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
            <p className="font-medium mb-1">Error details:</p>
            <p className="font-mono text-xs break-all">
              {error.message || "Unknown error"}
            </p>
            {error.digest && (
              <p className="font-mono text-xs mt-1">Digest: {error.digest}</p>
            )}
          </div>
          
          <div className="text-sm text-muted-foreground">
            <p>This could be due to:</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>WhatsApp service not running</li>
              <li>Network connectivity issues</li>
              <li>Session expired - try logging in again</li>
            </ul>
          </div>

          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="flex-1"
            >
              Reload Page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
