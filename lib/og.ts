import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Shared bits for the generated social cards (app/**/opengraph-image.tsx).
// Fonts are vendored in assets/og so builds never depend on the network —
// the default next/og font is a single regular weight, too thin for cards.

export const OG_SIZE = { width: 1200, height: 630 };

export async function loadOgFonts() {
  const dir = join(process.cwd(), "assets", "og");
  const [regular, bold, black] = await Promise.all([
    readFile(join(dir, "Inter-Regular.ttf")),
    readFile(join(dir, "Inter-Bold.ttf")),
    readFile(join(dir, "Inter-Black.ttf")),
  ]);
  return [
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
    { name: "Inter", data: black, weight: 900 as const, style: "normal" as const },
  ];
}

// The real app icon, inlined so satori doesn't need a URL to fetch.
export async function loadAppIconDataUri() {
  const icon = await readFile(join(process.cwd(), "public", "icon-512.png"));
  return `data:image/png;base64,${icon.toString("base64")}`;
}
