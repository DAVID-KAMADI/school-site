/**
 * The parts of Anime.js the site uses. Loaded on demand in the browser only (see motion.ts),
 * so the library never reaches the server render or the first download.
 */
export { animate, createDraggable, createTimeline, onScroll, set, spring, stagger } from 'animejs';
export { createDrawable, createMotionPath } from 'animejs/svg';
export { splitText } from 'animejs/text';
