import { ImageResponse } from "next/og"
import { readFile } from "fs/promises"
import path from "path"

export const alt = "TikunCRM | Modern Lead Management"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  let logoDataUrl = ""
  try {
    const publicPath = path.join(process.cwd(), "public", "Gemini_Generated_Image_iauae6iauae6iaua.png")
    const buffer = await readFile(publicPath)
    logoDataUrl = `data:image/png;base64,${buffer.toString("base64")}`
  } catch {
    // Fallback if file not found (e.g. in some build environments)
    logoDataUrl = ""
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        }}
      >
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt="TikunCRM"
            width={320}
            height={320}
            style={{ objectFit: "contain", marginBottom: 24 }}
          />
        ) : null}
        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: "white",
            letterSpacing: "-0.02em",
          }}
        >
          TikunCRM
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#94a3b8",
            marginTop: 8,
          }}
        >
          Modern Lead Management
        </div>
      </div>
    ),
    { ...size }
  )
}
