import { redirect } from "next/navigation"

/** Old URL; campaign + WhatsApp settings live on campaign-mappings. */
export default function CampaignNamesRedirectPage() {
    redirect("/settings/campaign-mappings")
}
