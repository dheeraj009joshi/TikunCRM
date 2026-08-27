"use client"

import * as React from "react"
import { format } from "date-fns"
import {
  ExternalLink,
  Loader2,
  Trash2,
  Upload,
  User,
  FileStack,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  StipsService,
  type StipsCategory,
  type StipDocument,
} from "@/services/stips-service"

interface CreditAppStipsSectionProps {
  leadId: string
  dealershipId?: string | null
  primaryCustomerName?: string
  secondaryCustomerName?: string | null
  hasSecondaryCustomer?: boolean
}

export function CreditAppStipsSection({
  leadId,
  dealershipId,
  primaryCustomerName = "Primary customer",
  secondaryCustomerName,
  hasSecondaryCustomer = false,
}: CreditAppStipsSectionProps) {
  const { toast } = useToast()
  const [configured, setConfigured] = React.useState(false)
  const [categories, setCategories] = React.useState<StipsCategory[]>([])
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null)
  const [documents, setDocuments] = React.useState<StipDocument[]>([])
  const [loading, setLoading] = React.useState(true)
  const [docsLoading, setDocsLoading] = React.useState(false)
  const [targetCustomer, setTargetCustomer] = React.useState<"primary" | "secondary">("primary")
  const [uploadingCategoryId, setUploadingCategoryId] = React.useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [viewDoc, setViewDoc] = React.useState<{
    url: string
    fileName: string
    contentType: string
  } | null>(null)

  const loadCategories = React.useCallback(async () => {
    setLoading(true)
    try {
      const [status, cats] = await Promise.all([
        StipsService.getStatus(),
        StipsService.listCategories(dealershipId ?? undefined),
      ])
      setConfigured(status.configured)
      setCategories(cats)
      setActiveCategoryId((prev) =>
        prev && cats.some((c) => c.id === prev) ? prev : cats[0]?.id ?? null
      )
    } catch {
      setCategories([])
      setConfigured(false)
    } finally {
      setLoading(false)
    }
  }, [dealershipId])

  const loadDocuments = React.useCallback(async () => {
    if (!activeCategoryId) {
      setDocuments([])
      return
    }
    setDocsLoading(true)
    try {
      const customerId =
        targetCustomer === "secondary" && hasSecondaryCustomer ? "secondary" : undefined
      const list = await StipsService.listDocuments(
        leadId,
        activeCategoryId,
        customerId
      )
      setDocuments(list)
    } catch {
      setDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [leadId, activeCategoryId, targetCustomer, hasSecondaryCustomer])

  React.useEffect(() => {
    loadCategories()
  }, [loadCategories])

  React.useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  React.useEffect(() => {
    if (targetCustomer === "secondary" && !hasSecondaryCustomer) {
      setTargetCustomer("primary")
    }
  }, [hasSecondaryCustomer, targetCustomer])

  async function uploadFiles(categoryId: string, files: File[]) {
    if (!configured || files.length === 0) return
    setUploadingCategoryId(categoryId)
    setUploadProgress(0)
    try {
      if (files.length === 1) {
        await StipsService.uploadDocument(
          leadId,
          categoryId,
          files[0],
          (p) => setUploadProgress(p),
          targetCustomer
        )
      } else {
        let done = 0
        for (const file of files) {
          await StipsService.uploadDocument(
            leadId,
            categoryId,
            file,
            undefined,
            targetCustomer
          )
          done += 1
          setUploadProgress(Math.round((done / files.length) * 100))
        }
      }
      await loadDocuments()
      toast({ title: files.length === 1 ? "Document uploaded" : `${files.length} documents uploaded` })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({ title: msg || "Upload failed", variant: "destructive" })
    } finally {
      setUploadingCategoryId(null)
      setUploadProgress(0)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileStack className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Upload stipulation documents by category. Files are stored on the lead (same as the Stips tab).
        </p>
      </div>

      {!configured && (
        <p className="text-sm text-amber-700 dark:text-amber-400 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3">
          Stips storage is not configured. Upload is disabled until Azure storage is set up.
        </p>
      )}

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stips categories yet. An admin can add them under Settings → Stips Categories.
        </p>
      ) : (
        <>
          <div className="p-3 rounded-lg border bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground mb-2">Documents for:</p>
            <div className="flex gap-2 flex-wrap">
              <Button
                type="button"
                variant={targetCustomer === "primary" ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setTargetCustomer("primary")}
              >
                <User className="h-3 w-3 mr-1.5" />
                Primary: {primaryCustomerName}
              </Button>
              <Button
                type="button"
                variant={targetCustomer === "secondary" ? "default" : "outline"}
                size="sm"
                className="text-xs"
                disabled={!hasSecondaryCustomer}
                onClick={() => setTargetCustomer("secondary")}
              >
                <User className="h-3 w-3 mr-1.5" />
                {hasSecondaryCustomer && secondaryCustomerName
                  ? `Secondary: ${secondaryCustomerName}`
                  : "No secondary customer"}
              </Button>
            </div>
          </div>

          <Tabs
            value={activeCategoryId ?? ""}
            onValueChange={setActiveCategoryId}
            className="w-full"
          >
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1">
              {categories.map((cat) => (
                <TabsTrigger key={cat.id} value={cat.id} className="text-xs">
                  {cat.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {activeCategoryId && (
            <div className="space-y-4">
              {configured && (
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/40 transition-colors cursor-pointer"
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.currentTarget.classList.add("bg-muted/60")
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove("bg-muted/60")
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.currentTarget.classList.remove("bg-muted/60")
                    const files = Array.from(e.dataTransfer?.files ?? [])
                    if (files.length) uploadFiles(activeCategoryId, files)
                  }}
                  onClick={() =>
                    document.getElementById(`credit-app-stips-${activeCategoryId}`)?.click()
                  }
                >
                  <input
                    id={`credit-app-stips-${activeCategoryId}`}
                    type="file"
                    multiple
                    className="hidden"
                    accept="*/*"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      e.target.value = ""
                      if (files.length) uploadFiles(activeCategoryId, files)
                    }}
                  />
                  {uploadingCategoryId === activeCategoryId ? (
                    <div className="w-full max-w-xs mx-auto space-y-3">
                      <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Uploading… {uploadProgress}%</p>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Drag and drop or click to upload (multiple files allowed)
                      </p>
                    </>
                  )}
                </div>
              )}

              {docsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : documents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No documents in this category yet.</p>
              ) : (
                <ul className="space-y-2">
                  {documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.uploaded_by_name && `${doc.uploaded_by_name} · `}
                          {format(new Date(doc.uploaded_at), "MMM d, yyyy HH:mm")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={async () => {
                            try {
                              const { url } = await StipsService.getViewUrl(leadId, doc.id)
                              setViewDoc({
                                url,
                                fileName: doc.file_name,
                                contentType: doc.content_type,
                              })
                            } catch {
                              toast({ title: "Could not open document", variant: "destructive" })
                            }
                          }}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (!confirm("Delete this document?")) return
                            try {
                              await StipsService.deleteDocument(leadId, doc.id)
                              await loadDocuments()
                              toast({ title: "Document deleted" })
                            } catch {
                              toast({ title: "Delete failed", variant: "destructive" })
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={!!viewDoc} onOpenChange={(open) => !open && setViewDoc(null)}>
        <DialogContent className="max-w-[90vw] w-full max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-3 border-b shrink-0">
            <DialogTitle className="text-base truncate pr-8">{viewDoc?.fileName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-[50vh] p-2">
            {viewDoc && (
              viewDoc.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewDoc.url} alt={viewDoc.fileName} className="max-h-[70vh] mx-auto object-contain" />
              ) : viewDoc.contentType === "application/pdf" ? (
                <iframe src={viewDoc.url} title={viewDoc.fileName} className="w-full h-[70vh] rounded border" />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                  <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
                  <Button type="button" onClick={() => window.open(viewDoc.url, "_blank")}>
                    Open in new tab
                  </Button>
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
