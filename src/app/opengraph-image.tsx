import { ImageResponse } from "next/og";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          background:
            "radial-gradient(circle at top left, rgba(94,231,255,0.18), transparent 28%), radial-gradient(circle at 80% 10%, rgba(108,139,255,0.18), transparent 24%), linear-gradient(180deg, #07101a 0%, #03070d 100%)",
          color: "#f2f7fd",
          padding: "56px",
          fontFamily: "IBM Plex Sans, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(6,11,17,0.82)",
            padding: "40px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                width: "56px",
                height: "56px",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(9,18,28,0.92)",
                color: "#5ee7ff",
                fontSize: "28px",
                fontWeight: 700,
              }}
            >
              A
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "20px", letterSpacing: "0.28em", textTransform: "uppercase", color: "#8ea4bc" }}>
                {BRAND_NAME}
              </div>
              <div style={{ fontSize: "28px", fontWeight: 600 }}>{BRAND_DESCRIPTOR}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px", maxWidth: "860px" }}>
            <div style={{ fontSize: "72px", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.06em" }}>
              Track narratives before the trade gets crowded.
            </div>
            <div style={{ fontSize: "28px", lineHeight: 1.45, color: "#a5b8cd" }}>
              Live narrative rankings, linked memecoins, and market validation in one paid research workflow.
            </div>
          </div>

          <div style={{ display: "flex", gap: "18px", fontSize: "20px", textTransform: "uppercase", letterSpacing: "0.18em", color: "#b6c8da" }}>
            <span>Research software</span>
            <span>Paid access</span>
            <span>Not execution</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
