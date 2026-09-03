"use client";

import { Moon, Sun } from "lucide-react";

/**
 * A small disc that flips the site between the dark and light themes.
 *
 * The choice is stamped as `data-theme` on `<html>` (the pre-hydration script
 * in the root layout applies the saved value) and remembered in localStorage.
 * Which glyph shows — sun in light, crescent moon in dark — is decided in CSS
 * from the current `data-theme`, so it's right immediately and never flashes.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode / storage disabled — the switch still works for this page */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`theme-toggle${className ? ` ${className}` : ""}`}
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
    >
      <Sun className="tt-sun" size={15} strokeWidth={2} aria-hidden />
      <Moon className="tt-moon" size={15} strokeWidth={2} aria-hidden />
    </button>
  );
}
