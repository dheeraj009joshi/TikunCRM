"use client"

import * as React from "react"
import { AlertTriangle } from "lucide-react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useSkateAlertStore } from "@/stores/skate-alert-store"

export function SkateAlertDialog() {
    const { open, message, assignedToName, close } = useSkateAlertStore()

    return (
        <AlertDialog open={open} onOpenChange={(open) => !open && close()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-5 w-5" />
                        Don't SKATE the lead
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-1">
                            <p>{message}</p>
                            {assignedToName && (
                                <p className="text-muted-foreground text-sm">
                                    This lead is assigned to <strong>{assignedToName}</strong>.
                                </p>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={close}>OK</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
