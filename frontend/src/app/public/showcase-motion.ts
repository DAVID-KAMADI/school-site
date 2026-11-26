import { splashCovering, splashLeaves, type loadAnime } from '../shared/motion';

export type Anime = Awaited<ReturnType<typeof loadAnime>>;
/** SVG lines Anime.js can draw (createDrawable). */
export type Drawable = ReturnType<Anime['createDrawable']>;

/**
 * Stages one entrance on the Gallery and Our people pages, with the same rules as the rest of the site:
 * - below the fold: plays when scrolled to;
 * - on the first screen under the welcome screen: plays as it lifts;
 * - on the first screen after moving here from another page: plays straight away;
 * - on the first screen of a page the server already painted: left still, so nothing flickers.
 * `prepare` moves things to their starting positions and `play` runs the entrance.
 * Returns a cleanup for when the page is left.
 */
export function stage(
  anime: Anime,
  el: HTMLElement,
  fromServer: boolean,
  prepare: () => void,
  play: () => void,
): () => void {
  const belowFold = el.getBoundingClientRect().top > window.innerHeight * 0.9;
  const covered = splashCovering();
  if (!belowFold && fromServer && !covered) return () => {};
  prepare();
  if (belowFold) {
    const observer = anime.onScroll({ target: el, enter: 'bottom-=8% top', onEnter: () => play() });
    return () => observer.revert();
  }
  let gone = false;
  if (covered) void splashLeaves().then(() => !gone && setTimeout(play, 150));
  else play();
  return () => (gone = true);
}

/** Removes the inline styles an entrance leaves behind, so hover effects in the stylesheet work again. */
export function clearStyles(targets: Element[], props = ['opacity', 'transform']) {
  for (const el of targets as HTMLElement[]) {
    props.forEach((p) => el.style.removeProperty(p));
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
}
