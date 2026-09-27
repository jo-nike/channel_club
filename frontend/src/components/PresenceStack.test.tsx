import { describe, it, expect } from 'vitest'
import { render } from '@/test/utils'
import { PresenceStack } from './PresenceStack'
import type { PresenceEntry } from '@/types'

const person = (displayName: string, userId: string | null = `u_${displayName}`): PresenceEntry => ({
  userId,
  displayName,
  channelId: null,
  channelName: null,
  programme: null,
  view: null,
  since: null,
})

function stackOf(people: PresenceEntry[], max?: number) {
  const { container } = render(<PresenceStack people={people} max={max} />)
  return container.querySelector('[data-slot="presence-stack"]') as HTMLElement
}

describe('PresenceStack', () => {
  it("draws each person's initial at 20px, in order", () => {
    const stack = stackOf([person('maya'), person('dev'), person('sam')])
    const avatars = Array.from(stack.children)
    expect(avatars.map((a) => a.textContent)).toEqual(['M', 'D', 'S'])
    avatars.forEach((avatar) => expect(avatar).toHaveClass('size-5'))
    expect(stack.querySelector('[data-slot="presence-more"]')).toBeNull()
  })

  it("overlaps the discs after the first, each ringed in the surface colour", () => {
    const [first, second] = Array.from(stackOf([person('maya'), person('dev')]).children)
    expect(first).not.toHaveClass('-ml-1.5')
    expect(second).toHaveClass('-ml-1.5')
    expect(second).toHaveClass('ring-2', 'ring-background')
  })

  it("shows four people by default and '+n' for the rest", () => {
    const stack = stackOf(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => person(name)))
    expect(stack.children).toHaveLength(5)
    expect(stack.querySelector('[data-slot="presence-more"]')).toHaveTextContent('+2')
  })

  it('takes a smaller cap where room is short', () => {
    const stack = stackOf([person('maya'), person('dev'), person('sam')], 2)
    expect(Array.from(stack.children).map((a) => a.textContent)).toEqual(['M', 'D', '+1'])
  })

  it('is hidden from assistive tech, since what holds it names the people', () => {
    const stack = stackOf([person('maya')])
    expect(stack).toHaveAttribute('aria-hidden', 'true')
  })

  it('colours a person without an id by their name, and keeps two such people apart', () => {
    const stack = stackOf([person('maya', null), person('maya', null)])
    expect(stack.children).toHaveLength(2)
    expect((stack.children[0] as HTMLElement).style.getPropertyValue('--member-dark')).toBe(
      (stack.children[1] as HTMLElement).style.getPropertyValue('--member-dark')
    )
  })
})
