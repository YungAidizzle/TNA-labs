import { GptTrendsDashboard } from "@/components/trends/gpt-trends-dashboard";
import { getLatestSuccessfulTrendSnapshotView } from "@/lib/gpt-trends/repository";

export async function TrendsPage() {
  const view = await getLatestSuccessfulTrendSnapshotView();
  return <GptTrendsDashboard view={view} />;
}
