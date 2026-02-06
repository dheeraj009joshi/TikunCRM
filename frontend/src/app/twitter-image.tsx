import { ImageResponse } from "next/og"
import { readFile } from "fs/promises"
import path from "path"

export const alt = "TikunCRM | Modern Lead Management"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// Gemini generated image 2 (with background) in src/app
const LOGO_PATH = path.join(process.cwd(), "src", "app", "Gemini_Generated_Image_eem2dgeem2dgeem2.png")

export default async function Image() {
  let logoDataUrl = ""
  try {
    const buffer = await readFile(LOGO_PATH)
    logoDataUrl = `data:image/png;base64,${buffer.toString("base64")}`
  } catch {
    logoDataUrl = ""
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
        }}
      >
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt="TikunCRM"
            width={1200}
            height={630}
            style={{ objectFit: "contain", width: "100%", height: "100%" }}
          />
        ) : (
          <div style={{ fontSize: 48, color: "#0f172a", fontWeight: 700 }}>TikunCRM</div>
        )}
      </div>
    ),
    { ...size }
  )
}
