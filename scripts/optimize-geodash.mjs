/**
 * One-off: turn the full-res Geometry Dash source art (geometry_images/, ~7 MB)
 * into web-sized assets under public/geodash/. Re-run whenever the source
 * art changes.
 *
 *   node scripts/optimize-geodash.mjs
 *
 * The game canvas loads the .webp directly (drawImage); every current browser
 * supports webp, so there is no .png fallback for these.
 */
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SRC_DIR = path.join(root, "geometry_images");
const OUT_DIR = path.join(root, "public", "geodash");

/** source stem -> { out name, target width, quality } */
const JOBS = {
  bg_far: { out: "bg-far", width: 1280, quality: 66 },
  bg_mid: { out: "bg-mid", width: 1280, quality: 68 },
  ground_texture: { out: "ground", width: 512, quality: 70 },
};

await mkdir(OUT_DIR, { recursive: true });

const present = new Set(
  (await readdir(SRC_DIR).catch(() => [])).map((f) => f.replace(/\.[^.]+$/, "")),
);

let total = 0;
for (const [stem, job] of Object.entries(JOBS)) {
  if (!present.has(stem)) {
    console.warn(`skip ${stem} — not found in geometry_images/`);
    continue;
  }
  const srcFile = (await readdir(SRC_DIR)).find(
    (f) => f.replace(/\.[^.]+$/, "") === stem,
  );
  const dest = path.join(OUT_DIR, `${job.out}.webp`);
  const info = await sharp(path.join(SRC_DIR, srcFile))
    .resize({ width: job.width, withoutEnlargement: true })
    .webp({ quality: job.quality, effort: 6 })
    .toFile(dest);
  total += info.size;
  console.log(
    `wrote public/geodash/${job.out}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`,
  );
}
console.log(`\ntotal public/geodash/  ${(total / 1024).toFixed(0)} KB`);
