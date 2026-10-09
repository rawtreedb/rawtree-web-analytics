// Recordings entry point: opens the most recent recording in the player view
// (/recordings/[id], with the list in its sidebar), or shows why there is nothing to play.

import { redirect } from "next/navigation";
import { requireAccess, signInAgainIfRejected } from "../../lib/access.ts";
import { getLatestRecordingId, queryErrorMessage } from "../../lib/dashboard.ts";
import { CardEmpty, DashboardCard, ErrorCard, PageToolbar } from "../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  const access = await requireAccess();
  let latest: string | undefined;
  let error: string | undefined;
  try {
    latest = await getLatestRecordingId(access.query);
  } catch (caught) {
    signInAgainIfRejected(caught);
    error = queryErrorMessage(caught);
  }
  // Outside the try: redirect() works by throwing.
  if (latest) redirect(`/recordings/${encodeURIComponent(latest)}`);

  return (
    <div className="w-full">
      <PageToolbar title="Recordings" />
      {error ? (
        <ErrorCard>{error}</ErrorCard>
      ) : (
        <DashboardCard title="Session recordings">
          <CardEmpty>No recordings yet. Record one from the Console with recording consent, then reload this page.</CardEmpty>
        </DashboardCard>
      )}
    </div>
  );
}
