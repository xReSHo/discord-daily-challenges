import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ArtKey } from "@/lib/art";
import { ArtImage } from "./ArtImage";
import styles from "./PageHero.module.css";

/**
 * The banner at the top of a page: a piece of artwork running the full width
 * of the window and fading into the page, with the page's title set over its
 * dark side.
 *
 * `compact` is the short version used above the games, where the height is
 * better spent on the game itself. `aside` sits opposite the title (below it on
 * a phone). The back link lives here, over the art, rather than in AppFrame.
 * `scene` is something set into the picture itself, behind the words (the
 * dashboard's raid countdown); it is placed by its own styles.
 */
export function PageHero({
  art,
  eyebrow,
  title,
  back,
  aside,
  scene,
  compact = false,
  children,
}: {
  art: ArtKey;
  eyebrow: string;
  title: React.ReactNode;
  back?: { href: string; label: string };
  aside?: React.ReactNode;
  scene?: React.ReactNode;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className={`${styles.hero} ${compact ? styles.compact : ""}`} data-hero="">
      <div className={styles.art} aria-hidden="true">
        <div className={styles.artFade}>
          <div className={styles.artMove}>
            <ArtImage art={art} sizes="(min-width: 1920px) 1920px, 100vw" eager className={styles.img} />
          </div>
          <span className={styles.fog} />
          <span className={styles.shade} />
        </div>
      </div>

      <div className={`container ${styles.inner}`}>
        {scene}
        {back && (
          <Link href={back.href} className={styles.back}>
            <ArrowLeft size={14} />
            {back.label}
          </Link>
        )}

        <div className={styles.row}>
          <div className={`${styles.copy} rise`} data-hero-copy="">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className={styles.title} data-hero-title="">
              {title}
            </h1>
            {children}
          </div>
          {aside && <div className={`${styles.aside} rise`}>{aside}</div>}
        </div>
      </div>

      <div className="container">
        <span className="divider" aria-hidden="true" />
      </div>
    </section>
  );
}
