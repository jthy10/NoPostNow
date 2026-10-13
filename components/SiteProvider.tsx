"use client";

import { createContext, useContext, type ReactNode } from "react";
import { setSite, type PublicSite } from "@/lib/site";

const SiteContext = createContext<PublicSite | null>(null);

// Publishes the host's settings to the whole tree. setSite runs during render
// — before any child — so modules that call site() directly see the same
// values components get from useSite().
export default function SiteProvider({ site, children }: { site: PublicSite; children: ReactNode }) {
  setSite(site);
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): PublicSite {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite must be used inside SiteProvider");
  return value;
}
