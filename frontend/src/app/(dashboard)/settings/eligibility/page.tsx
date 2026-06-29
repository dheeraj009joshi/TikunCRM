"use client"

import * as React from "react"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Plus, Pencil, Trash2, Loader2, X, Sparkles } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useRole } from "@/hooks/use-role"
import { useAuthStore } from "@/stores/auth-store"
import {
    EligibilityService,
    AUTO_FIELD_OPTIONS,
    type EligibilityCriterion,
    type CriterionConfig,
    type EligibilityInputType,
    type EligibilityValueSource,
    type SelectOption,
} from "@/services/eligibility-service"

interface FormState {
    label: string
    description: string
    category: string
    weight: string
    input_type: EligibilityInputType
    value_source: EligibilityValueSource
    auto_field: string
    // number config
    method: "threshold" | "scaled"
    operator: "gte" | "lte" | "gt" | "lt" | "eq"
    threshold: string
    min: string
    max: string
    direction: "higher_better" | "lower_better"
    // select config
    options: SelectOption[]
    is_active: boolean
}

const emptyForm: FormState = {
    label: "",
    description: "",
    category: "General",
    weight: "10",
    input_type: "boolean",
    value_source: "manual",
    auto_field: "",
    method: "threshold",
    operator: "gte",
    threshold: "",
    min: "0",
    max: "10000",
    direction: "higher_better",
    options: [],
    is_active: true,
}

function buildConfig(form: FormState): CriterionConfig {
    if (form.input_type === "number") {
        if (form.method === "scaled") {
            return {
                method: "scaled",
                min: Number(form.min) || 0,
                max: Number(form.max) || 0,
                direction: form.direction,
            }
        }
        return {
            method: "threshold",
            operator: form.operator,
            threshold: Number(form.threshold) || 0,
        }
    }
    if (form.input_type === "select") {
        return { options: form.options }
    }
    return {}
}

function EligibilitySettingsInner() {
    const searchParams = useSearchParams()
    const { user } = useAuthStore()
    const { isSuperAdmin, isDealershipAdmin, isDealershipOwner, isBdc } = useRole()
    const canManage = isSuperAdmin || isDealershipAdmin || isDealershipOwner || isBdc

    const [criteria, setCriteria] = React.useState<EligibilityCriterion[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [showDialog, setShowDialog] = React.useState(false)
    const [editing, setEditing] = React.useState<EligibilityCriterion | null>(null)
    const [form, setForm] = React.useState<FormState>(emptyForm)
    const [isSaving, setIsSaving] = React.useState(false)

    const dealershipIdFromQuery = searchParams.get("dealership_id")
    const contextDealershipId = React.useMemo(() => {
        if (isSuperAdmin && dealershipIdFromQuery) return dealershipIdFromQuery
        if (user?.dealership_id) return user.dealership_id
        return undefined
    }, [isSuperAdmin, dealershipIdFromQuery, user?.dealership_id])

    const load = React.useCallback(async () => {
        setIsLoading(true)
        try {
            setCriteria(await EligibilityService.listCriteria(contextDealershipId))
        } catch (e) {
            console.error("Failed to load criteria", e)
        } finally {
            setIsLoading(false)
        }
    }, [contextDealershipId])

    React.useEffect(() => {
        void load()
    }, [load])

    const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }))

    const openCreate = () => {
        setEditing(null)
        setForm(emptyForm)
        setShowDialog(true)
    }

    const openEdit = (c: EligibilityCriterion) => {
        const cfg = c.config || {}
        setEditing(c)
        setForm({
            label: c.label,
            description: c.description || "",
            category: c.category || "General",
            weight: String(c.weight ?? 0),
            input_type: c.input_type,
            value_source: c.value_source,
            auto_field: c.auto_field || "",
            method: cfg.method === "scaled" ? "scaled" : "threshold",
            operator: cfg.operator || "gte",
            threshold: cfg.threshold != null ? String(cfg.threshold) : "",
            min: cfg.min != null ? String(cfg.min) : "0",
            max: cfg.max != null ? String(cfg.max) : "10000",
            direction: cfg.direction === "lower_better" ? "lower_better" : "higher_better",
            options: cfg.options || [],
            is_active: c.is_active,
        })
        setShowDialog(true)
    }

    const handleSave = async () => {
        if (!form.label) return
        setIsSaving(true)
        try {
            const payload = {
                label: form.label,
                description: form.description || null,
                category: form.category || "General",
                weight: Number(form.weight) || 0,
                input_type: form.input_type,
                value_source: form.value_source,
                auto_field: form.value_source === "auto" ? form.auto_field || null : null,
                config: buildConfig(form),
                is_active: form.is_active,
            }
            if (editing) {
                await EligibilityService.updateCriterion(editing.id, payload)
            } else {
                await EligibilityService.createCriterion({
                    ...payload,
                    dealership_id: contextDealershipId || null,
                    display_order: criteria.length,
                })
            }
            setShowDialog(false)
            await load()
        } catch (e) {
            console.error("Failed to save criterion", e)
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (c: EligibilityCriterion) => {
        if (!confirm(`Delete "${c.label}"? This removes it from all scores.`)) return
        try {
            await EligibilityService.deleteCriterion(c.id)
            await load()
        } catch (e) {
            console.error("Failed to delete criterion", e)
        }
    }

    const toggleActive = async (c: EligibilityCriterion) => {
        try {
            await EligibilityService.updateCriterion(c.id, { is_active: !c.is_active })
            await load()
        } catch (e) {
            console.error("Failed to toggle criterion", e)
        }
    }

    const addOption = () =>
        setField("options", [...form.options, { label: "", value: "", fraction: 1 }])
    const updateOption = (i: number, patch: Partial<SelectOption>) =>
        setField("options", form.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
    const removeOption = (i: number) =>
        setField("options", form.options.filter((_, idx) => idx !== i))

    if (isLoading) {
        return (
            <div className="flex h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Eligibility Criteria</h1>
                    <p className="text-muted-foreground">
                        Define the weighted factors that make up the Trust Score for leads, customers, and guests.
                        Add any criterion and it appears automatically wherever the score is shown.
                    </p>
                </div>
                {canManage && (
                    <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        Add Criterion
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    {criteria.length === 0 ? (
                        <div className="py-12 text-center text-sm text-muted-foreground">
                            No criteria yet. Add your first one to start scoring.
                        </div>
                    ) : (
                        <div className="divide-y">
                            {criteria.map((c) => (
                                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-medium text-sm">{c.label}</p>
                                            <Badge variant="secondary" className="text-[10px]">{c.category}</Badge>
                                            <Badge variant="outline" className="text-[10px]">{c.input_type}</Badge>
                                            {c.value_source === "auto" && (
                                                <Badge variant="outline" className="text-[10px]">
                                                    <Sparkles className="h-3 w-3 mr-1" />auto: {c.auto_field}
                                                </Badge>
                                            )}
                                            {!c.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                                        </div>
                                        {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs font-semibold tabular-nums">wt {Number(c.weight)}</span>
                                        {canManage && (
                                            <>
                                                <Switch checked={c.is_active} onCheckedChange={() => toggleActive(c)} />
                                                <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit Criterion" : "New Criterion"}</DialogTitle>
                        <DialogDescription>
                            Configure how this factor is captured and how much it contributes to the score.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input value={form.label} onChange={(e) => setField("label", e.target.value)} placeholder="e.g. Valid driver's license" />
                        </div>
                        <div className="space-y-2">
                            <Label>Description (optional)</Label>
                            <Textarea value={form.description} onChange={(e) => setField("description", e.target.value)} rows={2} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Input value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="e.g. Finance" />
                            </div>
                            <div className="space-y-2">
                                <Label>Weight (max points)</Label>
                                <Input type="number" value={form.weight} onChange={(e) => setField("weight", e.target.value)} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Input type</Label>
                                <Select value={form.input_type} onValueChange={(v) => setField("input_type", v as EligibilityInputType)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="boolean">Yes / No checkbox</SelectItem>
                                        <SelectItem value="number">Number</SelectItem>
                                        <SelectItem value="select">Dropdown</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Value source</Label>
                                <Select value={form.value_source} onValueChange={(v) => setField("value_source", v as EligibilityValueSource)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual">Manual (rep fills it)</SelectItem>
                                        <SelectItem value="auto">Auto (from data)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {form.value_source === "auto" && (
                            <div className="space-y-2">
                                <Label>Auto field</Label>
                                <Select value={form.auto_field} onValueChange={(v) => setField("auto_field", v)}>
                                    <SelectTrigger><SelectValue placeholder="Select data field" /></SelectTrigger>
                                    <SelectContent>
                                        {AUTO_FIELD_OPTIONS.map((o) => (
                                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">Auto value can still be overridden manually on each record.</p>
                            </div>
                        )}

                        {form.input_type === "number" && (
                            <div className="space-y-3 rounded-md border p-3">
                                <div className="space-y-2">
                                    <Label>Scoring method</Label>
                                    <Select value={form.method} onValueChange={(v) => setField("method", v as "threshold" | "scaled")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="threshold">Threshold (all-or-nothing)</SelectItem>
                                            <SelectItem value="scaled">Scaled (proportional)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {form.method === "threshold" ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label>Operator</Label>
                                            <Select value={form.operator} onValueChange={(v) => setField("operator", v as FormState["operator"])}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="gte">≥ at least</SelectItem>
                                                    <SelectItem value="gt">&gt; greater than</SelectItem>
                                                    <SelectItem value="lte">≤ at most</SelectItem>
                                                    <SelectItem value="lt">&lt; less than</SelectItem>
                                                    <SelectItem value="eq">= equals</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Threshold</Label>
                                            <Input type="number" value={form.threshold} onChange={(e) => setField("threshold", e.target.value)} placeholder="e.g. 2000" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-2">
                                            <Label>Min</Label>
                                            <Input type="number" value={form.min} onChange={(e) => setField("min", e.target.value)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Max</Label>
                                            <Input type="number" value={form.max} onChange={(e) => setField("max", e.target.value)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Direction</Label>
                                            <Select value={form.direction} onValueChange={(v) => setField("direction", v as FormState["direction"])}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="higher_better">Higher is better</SelectItem>
                                                    <SelectItem value="lower_better">Lower is better</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {form.input_type === "select" && (
                            <div className="space-y-2 rounded-md border p-3">
                                <div className="flex items-center justify-between">
                                    <Label>Options (each carries a weight fraction 0–1)</Label>
                                    <Button type="button" variant="outline" size="sm" onClick={addOption}>
                                        <Plus className="h-3.5 w-3.5" /> Option
                                    </Button>
                                </div>
                                {form.options.length === 0 && (
                                    <p className="text-xs text-muted-foreground">No options yet.</p>
                                )}
                                {form.options.map((opt, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <Input
                                            className="flex-1"
                                            placeholder="Label"
                                            value={opt.label}
                                            onChange={(e) => updateOption(i, { label: e.target.value, value: opt.value || e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                                        />
                                        <Input
                                            className="w-24"
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            max="1"
                                            placeholder="0–1"
                                            value={opt.fraction}
                                            onChange={(e) => updateOption(i, { fraction: Number(e.target.value) })}
                                        />
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeOption(i)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <Label>Active</Label>
                            <Switch checked={form.is_active} onCheckedChange={(v) => setField("is_active", v)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={isSaving || !form.label}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {editing ? "Save Changes" : "Create Criterion"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function EligibilitySettingsPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-[40vh] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            }
        >
            <EligibilitySettingsInner />
        </Suspense>
    )
}
