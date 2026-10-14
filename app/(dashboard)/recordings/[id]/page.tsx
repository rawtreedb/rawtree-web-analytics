// One recording in the player, with the 50 most recent recordings in a sidebar to browse.
// Metadata comes from the visitor's read access; payloads are fetched and reassembled through
// /api/recordings/[id] in bounded parts.

import Link from "next/link";
import { requireAccess, signInAgainIfRejected } from "../../../../lib/access.ts";
import { getRecording, queryErrorMessage, type RecordingListItem } from "../../../../lib/dashboard.ts";
import { formatBytes, formatDateTime, formatDuration, formatValue } from "../../../../lib/format.ts";
import { ErrorCard } from "../../../../components/dashboard/card.tsx";
import { PageToolbar } from "../../../../components/dashboard/page-toolbar.tsx";
import { Badge } from "../../../../components/ui/badge.tsx";
import { cardClass, cn, focusRing } from "../../../../components/ui/styles.ts";
import { RecordingPlayer } from "../../../../components/recording-player.tsx";

export const dynamic = "force-dynamic";

function StatusBadge({ complete, arriving }: { complete: boolean; arriving: boolean }) {
  if (complete) return <Badge variant="success">Complete</Badge>;
  if (arriving) return <Badge variant="warning" data-testid="badge-arriving">Still arriving</Badge>;
  return <Badge variant="error" data-testid="badge-incomplete">Incomplete</Badge>;
}

function RecordingList({ recordings, selectedId }: { recordings: RecordingListItem[]; selectedId: string }) {
  return (
    <aside aria-label="Recordings" className={cn(cardClass, "flex min-h-0 flex-col overflow-hidden @4xl:order-first")}>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="m-0 text-base font-semibold">Recordings</h2>
        <span className="numeric text-xs text-muted-foreground">{recordings.length}</span>
      </header>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2 @max-4xl:max-h-96" data-testid="recordings-list">
        {recordings.map((recording) => {
          const selected = recording.recordingId === selectedId;
          return (
            <li key={recording.recordingId}>
              <Link
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "grid gap-1 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-muted",
                  focusRing,
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
  const access = await requireAccess();
  const { id } = await params;
  let summary: RecordingListItem | undefined;
  let recordings: RecordingListItem[] = [];
  let error: string | undefined;
  try {
    ({ recording: summary, recordings } = await getRecording(id, access.query));
  } catch (caught) {
    signInAgainIfRejected(caught);
    error = queryErrorMessage(caught);
  }

  return (
    // With two columns (@4xl, like the console) the view fills the viewport: only the list scrolls.
    <div className="flex w-full flex-col @4xl:h-main">
      <PageToolbar meta={<span>Replayed in the browser from stored chunks. Incomplete recordings replay only their complete stretches.</span>} title="Recordings" />
      {error ? <ErrorCard>{error}</ErrorCard> : null}
      <div className="grid gap-4 @4xl:min-h-0 @4xl:flex-1 @4xl:grid-cols-aside">
        <section className={cn(cardClass, "flex min-h-0 min-w-0 flex-col gap-4 p-4")}>
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
                      {formatValue(summary.chunks)} chunks · {formatBytes(summary.bytes)}
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
