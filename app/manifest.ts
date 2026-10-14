import type { MetadataRoute } from "next";
import { config } from "@/server/runtime";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const { siteName, tagline } = config();
  return {
    name: siteName,
    short_name: siteName.length > 12 ? siteName.slice(0, 12).trim() : siteName,
    description: tagline,
    start_url: "/",
    display: "standalone",
    // Either way up — locking to portrait shuts out anyone whose phone is
    // mounted sideways (WCAG 1.3.4).
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android masks icons into circles/squircles — this one keeps the
      // mark inside the safe zone so it never gets clipped.
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
