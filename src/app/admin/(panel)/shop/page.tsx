import { Plus, Store } from "lucide-react";
import { Prisma } from "@prisma/client";
import { loadAdminPage } from "@/lib/admin-auth";
import { isAvailable, shopItemFromRow, type WebsiteShopItem } from "@/lib/shop/website-items";
import { parseShopSettings } from "@/lib/site-settings";
import { getChallengeDateString } from "@/lib/challenge-date";
import { deleteShopItemAction, saveShopAction, saveShopItemAction } from "@/app/admin/actions";
import { AdminShell, Field, readFlash } from "@/app/admin/ui";
import { SubmitButton } from "@/app/admin/controls";
import styles from "@/app/admin/admin.module.css";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function dayOf(iso: string | undefined): string {
  return iso ? getChallengeDateString(new Date(iso)) : "";
}

/** Split stored seconds back into the amount + unit the form edits. */
function duration(sec: number): { amount: number; unit: "hours" | "days" } {
  if (sec > 0 && sec % 86_400 !== 0) return { amount: Math.round(sec / 3600), unit: "hours" };
  return { amount: Math.round(sec / 86_400), unit: "days" };
}

function ItemFields({ item }: { item?: WebsiteShopItem }) {
  const d = duration(item?.effect.durationSec ?? 0);
  return (
    <div className={styles.formGrid}>
      {item ? (
        <input type="hidden" name="originalId" value={item.id} />
      ) : (
        <Field label="Item ID" hint="Permanent. e.g. vip-pass">
          <input name="id" required pattern="[a-z0-9][a-z0-9-]{1,39}" maxLength={40} className={styles.input} />
        </Field>
      )}
      <Field label="Name">
        <input name="name" required maxLength={60} defaultValue={item?.name ?? ""} className={styles.input} />
      </Field>
      <Field label="Price (coins)">
        <input name="price" type="number" min={1} step={1} required defaultValue={item?.price ?? ""} className={styles.input} />
      </Field>
      <Field label="Emoji">
        <input name="emoji" maxLength={16} defaultValue={item?.emoji ?? ""} className={styles.input} />
      </Field>
      <Field label="Description" wide>
        <input name="description" maxLength={300} defaultValue={item?.description ?? ""} className={styles.input} />
      </Field>
      <Field label="Discord role ID" hint="Blank = shown as “coming soon”.">
        <input name="roleId" inputMode="numeric" pattern="[0-9]{15,22}" defaultValue={item?.effect.roleId ?? ""} className={styles.input} />
      </Field>
      <Field label="Role lasts" hint="0 = permanent.">
        <input name="durationAmount" type="number" min={0} step={1} defaultValue={d.amount} className={styles.input} />
      </Field>
      <Field label="Unit">
        <select name="durationUnit" defaultValue={d.unit} className={styles.input}>
          <option value="days">days</option>
          <option value="hours">hours</option>
        </select>
      </Field>
      <Field label="Stock" hint="Blank = unlimited.">
        <input name="stock" type="number" min={1} step={1} defaultValue={item?.stock ?? ""} className={styles.input} />
      </Field>
      <Field label="Available from" hint="Bahrain day, optional.">
        <input name="availableFrom" type="date" defaultValue={dayOf(item?.availableFrom)} className={styles.input} />
      </Field>
      <Field label="Available until" hint="Through the end of that day.">
        <input name="availableUntil" type="date" defaultValue={dayOf(item?.availableUntil)} className={styles.input} />
      </Field>
      <Field label="Sort order" hint="Lower shows first.">
        <input name="sortOrder" type="number" step={1} defaultValue={item?.sortOrder ?? 0} className={styles.input} />
      </Field>
      <label className={styles.check}>
        <input name="enabled" type="checkbox" defaultChecked={item?.enabled ?? true} /> On sale
      </label>
    </div>
  );
}

export default async function AdminShopPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The admin check and everything this tab shows, in one round trip. Prices
  // are money, so this is always read fresh — never from a cache.
  const { data } = await loadAdminPage({
    settings: Prisma.sql`SELECT value FROM "SiteSetting" WHERE key = 'shop'`,
    items: Prisma.sql`
      SELECT i.*,
        (SELECT count(*)::int FROM "Purchase" p
          WHERE p."itemId" = i.id AND p.status IN ('fulfilled', 'used')) AS sold
      FROM "ShopItem" i
      ORDER BY i."sortOrder" ASC, i."createdAt" ASC`,
  });
  const settings = parseShopSettings(data.settings[0]?.value ?? null);
  const items = data.items.map(shopItemFromRow);
  const soldBy = new Map(data.items.map((r) => [String(r.id), Number(r.sold)]));

  return (
    <AdminShell
      title="Shop"
      flash={readFlash(await searchParams)}
    >
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Shop status</h3>
        <form action={saveShopAction} className={`${styles.card} ${settings.open ? "" : styles.cardOff}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>
              <Store size={14} /> The shop is {settings.open ? "open" : "closed"}
            </span>
            <span className={`${styles.pill} ${settings.open ? styles.pillOk : styles.pillBad}`}>
              {settings.open ? "open" : "closed"}
            </span>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.check}>
              <input name="open" type="checkbox" defaultChecked={settings.open} /> Open for
              purchases
            </label>
            <Field label="Note shown while closed" wide>
              <input
                name="note"
                maxLength={300}
                defaultValue={settings.note ?? ""}
                placeholder="Optional — e.g. “Restocking, back this weekend.”"
                className={styles.input}
              />
            </Field>
          </div>
          <div className={styles.formActions}>
            <SubmitButton>Save shop status</SubmitButton>
          </div>
        </form>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>
          Items <span className={styles.count}>({items.length})</span>
        </h3>
        <p className={styles.panelNote}>
          A price change applies to the next purchase. Deleting an item never
          touches past purchases or roles already granted.
        </p>

        <div className={styles.cardList}>
          {items.map((item) => {
            const live = isAvailable(item) && Boolean(item.effect.roleId);
            return (
              <details key={item.id} className={`${styles.card} ${item.enabled ? "" : styles.cardOff}`}>
                <summary className={styles.cardHead}>
                  <span className={styles.cardTitle}>
                    {item.emoji ?? "📦"} {item.name}
                  </span>
                  <span className={styles.cardSub}>
                    <span className="mono">{item.id}</span> · {item.price.toLocaleString()} coins ·{" "}
                    {soldBy.get(item.id) ?? 0} sold
                    {item.stock != null ? ` of ${item.stock}` : ""}
                  </span>
                  <span
                    className={`${styles.pill} ${
                      live ? styles.pillOk : item.enabled ? styles.pillWarn : styles.pillBad
                    }`}
                  >
                    {live
                      ? "on sale"
                      : !item.enabled
                        ? "off"
                        : !item.effect.roleId
                          ? "coming soon"
                          : "outside dates"}
                  </span>
                </summary>
                <form action={saveShopItemAction}>
                  <ItemFields item={item} />
                  <div className={styles.formActions}>
                    <SubmitButton>Save item</SubmitButton>
                  </div>
                </form>
                <form action={deleteShopItemAction} className={styles.formActions}>
                  <input type="hidden" name="id" value={item.id} />
                  <SubmitButton tone="danger" busy="Deleting…" confirm="Delete this item? This can't be undone.">
                    Delete item
                  </SubmitButton>
                </form>
              </details>
            );
          })}

          <details className={styles.card} open={items.length === 0}>
            <summary className={styles.cardHead}>
              <span className={styles.cardTitle}>
                <Plus size={14} /> Add an item
              </span>
            </summary>
            <form action={saveShopItemAction}>
              <ItemFields />
              <div className={styles.formActions}>
                <SubmitButton>Add item</SubmitButton>
              </div>
            </form>
          </details>
        </div>
      </div>
    </AdminShell>
  );
}
