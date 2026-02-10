"use client"

import * as React from "react"
import {
    GripVertical,
    Plus,
    Pencil,
    Trash2,
    Loader2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { StipsService, StipsCategory } from "@/services/stips-service"
import { useRole } from "@/hooks/use-role"

export default function StipsCategoriesSettingsPage() {
    const [categories, setCategories] = React.useState<StipsCategory[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [editCategory, setEditCategory] = React.useState<StipsCategory | null>(null)
    const [showCreate, setShowCreate] = React.useState(false)
    const [formName, setFormName] = React.useState("")
    const [formScope, setFormScope] = React.useState<"customer" | "lead">("lead")
    const [formOrder, setFormOrder] = React.useState(0)
    const [isSaving, setIsSaving] = React.useState(false)
    const [deleteError, setDeleteError] = React.useState<string | null>(null)
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner } = useRole()
    const canManage = isSuperAdmin || isDealershipAdmin || isDealershipOwner

    const loadCategories = React.useCallback(async () => {
        try {
            const data = await StipsService.listCategories()
            setCategories(data)
        } catch (error) {
            console.error("Failed to load Stips categories:", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    React.useEffect(() => {
        loadCategories()
    }, [loadCategories])

    const handleSave = async () => {
        if (!formName.trim()) return
        setIsSaving(true)
        setDeleteError(null)
        try {
            if (editCategory) {
                await StipsService.updateCategory(editCategory.id, {
                    name: formName.trim(),
                    display_order: formOrder,
                    scope: formScope,
                })
            } else {
                await StipsService.createCategory({
                    name: formName.trim(),
                    display_order: formOrder,
                    scope: formScope,
                })
            }
            setEditCategory(null)
            setShowCreate(false)
            setFormName("")
            setFormOrder(categories.length)
            setFormScope("lead")
            await loadCategories()
        } catch (error) {
            console.error("Failed to save category:", error)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (category: StipsCategory) => {
        if (!confirm(`Delete "${category.name}"? This is only allowed when no documents are in this category.`)) return
        setDeleteError(null)
        try {
            await StipsService.deleteCategory(category.id)
            await loadCategories()
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
                : "Failed to delete category."
            setDeleteError(typeof message === "string" ? message : "Category has documents or could not be deleted.")
        }
    }

    const openEdit = (category: StipsCategory) => {
        setEditCategory(category)
        setFormName(category.name)
        setFormOrder(category.display_order)
        setFormScope(category.scope as "customer" | "lead")
        setShowCreate(true)
    }

    const openCreate = () => {
        setEditCategory(null)
        setFormName("")
        setFormOrder(categories.length)
        setFormScope("lead")
        setShowCreate(true)
    }

    if (isLoading) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Stips Categories</h1>
                    <p className="text-muted-foreground">
                        Configure document categories (e.g. Personal, Finance) for lead Stips. Customer scope: documents follow the customer across leads; Lead scope: documents only for that lead.
                    </p>
                </div>
                {canManage && (
                    <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
                        Add Category
                    </Button>
                )}
            </div>

            {deleteError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-2 text-sm text-destructive">
                    {deleteError}
                </div>
            )}

            <Card>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {categories.length === 0 ? (
                            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                                No categories yet. Add one to organize Stips documents on leads.
                            </div>
                        ) : (
                            categories.map((category) => (
                                <div
                                    key={category.id}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30"
                                >
                                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm">{category.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Scope: {category.scope} · Order: {category.display_order}
                                        </p>
                                    </div>
                                    {canManage && (
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => openEdit(category)}>
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleDelete(category)}>
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editCategory ? "Edit Category" : "New Category"}</DialogTitle>
                        <DialogDescription>
                            {editCategory ? "Update this Stips category." : "Add a new document category for leads."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                placeholder="e.g. Personal, Finance"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Scope</Label>
                            <Select value={formScope} onValueChange={(v) => setFormScope(v as "customer" | "lead")}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="lead">Lead — documents only for this lead</SelectItem>
                                    <SelectItem value="customer">Customer — documents follow the customer across leads</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Display order</Label>
                            <Input
                                type="number"
                                min={0}
                                value={formOrder}
                                onChange={(e) => setFormOrder(parseInt(e.target.value, 10) || 0)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || !formName.trim()}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {editCategory ? "Save Changes" : "Create Category"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
