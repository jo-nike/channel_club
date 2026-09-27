import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { ProjectorBeamLoader } from './ProjectorBeamLoader'

// Tailwind's motion-reduce variant compiles to a prefers-reduced-motion media
// query, which jsdom does not evaluate, so these check the classes it keys on.
describe('ProjectorBeamLoader', () => {
  it('is a status region', () => {
    render(<ProjectorBeamLoader />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('stops the beams and the reel under Reduce Motion', () => {
    const { container } = render(<ProjectorBeamLoader />)

    const animated = container.querySelectorAll(
      '.animate-projector-flicker, .animate-projector-flicker-slow, .animate-spin-slow'
    )
    expect(animated).toHaveLength(3)
    // Important: the animate-* rules sit outside Tailwind's layers
    animated.forEach((element) => expect(element).toHaveClass('motion-reduce:animate-none!'))
  })

  it('hides the dust under Reduce Motion', () => {
    const { container } = render(<ProjectorBeamLoader />)

    const particles = container.querySelectorAll('.animate-dust-float')
    expect(particles.length).toBeGreaterThan(0)
    particles.forEach((particle) =>
      expect(particle.closest('.motion-reduce\\:hidden')).not.toBeNull()
    )
  })

  it('without text, has a Loading label that only Reduce Motion shows', () => {
    render(<ProjectorBeamLoader />)

    const label = screen.getByText('Loading...')
    expect(label).toHaveClass('sr-only', 'motion-reduce:not-sr-only')
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
  })

  it('shows the given text instead of the Loading label', () => {
    render(<ProjectorBeamLoader text="Stream starting... (2/5)" />)

    const text = screen.getByText('Stream starting... (2/5)')
    expect(text).not.toHaveClass('sr-only')
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })
})
