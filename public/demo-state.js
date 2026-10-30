// Estado de presentación puro: sin texto del modelo, inmuebles ni solicitudes.
export const nearBottom = ({ scrollHeight, clientHeight, scrollTop }, threshold = 64) =>
  scrollHeight - clientHeight - scrollTop <= threshold;

export function createFollowState(initialTop = 0) {
  let following = true, unread = false, lastTop = initialTop;
  return {
    scroll(metrics) {
      if (metrics.scrollTop < lastTop - 1) following = false;
      if (nearBottom(metrics)) following = true;
      lastTop = metrics.scrollTop;
      if (following) unread = false;
    },
    request(force = false) {
      if (force) { following = true; unread = false; }
      return following;
    },
    incoming() { if (!following) unread = true; },
    reset() { following = true; unread = false; lastTop = 0; },
    get following() { return following; },
    get unread() { return unread; },
  };
}
export function carouselPosition({ scrollLeft, clientWidth, scrollWidth }, cardWidth, gap, count) {
  return {
    previousDisabled: scrollLeft <= 2,
    nextDisabled: scrollLeft + clientWidth >= scrollWidth - 2,
    index: Math.min(count - 1, Math.max(0, Math.round(scrollLeft / (cardWidth + gap)))),
  };
}
export function swipeStep(start, end, threshold = 44) {
  const dx = end.x - start.x, dy = end.y - start.y;
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx < 0 ? 1 : -1) : 0;
}
