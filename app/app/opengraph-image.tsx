import { ImageResponse } from "next/og";
import { loadAppIconDataUri, loadOgFonts, OG_SIZE } from "@/lib/og";
import { config } from "@/server/runtime";
import { siteOrigin } from "@/server/site";

export const dynamic = "force-dynamic";

export const alt = "Now an app — add it to your Home Screen";
export const size = OG_SIZE;
export const contentType = "image/png";

const perks = ["Push notifications", "Full-screen feed", "Auto-updates", "No app store"];

export default async function Image() {
  const icon = await loadAppIconDataUri();
  const { siteName } = config();
  const address = (await siteOrigin()).replace(/^https?:\/\//, "");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#0a0a0a",
          backgroundImage: "radial-gradient(circle at 18% 30%, #1c1c1c 0%, #0a0a0a 58%)",
          fontFamily: "Inter",
        }}
      >
        {/* hairline frame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            display: "flex",
            border: "1px solid #2a2a2a",
            borderRadius: 28,
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 64,
            padding: "0 96px",
            width: "100%",
          }}
        >
          {/* app icon with GET pill, App Store style */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
            <img
              src={icon}
              alt=""
              width={224}
              height={224}
              style={{ borderRadius: 52, border: "1px solid #2a2a2a" }}
            />
            <div
              style={{
                display: "flex",
                backgroundColor: "#ffffff",
                color: "#000000",
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: 2,
                borderRadius: 999,
                padding: "12px 44px",
              }}
            >
              GET
            </div>
          </div>

          {/* pitch */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 5,
                color: "#ff3b5c",
              }}
            >
              NOW ON YOUR HOME SCREEN
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 900,
                color: "#ffffff",
                lineHeight: 1.04,
                letterSpacing: -2,
                marginTop: 18,
              }}
            >
              {siteName} now has an app.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 36 }}>
              {perks.map((perk) => (
                <div
                  key={perk}
                  style={{
                    display: "flex",
                    fontSize: 23,
                    fontWeight: 700,
                    color: "#cccccc",
                    backgroundColor: "#161616",
                    border: "1px solid #2a2a2a",
                    borderRadius: 999,
                    padding: "10px 24px",
                  }}
                >
                  {perk}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 40 }}>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#ffffff" }}>
                {address}/app
              </div>
              <div style={{ display: "flex", fontSize: 24, color: "#8a8a8a" }}>
                · installs in 10 seconds
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await loadOgFonts() }
  );
}
