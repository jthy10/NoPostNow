import type { MetadataRoute } from "next";

// A private feed: ask every crawler to stay out entirely.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
