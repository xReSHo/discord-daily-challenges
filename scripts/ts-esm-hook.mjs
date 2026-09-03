/**
 * Tiny resolve hook so `node --experimental-strip-types` can run the TS dev
 * scripts here that import project sources with extensionless specifiers
 * (`import ... from "../src/lib/geodash/daily"`). Not used by the app itself.
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-geodash.mts
 */
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/i.test(spec)) {
    for (const ext of [".ts", ".mts", ".tsx", ".js"]) {
      try {
        if (existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL)))) {
          return next(spec + ext, ctx);
        }
      } catch { /* keep trying */ }
    }
  }
  return next(spec, ctx);
}
`),
  import.meta.url,
);
