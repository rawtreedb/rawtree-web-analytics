"use client";

// After connecting with RawTree: pick the organization, cluster, and database. Each choice
// narrows the next; the pick is posted to a server action.
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { pickWorkspace } from "../../app/sign-in/actions.ts";
import type { Workspace } from "../../lib/rawtree-connect.ts";
import { Button } from "../ui/button.tsx";
import { codeClass } from "../ui/styles.ts";
import { SearchSelect } from "./search-select.tsx";

const DEFAULT_DATABASE = "web_analytics";

export function WorkspacePicker({ workspaces }: { workspaces: Workspace[] }) {
  const usable = workspaces.filter((w) => w.databases.length > 0);
  const preferred = usable.find((w) => w.databases.includes(DEFAULT_DATABASE)) ?? usable[0];
  const [organization, setOrganization] = useState(preferred?.organization ?? "");
  const [cluster, setCluster] = useState(preferred?.cluster ?? "");
  const [database, setDatabase] = useState(preferred?.databases.includes(DEFAULT_DATABASE) ? DEFAULT_DATABASE : (preferred?.databases[0] ?? ""));

  if (!preferred) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        Your RawTree account has no databases yet. Create <span className={codeClass}>{DEFAULT_DATABASE}</span> in
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
      <SearchSelect
        items={organizations}
        label="Organization"
        onValueChange={(name) => {
          setOrganization(name);
          chooseCluster(usable.find((w) => w.organization === name));
        }}
        placeholder="Select an organization"
        value={organization}
      />
      <SearchSelect
        items={clusters.map((w) => w.cluster)}
        label="Cluster"
        onValueChange={(name) => chooseCluster(clusters.find((w) => w.cluster === name))}
        placeholder="Select a cluster"
        value={cluster}
      />
      <SearchSelect items={databases} label="Database" onValueChange={setDatabase} placeholder="Select a database" value={database} />
      <input name="workspace" type="hidden" value={JSON.stringify({ organization, cluster, database })} />
      <Button className="justify-self-end" disabled={!database} type="submit">
        Load dashboard <IconChevronRight />
      </Button>
    </form>
  );
}
