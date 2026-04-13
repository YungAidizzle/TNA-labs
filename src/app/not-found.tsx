import { ErrorPageShell } from "@/components/shared/error-page-shell";

export default function NotFound() {
  return (
    <ErrorPageShell
      eyebrow="Not found"
      title="That page does not exist."
      description="The link may be outdated, the route may have been removed, or the page never existed in this launch build."
      secondaryHref="/"
      secondaryLabel="Open home"
    />
  );
}
