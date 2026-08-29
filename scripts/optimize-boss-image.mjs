/**
 * One-off: turn the full-res boss art (boss_images/, ~3 MB) into a web-sized
 * asset under public/boss/. Re-run whenever the source art changes.
 *
 *   node scripts/optimize-boss-image.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const SRC = path.resolve(
  root,
  "boss_images",
  "Veyrath_The_Hollow_Sovereign_idle.png",
);
const OUT_DIR = path.join(root, "public", "boss");
const WIDTH = 680;

await mkdir(OUT_DIR, { recursive: true });

const base = sharp(SRC).resize({ width: WIDTH, withoutEnlargement: true });

await base
  .clone()
  .webp({ quality: 72, effort: 6 })
  .toFile(path.join(OUT_DIR, "veyrath-idle.webp"));

await base
  .clone()
  .png({ compressionLevel: 9, palette: true, quality: 85 })
  .toFile(path.join(OUT_DIR, "veyrath-idle.png"));

const meta = await sharp(path.join(OUT_DIR, "veyrath-idle.webp")).metadata();
console.log(
  `wrote public/boss/veyrath-idle.{webp,png}  (${meta.width}x${meta.height})`,
);
