import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import PwaSetup from "@/components/PwaSetup";
import SiteProvider from "@/components/SiteProvider";
import { publicSite } from "@/server/core/config";
import { config } from "@/server/runtime";
import { siteOrigin } from "@/server/site";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// The name, colour and address are the host's choices and can change while
// the server is running, so nothing here is baked in at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { siteName, tagline } = config();
  return {
    metadataBase: new URL(await siteOrigin()),
    title: siteName,
    description: tagline,
    // A private site has no business in a search index.
    robots: { index: false, follow: false },
    openGraph: {
      title: siteName,
      description: tagline,
      url: "/",
      siteName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description: tagline,
    },
    appleWebApp: {
      capable: true,
      title: siteName,
      statusBarStyle: "black-translucent",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const site = publicSite(config());
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      style={{ "--accent": site.accent } as CSSProperties}
    >
      <body className="min-h-full bg-canvas text-white">
        <SiteProvider site={site}>
          <AuthProvider>{children}</AuthProvider>
          <PwaSetup />
        </SiteProvider>
      </body>
    </html>
  );
}
