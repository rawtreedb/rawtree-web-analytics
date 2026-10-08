// One recording in the player, with the 50 most recent recordings in a sidebar to browse.
// Metadata comes from the read-only key; payloads are fetched and reassembled through
// /api/recordings/[id] in bounded parts.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DashboardQueryError,
  extractRecordingSummary,
  extractRecordings,
  loadQueryConfig,
  recordingSummarySql,
  recordingsListSql,
  runQuery,
  type RecordingListItem,
} from "../../../lib/dashboard.ts";
import { formatBytes, formatDateTime, formatDuration } from "../../../lib/format.ts";
import { Badge, ErrorCard, PageToolbar, cn } from "../../../components/ui.tsx";
import { RecordingPlayer } from "../../../components/recording-player.tsx";

export const dynamic = "force-dynamic";

function StatusBadge({ complete, arriving }: { complete: boolean; arriving: boolean }) {
  if (complete) return <Badge variant="success">Complete</Badge>;
  if (arriving) return <Badge variant="warning" data-testid="badge-arriving">Still arriving</Badge>;
  return <Badge variant="error" data-testid="badge-incomplete">Incomplete</Badge>;
}

function RecordingList({ recordings, selectedId }: { recordings: RecordingListItem[]; selectedId: string }) {
  return (
    <aside aria-label="Recordings" className="flex min-h-0 flex-col lg:order-first overflow-hidden rounded-2xl border bg-card shadow-soft">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="m-0 text-sm font-semibold">Recordings</h2>
        <span className="numeric text-xs text-muted-foreground">{recordings.length}</span>
      </header>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2 max-lg:max-h-96" data-testid="recordings-list">
        {recordings.map((recording) => {
          const selected = recording.recordingId === selectedId;
          return (
            <li key={recording.recordingId}>
              <Link
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "grid gap-1 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-muted",
                  selected && "bg-primary/10 hover:bg-primary/10",
                )}
                href={`/recordings/${recording.recordingId}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("numeric font-semibold", selected && "text-primary")}>{formatDateTime(recording.startMs)}</span>
                  <span className="numeric text-muted-foreground">{formatDuration(recording.endMs - recording.startMs)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-muted-foreground" title={recording.sessionId}>
                    {recording.sessionId.slice(0, 8)} · {formatBytes(recording.bytes)}
                  </span>
                  <StatusBadge arriving={recording.arriving} complete={recording.complete} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let summary: ReturnType<typeof extractRecordingSummary>;
  let recordings: RecordingListItem[] = [];
  let error: string | undefined;
  try {
    const config = loadQueryConfig();
    const [summaryRows, listRows] = await Promise.all([runQuery(config, recordingSummarySql(config, id)), runQuery(config, recordingsListSql(config))]);
    summary = extractRecordingSummary(summaryRows[0]);
    recordings = extractRecordings(listRows);
  } catch (caught) {
    if (caught instanceof DashboardQueryError) {
      if (caught.status === 404) notFound();
      error = caught.message;
    } else {
      console.error("recording query failed", caught);
      error = "Could not reach RawTree. Check the server logs and the RAWTREE_QUERY_KEY configuration.";
    }
    summary = undefined;
  }

  return (
    // From lg up the view fills the viewport (main's padding is p-4 lg:p-6): only the list scrolls.
    <div className="flex w-full flex-col lg:h-[calc(100dvh-3rem)]">
      <PageToolbar meta={<span>Replayed in the browser from stored chunks. Incomplete recordings replay only their complete stretches.</span>} title="Recordings" />
      {error ? <ErrorCard>{error}</ErrorCard> : null}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="flex min-h-0 min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 shadow-soft">
          {summary ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="m-0 truncate font-mono text-sm font-semibold" data-testid="recording-title">
                      {id}
                    </h2>
                    <StatusBadge arriving={summary.arriving} complete={summary.complete} />
                  </div>
                  <p className="m-0 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{formatDateTime(summary.startMs)}</span>
                    <span>{formatDuration(summary.endMs - summary.startMs)}</span>
                    <span>
                      {summary.chunks.toLocaleString("en-US")} chunks · {formatBytes(summary.bytes)}
                    </span>
                    <span>
                      Session <span className="font-mono">{summary.sessionId}</span>
                    </span>
                  </p>
                </div>
              </header>
              <RecordingPlayer recordingId={id} />
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">This recording could not be loaded.</p>
          )}
        </section>
        {recordings.length ? <RecordingList recordings={recordings} selectedId={id} /> : null}
      </div>
    </div>
  );
}
