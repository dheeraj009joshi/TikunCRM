import type { Metadata } from "next"
import { GuestPublicClient } from "./guest-public-client"
import {
    fetchPublicGuest,
    guestOgDescription,
    guestOgTitle,
    guestSharePageUrl,
} from "@/lib/guest-public"

type PageProps = {
    params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    const profile = await fetchPublicGuest(token)
    const title = guestOgTitle(profile)
    const description = guestOgDescription(profile)
    const url = guestSharePageUrl(token)

    return {
        title,
        description,
        openGraph: {
            type: "website",
            url,
            title,
            description,
            siteName: "TikunCRM",
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
        },
    }
}

export default async function PublicGuestPage({ params }: PageProps) {
    const { token } = await params
    return <GuestPublicClient token={token} />
}
