"use client";

import * as React from "react";
import { AlertTriangle, AtSign } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSkateConfirmStore } from "@/stores/skate-confirm-store";

export function SkateConfirmDialog() {
    const { open, warningInfo, confirm, cancel } = useSkateConfirmStore();

    if (!warningInfo) {
        return null;
    }

    // Check if this is a note action (has mention_hint)
    const isNoteAction = warningInfo.action_type === "add note" && warningInfo.mention_hint;

    return (
        <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && cancel()}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-5 w-5" />
                        Potential SKATE Alert
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-3">
                            <p className="text-foreground">
                                This lead is assigned to{" "}
                                <strong className="text-primary">{warningInfo.assigned_to_name}</strong>.
                            </p>
                            
                            {isNoteAction ? (
                                <>
                                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-md space-y-2">
                                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1">
                                            <AtSign className="h-4 w-4" />
                                            Want to avoid a SKATE?
                                        </p>
                                        <p className="text-sm text-blue-600 dark:text-blue-400">
                                            Mention <strong>@{warningInfo.assigned_to_name}</strong> in your note. 
                                            This notifies them and is not considered skating.
                                        </p>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        If you continue without mentioning, this will be logged as a 
                                        SKATE and the entire team will be notified.
                                    </p>
                                </>
                            ) : (
                                <p className="text-muted-foreground">
                                    If you continue, this action will be logged as a SKATE and
                                    the team will be notified.
                                </p>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className={isNoteAction ? "flex-col sm:flex-row gap-2" : ""}>
                    {isNoteAction ? (
                        <>
                            <Button
                                variant="outline"
                                onClick={cancel}
                                className="flex items-center gap-1"
                            >
                                <AtSign className="h-4 w-4" />
                                Go Back & Mention
                            </Button>
                            <AlertDialogAction
                                onClick={confirm}
                                className="bg-amber-600 hover:bg-amber-700"
                            >
                                Continue as SKATE
                            </AlertDialogAction>
                        </>
                    ) : (
                        <>
                            <AlertDialogCancel onClick={cancel}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={confirm}
                                className="bg-amber-600 hover:bg-amber-700"
                            >
                                Continue Anyway
                            </AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
