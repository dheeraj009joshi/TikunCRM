import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

const APP_NAME = "TikunCRM";
const APP_DESCRIPTION = "Next-gen CRM for multi-level lead management";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tikuncrm.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: `${APP_NAME} | Modern Lead Management`,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: APP_NAME,
    title: `${APP_NAME} | Modern Lead Management`,
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} | Modern Lead Management`,
    description: APP_DESCRIPTION,
  },
  // Optional: set NEXT_PUBLIC_FB_APP_ID in .env to remove fb:app_id warning in Facebook Debugger
  ...(process.env.NEXT_PUBLIC_FB_APP_ID && {
    other: { "fb:app_id": process.env.NEXT_PUBLIC_FB_APP_ID },
  }),
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

import { AuthGuard } from "@/components/auth/auth-guard"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegistration />
          <AuthGuard>
            {children}
          </AuthGuard>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
