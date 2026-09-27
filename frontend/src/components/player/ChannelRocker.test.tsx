import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ChannelRocker } from './ChannelRocker'

const BUTTON = 'control-button min-h-[48px] min-w-[48px] focus-ring-media'

const renderRocker = (tabIndex = 0) => {
  const onStep = vi.fn()
  render(<ChannelRocker onStep={onStep} tabIndex={tabIndex} buttonClassName={BUTTON} />)
  return { onStep }
}

const up = () => screen.getByRole('button', { name: 'Channel up' })
const down = () => screen.getByRole('button', { name: 'Channel down' })

describe('ChannelRocker', () => {
  it('is one labelled group of channel down and up', () => {
    renderRocker()

    const group = screen.getByRole('group', { name: 'Channel' })
    expect(group).toContainElement(down())
    expect(group).toContainElement(up())
  })

  it('Channel up steps +1 and Channel down -1, one step per press', () => {
    const { onStep } = renderRocker()

    fireEvent.click(up())
    fireEvent.click(up())
    fireEvent.click(down())

    expect(onStep.mock.calls).toEqual([[1], [1], [-1]])
  })

  it.each([
    ['Channel up', 'Channel up (PgUp)', 'PageUp'],
    ['Channel down', 'Channel down (PgDn)', 'PageDown'],
  ])('%s names its key in the tooltip and to assistive technology', async (name, tooltip, key) => {
    renderRocker()
    const button = screen.getByRole('button', { name })

    fireEvent.focus(button)

    expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip)
    expect(button).toHaveAttribute('aria-keyshortcuts', key)
  })

  it("takes the control bar's button look (48px targets)", () => {
    renderRocker()

    for (const button of [up(), down()]) expect(button).toHaveClass('min-h-[48px]', 'min-w-[48px]', 'focus-ring-media')
  })

  it("follows the bar's tab order: out of it while the controls hide", () => {
    renderRocker(-1)

    expect(up()).toHaveAttribute('tabindex', '-1')
    expect(down()).toHaveAttribute('tabindex', '-1')
  })
})
