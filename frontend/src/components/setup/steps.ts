/** The setup wizard's steps, in order. After Review comes On air, which isn't a step. */
export const STEPS = ['welcome', 'account', 'sources', 'access', 'extras', 'review'] as const

export type StepId = (typeof STEPS)[number]

export const STEP_NAMES: Record<StepId | 'done', string> = {
  welcome: 'Welcome',
  account: 'Your account',
  sources: 'Channels',
  access: 'Who can join',
  extras: 'Extras',
  review: 'Review',
  done: 'On air',
}

/** How each step opens (Welcome has its own hero). */
export const STEP_HEADS: Record<Exclude<StepId, 'welcome'>, { title: string; lead: string }> = {
  account: {
    title: 'How will you sign in?',
    lead: "You'll be the club's first admin. Pick the sign-in you'll use yourself; you can turn on the other one under Who can join.",
  },
  sources: {
    title: 'Where do your channels come from?',
    lead: 'Turn on at least one source. Channel Club reads the channel list and the guide from each one you add.',
  },
  access: {
    title: 'Who can join?',
    lead: 'Choose how people sign in and what they can do. You can change these any time in the Admin panel.',
  },
  extras: {
    title: 'Add the extras',
    lead: 'All optional. Switch on what your group will use; the Admin panel can change them later.',
  },
  review: {
    title: 'Ready to open',
    lead: 'Check your choices, then open the club. Everything stays editable in the Admin panel.',
  },
}

export function stepIndex(step: StepId): number {
  return STEPS.indexOf(step)
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value)
}

/** The index of the first step after the claim: step 2 is passed only by claiming. */
export const FIRST_CLAIMED_STEP = stepIndex('sources')
