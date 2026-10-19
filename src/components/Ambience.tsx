"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { allowAmbience, startAmbience } from "@/lib/ambience";

/** Pages with no header, so no sound control in reach: the room stays silent there. */
const SILENT = ["/", "/caught"];

/** Mounted once in the root layout, so the room keeps sounding across pages. */
export function Ambience() {
  const pathname = usePathname();
  useEffect(() => startAmbience(), []);
  useEffect(() => allowAmbience(!SILENT.includes(pathname)), [pathname]);
  return null;
}
