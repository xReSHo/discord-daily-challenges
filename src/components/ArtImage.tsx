import { ART, artSrc, artSrcSet, type ArtKey } from "@/lib/art";

/**
 * A piece of the site's artwork, as a plain <img> with a set of widths to
 * choose from. Always decorative (empty alt): the words beside it carry the
 * meaning.
 *
 * `sizes` tells the browser how wide the picture is shown, so a phone fetches
 * the small file and a large monitor the large one. `eager` is for the one
 * picture at the top of a page; everything else loads as it nears the screen.
 */
export function ArtImage({
  art,
  sizes,
  eager = false,
  className,
}: {
  art: ArtKey;
  sizes: string;
  eager?: boolean;
  className?: string;
}) {
  const a = ART[art];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artSrc(a)}
      srcSet={artSrcSet(a)}
      sizes={sizes}
      alt=""
      className={className}
      style={{ objectPosition: a.focus }}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      draggable={false}
    />
  );
}
