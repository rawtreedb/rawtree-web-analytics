// Recordings entry point: opens the most recent recording in the player view
// (/recordings/[id], with the list in its sidebar), or shows why there is nothing to play.

import { redirect } from "next/navigation";
import { DashboardQueryError, extractRecordings, loadQueryConfig, recordingsListSql, runQuery } from "../../lib/dashboard.ts";
import { CardEmpty, DashboardCard, ErrorCard, PageToolbar } from "../../components/ui.tsx";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  let latest: string | undefined;
  let error: string | undefined;
  try {
    const config = loadQueryConfig();
    latest = extractRecordings(await runQuery(config, recordingsListSql(config, 1)))[0]?.recordingId;
  } catch (caught) {
    if (caught instanceof DashboardQueryError) {
      error = caught.message;
    } else {
      console.error("recordings query failed", caught);
      error = "Could not reach RawTree. Check the server logs and the RAWTREE_QUERY_KEY configuration.";
    }
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
          <CardEmpty>No recordings yet. Record with recording consent in the test console, then reload this page.</CardEmpty>
        </DashboardCard>
      )}
    </div>
  );
}
