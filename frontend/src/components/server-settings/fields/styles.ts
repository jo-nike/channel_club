/** A switch's hit area grown to 44px tall without moving its layout. */
export const SWITCH_HIT_AREA = 'relative after:absolute after:-inset-x-1 after:-inset-y-2.5'

/** Room above and below a control focused by script, for the sticky header and action bar. */
export const SCROLL_MARGIN = 'scroll-mt-28 scroll-mb-28'

/** A small button: 34px, and 44px on a touch screen. */
export const SMALL_BUTTON = 'h-[34px] px-[11px] text-[13.5px] pointer-coarse:h-11'

/** A text input: 44px, and 16px text so iOS doesn't zoom in. */
export const INPUT = 'h-11 text-base md:text-base'

/** A locked control: read-only, with room for the lock icon. */
export const LOCKED_INPUT = 'bg-muted pr-10 text-muted-foreground'

/** Keeps password managers from offering to save an API key or token. */
export const NOT_A_PASSWORD = {
  autoComplete: 'off',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-bwignore': '',
} as const
