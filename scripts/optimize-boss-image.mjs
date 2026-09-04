/**
 * One-off: turn the full-res boss art (boss_images/, ~3 MB each) into web-sized
 * assets under public/boss/. Re-run whenever the source art changes.
 *
 *   node scripts/optimize-boss-image.mjs
 *
 * Source files are `boss_images/<Name_With_Underscores>_idle.png`; each becomes
 * `public/boss/<slug>-idle.{webp,png}` where <slug> is the roster key.
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SRC_DIR = path.join(root, "boss_images");
const OUT_DIR = path.join(root, "public", "boss");
const WIDTH = 680;

/** source basename (no ext) -> roster slug */
const IMAGES = {
  Veyrath_The_Hollow_Sovereign_idle: "veyrath-idle",
  Grieveth_the_Drowned_Vow_idle: "grieveth-idle",
  Nyrrek_the_Second_Dusk_idle: "nyrrek-idle",
  The_Silt_Cardinal_idle: "silt-cardinal-idle",
  The_Unraveled_Saint_idle: "unraveled-saint-idle",
};

await mkdir(OUT_DIR, { recursive: true });

for (const [srcName, slug] of Object.entries(IMAGES)) {
  const src = path.join(SRC_DIR, `${srcName}.png`);
  if (!existsSync(src)) {
    console.warn(`skip ${slug}: no source at boss_images/${srcName}.png`);
    continue;
  }

  const base = sharp(src).resize({ width: WIDTH, withoutEnlargement: true });

  await base
    .clone()
    .webp({ quality: 72, effort: 6 })
    .toFile(path.join(OUT_DIR, `${slug}.webp`));

  await base
    .clone()
    .png({ compressionLevel: 9, palette: true, quality: 85 })
    .toFile(path.join(OUT_DIR, `${slug}.png`));

  const meta = await sharp(path.join(OUT_DIR, `${slug}.webp`)).metadata();
  console.log(`wrote public/boss/${slug}.{webp,png}  (${meta.width}x${meta.height})`);
}
