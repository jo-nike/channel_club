/** A switch's hit area grown to 44px tall without moving its layout. */
export const SWITCH_HIT_AREA = 'relative after:absolute after:-inset-x-1 after:-inset-y-2.5'

/** Room above and below a control focused by script, for the sticky header and action bar. */
export const SCROLL_MARGIN = 'scroll-mt-28 scroll-mb-28'

/** A small button: 34px, and 44px on a touch screen. */
export const SMALL_BUTTON = 'h-[34px] px-[11px] text-[13.5px] pointer-coarse:h-11'

/**
 * Two columns side by side, one under the other below a 760px window (the
 * wizard), or in a Server tab narrower than 34rem (its `server` container).
 */
export const TWO_COLUMNS = 'grid-cols-2 max-[760px]:grid-cols-1 @max-[34rem]/server:grid-cols-1'

/** A card's side padding, narrower in a narrow window or Server tab. */
export const CARD_PADDING_X = 'px-5 max-[760px]:px-4 @max-[34rem]/server:px-4'

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
