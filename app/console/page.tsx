// Test console: send events, simulated traffic, and recordings through the real SDK and
// watch each one reach RawTree. Writes go only to the signed-in visitor's own database.

import { ConsoleApp } from "../../components/console/console-app.tsx";
import { requireAccess } from "../../lib/access.ts";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const access = await requireAccess();
  return <ConsoleApp database={access.label} />;
}
