import { loadAdminPage } from "@/lib/admin-auth";
import { equipmentParts, readEquipmentAdmin } from "@/lib/admin-games-data";
import { AdminShell, readFlash } from "@/app/admin/ui";
import { EquipmentAdminView } from "./EquipmentAdminView";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip.
  const { data } = await loadAdminPage(equipmentParts());

  return (
    <AdminShell title="Equipment" flash={readFlash(await searchParams)}>
      <EquipmentAdminView data={readEquipmentAdmin(data)} />
    </AdminShell>
  );
}
