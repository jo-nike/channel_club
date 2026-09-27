/**
 * Classes on `el` that would hide, replace or add to the global
 * :focus-visible outline (index.css), or draw on a mouse click: outline-none,
 * focus:/focus-visible: ring and outline utilities, and focus: fills.
 * focus-visible:-outline-offset-2 (an inset outline) and focus-ring-media
 * are allowed.
 */
export function focusOverrides(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => /^outline-(none|hidden)$/.test(c) || /^([\w-]+:)*focus(-visible)?:(ring|outline|bg-)/.test(c),
  )
}
