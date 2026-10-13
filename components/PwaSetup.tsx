"use client";

import { useEffect } from "react";

// Registers the service worker (app-shell cache + push notification handlers).
// updateViaCache "none" makes the browser fetch a fresh sw.js on every check,
// so deploys roll out without users clearing anything.
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
        // Registration failing (old browser, private mode) just means no
        // offline shell — the site itself works fine without it.
      });
    }
  }, []);
  return null;
}
