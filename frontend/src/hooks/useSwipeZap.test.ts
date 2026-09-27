import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useSwipeZap } from './useSwipeZap'

// A 400px-tall player: the middle band where swipes count runs from 80 to 320
const HEIGHT = 400

const createContainer = () => {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => new DOMRect(0, 0, 844, HEIGHT)
  document.body.appendChild(container)
  return container
}

type PointerType = 'pointerdown' | 'pointerup' | 'pointercancel'

// isPrimary: the first finger down while no other is (a second finger is not)
const pointer = (
  target: Element,
  type: PointerType,
  x: number,
  y: number,
  pointerType = 'touch',
  pointerId = 1,
  isPrimary = true
) => {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType, pointerId, isPrimary, clientX: x, clientY: y })
    )
  })
}

// A finger down at (x, y), lifted dx/dy away
const swipe = (target: Element, x: number, y: number, dx: number, dy: number, pointerType = 'touch') => {
  pointer(target, 'pointerdown', x, y, pointerType)
  pointer(target, 'pointerup', x + dx, y + dy, pointerType)
}

describe('useSwipeZap', () => {
  const added: Element[] = []
  afterEach(() => {
    for (const el of added.splice(0)) el.remove()
  })

  const setup = (enabled = true) => {
    const container = createContainer()
    added.push(container)
    const onStep = vi.fn()
    const view = renderHook(
      ({ enabled }: { enabled: boolean }) => useSwipeZap({ containerRef: { current: container }, enabled, onStep }),
      { initialProps: { enabled } }
    )
    return { container, onStep, ...view }
  }

  it('an 80px swipe up in the middle band steps to the next channel', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 240, 0, -80)

    expect(onStep.mock.calls).toEqual([[1]])
  })

  it('an 80px swipe down in the middle band steps to the previous channel', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 160, 0, 80)

    expect(onStep.mock.calls).toEqual([[-1]])
  })

  it('each swipe steps once, so a run of swipes goes through the zap one by one', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 240, 5, -90)
    swipe(container, 400, 240, -5, -90)
    swipe(container, 400, 160, 0, 100)

    expect(onStep.mock.calls).toEqual([[1], [1], [-1]])
  })

  it('counts from where the finger lands, whatever the element under it', () => {
    const { container, onStep } = setup()
    const picture = container.appendChild(document.createElement('video'))

    swipe(picture, 400, 240, 0, -80)

    expect(onStep).toHaveBeenCalledWith(1)
  })

  it('ignores a swipe that starts in the top 20%, where the notification shade and Control Center are', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 60, 0, 120)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a swipe that starts in the bottom 20%, where the home indicator is', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 340, 0, -120)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('measures the band against the player, not the window', () => {
    const { container, onStep } = setup()
    container.getBoundingClientRect = () => new DOMRect(0, 100, 844, HEIGHT)

    // 150 is in the middle band of a window-top player, but in this one's top 20%
    swipe(container, 400, 150, 0, 100)
    expect(onStep).not.toHaveBeenCalled()

    swipe(container, 400, 300, 0, -80)
    expect(onStep).toHaveBeenCalledWith(1)
  })

  it('ignores a 5px tap, leaving it to show or hide the controls', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 200, 0, 5)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a vertical move of 60px or less', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 200, 0, -60)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a swipe that goes further sideways than up or down', () => {
    const { container, onStep } = setup()

    swipe(container, 300, 200, 120, -80)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a mouse drag', () => {
    const { container, onStep } = setup()

    swipe(container, 400, 240, 0, -80, 'mouse')

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores swipes that start on the controls or in a dialog in the shell', () => {
    const { container, onStep } = setup()
    const bar = container.appendChild(document.createElement('div'))
    bar.className = 'video-controls'
    const dialog = container.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    const inDialog = dialog.appendChild(document.createElement('div'))

    swipe(bar, 400, 240, 0, -80)
    swipe(inDialog, 400, 240, 0, -80)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a gesture cancelled by the browser', () => {
    const { container, onStep } = setup()

    pointer(container, 'pointerdown', 400, 240)
    pointer(container, 'pointercancel', 400, 160)
    pointer(container, 'pointerup', 400, 160)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('ignores a two-finger gesture such as a pinch', () => {
    const { container, onStep } = setup()

    pointer(container, 'pointerdown', 400, 240, 'touch', 1)
    pointer(container, 'pointerdown', 500, 240, 'touch', 2, false)
    pointer(container, 'pointerup', 400, 140, 'touch', 1)
    pointer(container, 'pointerup', 500, 140, 'touch', 2, false)
    expect(onStep).not.toHaveBeenCalled()

    // Once every finger is up, a swipe counts again
    swipe(container, 400, 240, 0, -80)
    expect(onStep).toHaveBeenCalledTimes(1)
  })

  it('still zaps after a lift that never reached the player', () => {
    const { container, onStep } = setup()
    // The tune remounts the engine mid-gesture: the touched <video> leaves
    // the page, and the finger's pointerup fires on the detached node
    const picture = container.appendChild(document.createElement('video'))
    pointer(picture, 'pointerdown', 400, 240, 'touch', 1)
    picture.remove()
    pointer(picture, 'pointerup', 400, 160, 'touch', 1)

    swipe(container, 400, 240, 0, -80)
    swipe(container, 400, 160, 0, 80)

    expect(onStep.mock.calls).toEqual([[1], [-1]])
  })

  it('does nothing while disabled, and stops when turned off', () => {
    const { container, onStep, rerender } = setup(false)

    swipe(container, 400, 240, 0, -80)
    expect(onStep).not.toHaveBeenCalled()

    rerender({ enabled: true })
    swipe(container, 400, 240, 0, -80)
    expect(onStep).toHaveBeenCalledTimes(1)

    rerender({ enabled: false })
    swipe(container, 400, 240, 0, -80)
    expect(onStep).toHaveBeenCalledTimes(1)
  })
})
