"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import styles from "./admin.module.css";

export type AdminTab = {
  id: string;
  label: string;
  /** Attention count — a dot/number on the tab when > 0. */
  badge?: number;
  panel: ReactNode;
};

const STORAGE_KEY = "admin_tab";

/**
 * Tabbed log area for /admin. All panels are server-rendered and passed in as
 * `panel` — every tab's markup is in the page, only the active one is shown, so
 * switching is instant and there's no extra request. The last-used tab is
 * remembered so the filter-bar reload lands back where you were.
 */
export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  // Server + first client render both start on tab 0 (no hydration mismatch);
  // the saved tab is restored just after mount.
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (saved && saved !== active && tabs.some((t) => t.id === saved)) {
      // defer out of the effect body — avoids a cascading render warning
      queueMicrotask(() => setActive(saved as string));
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((id: string) => {
    setActive(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className={styles.tabs}>
      <div className={styles.tabBar} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={`${styles.tab} ${t.id === active ? styles.tabOn : ""}`}
            onClick={() => select(t.id)}
          >
            {t.label}
            {t.badge ? <span className={styles.tabBadge}>{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          className={styles.tabPanel}
          hidden={t.id !== active}
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
