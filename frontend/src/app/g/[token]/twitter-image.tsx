/** Same card as opengraph-image — config must be declared here (Next.js ignores re-exported runtime/revalidate). */
export { default } from "./opengraph-image"

export const alt = "Guest QR profile"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const runtime = "nodejs"
export const revalidate = 60
