"use client";

// After connecting with RawTree: pick the organization, cluster, and database, like
// jev-pr-quality's picker. Each choice narrows the next; the pick is posted to a server action.
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { pickWorkspace } from "../../app/sign-in/actions.ts";
import type { Workspace } from "../../lib/rawtree-connect.ts";

const select = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary";
const DEFAULT_DATABASE = "web_analytics";

export function WorkspacePicker({ workspaces, buttonClass }: { workspaces: Workspace[]; buttonClass: string }) {
  const usable = workspaces.filter((w) => w.databases.length > 0);
  const preferred = usable.find((w) => w.databases.includes(DEFAULT_DATABASE)) ?? usable[0];
  const [organization, setOrganization] = useState(preferred?.organization ?? "");
  const [cluster, setCluster] = useState(preferred?.cluster ?? "");
  const [database, setDatabase] = useState(preferred?.databases.includes(DEFAULT_DATABASE) ? DEFAULT_DATABASE : (preferred?.databases[0] ?? ""));

  if (!preferred) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        Your RawTree account has no databases yet. Create <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{DEFAULT_DATABASE}</span> in
        RawTree, then reload this page.
      </p>
    );
  }

  const organizations = [...new Set(usable.map((w) => w.organization))];
  const clusters = usable.filter((w) => w.organization === organization);
  const databases = clusters.find((w) => w.cluster === cluster)?.databases ?? [];
  const firstDatabase = (w: Workspace | undefined) => (w?.databases.includes(DEFAULT_DATABASE) ? DEFAULT_DATABASE : (w?.databases[0] ?? ""));
  const chooseCluster = (w: Workspace | undefined) => {
    setCluster(w?.cluster ?? "");
    setDatabase(firstDatabase(w));
  };

  return (
    <form action={pickWorkspace} className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium">
        Organization
        <select
          className={select}
          onChange={(event) => {
            setOrganization(event.target.value);
            chooseCluster(usable.find((w) => w.organization === event.target.value));
          }}
          value={organization}
        >
          {organizations.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Cluster
        <select className={select} onChange={(event) => chooseCluster(clusters.find((w) => w.cluster === event.target.value))} value={cluster}>
          {clusters.map((w) => (
            <option key={w.cluster}>{w.cluster}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Database
        <select className={select} onChange={(event) => setDatabase(event.target.value)} value={database}>
          {databases.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <input name="workspace" type="hidden" value={JSON.stringify({ organization, cluster, database })} />
      <button className={`${buttonClass} justify-self-end`} disabled={!database} type="submit">
        Load dashboard <IconChevronRight className="size-4" />
      </button>
    </form>
  );
}
