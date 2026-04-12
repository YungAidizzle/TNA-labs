import { redirect } from "next/navigation";

export default async function NarrativeExplorerRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/trends?selected=${encodeURIComponent(id)}`);
}
