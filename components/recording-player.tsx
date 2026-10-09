// Client-side rrweb replay for one reassembled recording. The server (see
// /api/recordings/[id]) does the bounded fetch and reassembly; this component plays
// one segment at a time and never bridges a gap.
"use client";

import "rrweb/dist/style.css";
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconRotate } from "@tabler/icons-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { eventWithTime, Replayer } from "rrweb";
import { formatValue } from "../lib/format.ts";
import { SegmentedControl, cn } from "./ui.tsx";

type ReplayResponse = {
  recordingId: string;
  complete: boolean;
  gaps: string[];
  truncated: boolean;
  segments: { startTimestamp: number; endTimestamp: number; events: unknown[] }[];
};

const SPEEDS = [1, 2, 4, 8].map((speed) => ({ value: String(speed), label: `${speed}×` }));

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Clock and seek bar. Polls the replayer once per frame while playing, so only this re-renders. */
function Timeline({ replayerRef, playing, total }: { replayerRef: RefObject<Replayer | undefined>; playing: boolean; total: number }) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const read = () => {
      const replayer = replayerRef.current;
      if (replayer) setTime(Math.min(replayer.getCurrentTime(), replayer.getMetaData().totalTime));
    };
    read();
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      read();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [replayerRef, playing, total]);

  const seek = (offset: number) => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) replayer.play(offset);
    else replayer.pause(offset);
    setTime(offset);
  };

  return (
    <>
      <span className="numeric w-24 shrink-0 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{clock(time)}</span> / {clock(total)}
      </span>
      <input
        aria-label="Seek"
        className="h-1.5 min-w-40 flex-1 cursor-pointer accent-primary"
        max={total}
        min={0}
        onChange={(event) => seek(Number(event.target.value))}
        step={100}
        type="range"
        value={time}
      />
    </>
  );
}

const iconButton =
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 outline-none [&_svg]:size-4";

export function RecordingPlayer({ recordingId }: { recordingId: string }) {
  const [data, setData] = useState<ReplayResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [total, setTotal] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | undefined>(undefined);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError(undefined);
    setSegmentIndex(0);
    fetch(`/api/recordings/${encodeURIComponent(recordingId)}`)
      .then(async (response) => {
        const body = (await response.json()) as ReplayResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
        return body;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this recording.");
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  const segment = data?.segments[segmentIndex];

  // Mount the replayer for the selected segment, scaled to fit the stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !segment || segment.events.length === 0) return;
    let disposed = false;
    let replayer: Replayer | undefined;
    let viewport = { width: 1, height: 1 };
    const fit = () => {
      if (!replayer) return;
      const scale = Math.min(stage.clientWidth / viewport.width, stage.clientHeight / viewport.height);
      const wrapper = replayer.wrapper;
      wrapper.style.transformOrigin = "top left";
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.position = "absolute";
      wrapper.style.left = `${(stage.clientWidth - viewport.width * scale) / 2}px`;
      wrapper.style.top = `${(stage.clientHeight - viewport.height * scale) / 2}px`;
    };
    const observer = new ResizeObserver(fit);
    void (async () => {
      try {
        const { Replayer: RrwebReplayer } = await import("rrweb");
        if (disposed) return;
        stage.innerHTML = "";
        replayer = new RrwebReplayer(segment.events as eventWithTime[], { root: stage, mouseTail: false, speed: speedRef.current });
        replayerRef.current = replayer;
        replayer.on("resize", (dimension) => {
          viewport = dimension as { width: number; height: number };
          fit();
        });
        replayer.on("finish", () => setPlaying(false));
        observer.observe(stage);
        setTotal(replayer.getMetaData().totalTime);
        replayer.play(0);
        setPlaying(true);
      } catch (cause) {
        console.error("replay failed", cause);
        if (!disposed) setError("Replay failed in the browser. See the server logs.");
      }
    })();
    return () => {
      disposed = true;
      observer.disconnect();
      replayerRef.current = undefined;
      replayer?.destroy();
      stage.innerHTML = "";
    };
  }, [segment]);

  const togglePlay = () => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
      setPlaying(false);
      return;
    }
    // play() without an offset restarts from 0: resume from the current position instead.
    const current = replayer.getCurrentTime();
    replayer.play(current >= total ? 0 : current);
    setPlaying(true);
  };

  const restart = () => {
    replayerRef.current?.play(0);
    setPlaying(true);
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    replayerRef.current?.setConfig({ speed: value });
  };

  if (error) {
    return (
      <p className="rounded-xl bg-[var(--badge-error-bg)] px-4 py-3 text-sm text-[var(--badge-error-fg)]" data-testid="player-error">
        {error}
      </p>
    );
  }
  if (!data) {
    return <div className="w-full animate-pulse rounded-xl bg-muted max-lg:aspect-video lg:flex-1" aria-label="Loading recording" />;
  }
  if (data.segments.length === 0) {
    return (
      <p className="rounded-xl bg-[var(--badge-warning-bg)] px-4 py-3 text-sm text-[var(--badge-warning-fg)]" data-testid="player-unreplayable">
        Nothing to replay: no complete full snapshot survived. {data.gaps.join(". ")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {data.gaps.length > 0 || data.truncated ? (
        <p className="rounded-xl bg-[var(--badge-warning-bg)] px-4 py-2 text-xs text-[var(--badge-warning-fg)]" data-testid="player-gaps">
          {data.truncated ? "Only the first part of a long recording is loaded. " : ""}
          {data.gaps.length > 0
            ? `Skipped: ${data.gaps.slice(0, 3).join(". ")}${data.gaps.length > 3 ? `, and ${data.gaps.length - 3} more gaps` : ""}.`
            : ""}
        </p>
      ) : null}

      <div
        className="relative w-full overflow-hidden rounded-xl border bg-muted max-lg:aspect-video lg:min-h-0 lg:flex-1"
        data-testid="replayer"
        ref={stageRef}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button aria-label={playing ? "Pause" : "Play"} className={cn(iconButton, "bg-primary text-primary-foreground hover:bg-primary/85")} onClick={togglePlay} type="button">
          {playing ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
        </button>
        <button aria-label="Restart" className={cn(iconButton, "border bg-card text-muted-foreground shadow-soft hover:text-foreground")} onClick={restart} type="button">
          <IconRotate />
        </button>
        <Timeline playing={playing} replayerRef={replayerRef} total={total} />
        <SegmentedControl
          itemClassName="numeric px-2.5"
          items={SPEEDS}
          label="Playback speed"
          onValueChange={(value) => changeSpeed(Number(value))}
          value={String(speed)}
        />
      </div>

      {data.segments.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Complete stretches
          <SegmentedControl
            itemClassName="numeric"
            items={data.segments.map((item, index) => ({
              value: String(index),
              label: `${index + 1} · ${new Date(item.startTimestamp).toISOString().slice(11, 19)}`,
              title: `${formatValue(item.events.length)} events`,
            }))}
            label="Replay segment"
            onValueChange={(value) => setSegmentIndex(Number(value))}
            value={String(segmentIndex)}
          />
        </div>
      ) : null}
    </div>
  );
}
