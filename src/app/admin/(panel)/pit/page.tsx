import { loadAdminPage } from "@/lib/admin-auth";
import { pitParts, readPitAdmin } from "@/lib/admin-games-data";
import { AdminShell, readFlash } from "@/app/admin/ui";
import { PitView } from "./PitView";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminPitPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip.
  const { data } = await loadAdminPage(pitParts());

  return (
    <AdminShell title="The Pit" flash={readFlash(await searchParams)}>
      <PitView data={readPitAdmin(data)} />
    </AdminShell>
  );
}
