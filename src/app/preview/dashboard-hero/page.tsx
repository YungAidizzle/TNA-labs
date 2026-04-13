import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardPreviewSurface } from "@/components/marketing/dashboard-preview-surface";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Dashboard Preview`,
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardHeroPreviewPage() {
  const previewRoutesEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.ATTENTRA_ENABLE_PREVIEW_ROUTES?.trim().toLowerCase() === "1" ||
    process.env.ATTENTRA_ENABLE_PREVIEW_ROUTES?.trim().toLowerCase() === "true";

  if (!previewRoutesEnabled) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#03060a] p-8">
      <div className="mx-auto w-fit">
        <DashboardPreviewSurface />
      </div>
    </main>
  );
}
