/**
 * Turn the item paintings in assets-incoming/items/ (one object on flat black)
 * into transparent art for the shop:
 *
 *   node scripts/cut-item-art.mjs [name ...]      (no names = every file there)
 *
 * The black is keyed out by brightness, so glows and sparks fade into
 * transparency instead of ending in a hard edge; the colour is then
 * un-multiplied so they keep their strength over the site's dark panels.
 * Each item is trimmed to its content, padded square, and written to
 * public/art/items/<name>-v1-{512,160}.webp, with a transparent PNG copy in
 * assets-incoming/items/cut/.
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const IN = process.env.ITEM_ART_IN ?? "assets-incoming/items";
const OUT = process.env.ITEM_ART_OUT ?? "public/art/items";
const LO = 10; // at or below this brightness: fully transparent
const HI = 58; // at or above: fully opaque

const names = process.argv.slice(2);
const files = readdirSync(IN).filter(
  (f) => /\.(png|jpe?g|webp)$/i.test(f) && (!names.length || names.includes(path.parse(f).name)),
);
mkdirSync(OUT, { recursive: true });

for (const file of files) {
  const name = path.parse(file).name;
  const { data, info } = await sharp(path.join(IN, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const v = Math.max(r, g, b);
    const t = Math.min(1, Math.max(0, (v - LO) / (HI - LO)));
    const a = t * t * (3 - 2 * t);
    // over black, seen = colour × alpha; give the colour back what the key took
    const k = a > 0.02 ? Math.min(4, 1 / a) : 0;
    rgba[o] = Math.min(255, r * k);
    rgba[o + 1] = Math.min(255, g * k);
    rgba[o + 2] = Math.min(255, b * k);
    rgba[o + 3] = Math.round(a * 255);
  }
  const cut = await sharp(rgba, { raw: { width, height, channels: 4 } }).trim({ threshold: 6 }).png().toBuffer();
  const m = await sharp(cut).metadata();
  const side = Math.round(Math.max(m.width, m.height) * 1.12);
  const square = await sharp(cut)
    .extend({
      top: Math.floor((side - m.height) / 2),
      bottom: Math.ceil((side - m.height) / 2),
      left: Math.floor((side - m.width) / 2),
      right: Math.ceil((side - m.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  for (const w of [512, 160]) {
    await sharp(square).resize(w, w).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, `${name}-v1-${w}.webp`));
  }
  // a PNG copy for use outside the site; kept out of public/ so it isn't deployed
  mkdirSync(path.join(IN, "cut"), { recursive: true });
  await sharp(square).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(path.join(IN, "cut", `${name}.png`));
  console.log(name, `${m.width}x${m.height} -> ${OUT}/${name}-v1-{512,160}.webp`);
}
if (!files.length) console.log("nothing to cut in", IN);
