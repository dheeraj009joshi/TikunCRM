"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2 } from "lucide-react"

/**
 * Redirect /pipeline to /leads?view=pipeline, preserving filter, search, source query params.
 * Pipeline is now combined with the Leads page; this keeps old links and bookmarks working.
 */
export default function PipelinePage() {
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString())
        params.set("view", "pipeline")
        router.replace(`/leads?${params.toString()}`)
    }, [router, searchParams])

    return (
        <div className="flex h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
}
