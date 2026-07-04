"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bookmark, BookmarkPlus, Loader2, Star, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { SavedViewService, type SavedView } from "@/services/saved-view-service"
import { cn } from "@/lib/utils"

const savedViewKeys = {
    list: (entityType: string) => ["saved-views", entityType] as const,
}

interface SavedViewsBarProps {
    entityType: string
    /** Current filters to capture when saving a view */
    getCurrentFilters: () => Record<string, string>
    /** Current visible column keys (optional) */
    getCurrentColumns?: () => string[]
    /** Apply a saved view */
    onApply: (view: SavedView) => void
    /** Id of the currently active view, if any */
    activeViewId?: string | null
    className?: string
}

/**
 * Horizontal strip of the user's saved views with save/delete/default controls.
 */
export function SavedViewsBar({
    entityType,
    getCurrentFilters,
    getCurrentColumns,
    onApply,
    activeViewId,
    className,
}: SavedViewsBarProps) {
    const queryClient = useQueryClient()
    const [saveOpen, setSaveOpen] = React.useState(false)
    const [name, setName] = React.useState("")

    const { data: views = [] } = useQuery({
        queryKey: savedViewKeys.list(entityType),
        queryFn: () => SavedViewService.list(entityType),
    })

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: savedViewKeys.list(entityType) })

    const createMutation = useMutation({
        mutationFn: () =>
            SavedViewService.create({
                name: name.trim(),
                entity_type: entityType,
                filters: getCurrentFilters(),
                columns: getCurrentColumns?.() ?? null,
            }),
        onSuccess: () => {
            invalidate()
            setSaveOpen(false)
            setName("")
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => SavedViewService.delete(id),
        onSuccess: invalidate,
    })

    const defaultMutation = useMutation({
        mutationFn: (id: string) => SavedViewService.update(id, { is_default: true }),
        onSuccess: invalidate,
    })

    if (views.length === 0) {
        return (
            <div className={cn("flex items-center", className)}>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSaveOpen(true)}>
                    <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                    Save current view
                </Button>
                <SaveViewDialog
                    open={saveOpen}
                    onOpenChange={setSaveOpen}
                    name={name}
                    setName={setName}
                    onSave={() => createMutation.mutate()}
                    isSaving={createMutation.isPending}
                />
            </div>
        )
    }

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
            <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
            {views.map((view) => (
                <span
                    key={view.id}
                    className={cn(
                        "group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        activeViewId === view.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                >
                    <button type="button" onClick={() => onApply(view)} className="focus:outline-none">
                        {view.name}
                    </button>
                    <button
                        type="button"
                        title={view.is_default ? "Default view" : "Make default"}
                        onClick={() => !view.is_default && defaultMutation.mutate(view.id)}
                        className="focus:outline-none"
                    >
                        <Star
                            className={cn(
                                "h-3 w-3",
                                view.is_default
                                    ? "fill-amber-400 text-amber-400"
                                    : "opacity-0 transition-opacity group-hover:opacity-60"
                            )}
                        />
                    </button>
                    <button
                        type="button"
                        title="Delete view"
                        onClick={() => deleteMutation.mutate(view.id)}
                        className="opacity-0 transition-opacity focus:outline-none group-hover:opacity-60 hover:!opacity-100"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSaveOpen(true)}>
                <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
                Save view
            </Button>
            <SaveViewDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                name={name}
                setName={setName}
                onSave={() => createMutation.mutate()}
                isSaving={createMutation.isPending}
            />
        </div>
    )
}

function SaveViewDialog({
    open,
    onOpenChange,
    name,
    setName,
    onSave,
    isSaving,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    name: string
    setName: (v: string) => void
    onSave: () => void
    isSaving: boolean
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Save current view</DialogTitle>
                    <DialogDescription>
                        Saves your current filters and visible columns as a reusable view.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <Label htmlFor="saved-view-name">View name</Label>
                    <Input
                        id="saved-view-name"
                        placeholder="e.g. Hot unassigned this week"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && name.trim()) onSave()
                        }}
                        autoFocus
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={onSave} disabled={!name.trim() || isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save view
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
