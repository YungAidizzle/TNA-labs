import type { Metadata } from "next";
import { DashboardPreviewSurface } from "@/components/marketing/dashboard-preview-surface";

export const metadata: Metadata = {
  title: "Dashboard Hero Preview",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DashboardHeroPreviewPage() {
  return (
    <main className="min-h-screen bg-[#03060a] p-8">
      <div className="mx-auto w-fit">
        <DashboardPreviewSurface />
      </div>
    </main>
  );
}
