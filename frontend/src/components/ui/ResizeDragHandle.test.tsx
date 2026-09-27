import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@/test/utils'
import { ResizeDragHandle } from './ResizeDragHandle'

describe('ResizeDragHandle', () => {
  afterEach(cleanup)

  it('keeps its 12px bar for a mouse and adds a 44px hit area on touch without a thicker bar', () => {
    render(
      <ResizeDragHandle
        onPointerDown={vi.fn()}
        onKeyDown={vi.fn()}
        isDragging={false}
        valueNow={50}
        valueMin={30}
        valueMax={75}
      />
    )

    const handle = screen.getByRole('separator', { name: 'Resize guide' })
    expect(handle).toHaveClass('h-3')
    // 20px bar plus 12px of invisible hit area past each edge: 44px
    expect(handle).toHaveClass(
      'relative',
      'pointer-coarse:h-5',
      'pointer-coarse:before:absolute',
      'pointer-coarse:before:inset-x-0',
      'pointer-coarse:before:-inset-y-3'
    )
  })
})
