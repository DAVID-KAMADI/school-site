/**
 * The parts of Anime.js the site uses. Loaded on demand in the browser only (see motion.ts),
 * so the library never reaches the server render or the first download.
 */
export { animate, createTimeline, onScroll, set, stagger } from 'animejs';
export { createDrawable } from 'animejs/svg';
export { splitText } from 'animejs/text';
