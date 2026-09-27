import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { MemberAvatar } from './MemberAvatar'
import { memberColor } from '@/lib/memberColor'

describe('MemberAvatar', () => {
  it('shows the first letter of a one-word name, labelled with the name', () => {
    render(<MemberAvatar username="maya" />)
    const avatar = screen.getByRole('img', { name: 'maya' })
    expect(avatar).toHaveTextContent(/^M$/)
  })

  it('shows the initials of the first two words', () => {
    const { rerender } = render(<MemberAvatar username="Sam Lee" />)
    expect(screen.getByRole('img', { name: 'Sam Lee' })).toHaveTextContent(/^SL$/)

    rerender(<MemberAvatar username="jon_smith_jr" />)
    expect(screen.getByRole('img', { name: 'jon_smith_jr' })).toHaveTextContent(/^JS$/)
  })

  it('keeps a name with no letters or digits readable', () => {
    const { rerender } = render(<MemberAvatar username="🎬 ~" />)
    expect(screen.getByRole('img', { name: '🎬 ~' })).toHaveTextContent('🎬')

    rerender(<MemberAvatar username="" />)
    expect(screen.getByRole('img')).toHaveTextContent('?')
  })

  it('fills with the member colour for both modes, keyed on the userId', () => {
    render(<MemberAvatar username="Sam" userId="u_0123456789abcdef" />)
    const avatar = screen.getByRole('img', { name: 'Sam' })
    expect(avatar.style.getPropertyValue('--member-dark')).toBe(memberColor('u_0123456789abcdef', 'dark'))
    expect(avatar.style.getPropertyValue('--member-light')).toBe(memberColor('u_0123456789abcdef', 'light'))
    expect(avatar).toHaveClass('bg-(--member)', 'text-(--member-ink)')
  })

  it('keeps its colour when the member renames themselves', () => {
    const { rerender } = render(<MemberAvatar username="Sam" userId="u_0123456789abcdef" />)
    const before = screen.getByRole('img').style.getPropertyValue('--member-dark')
    rerender(<MemberAvatar username="Samantha" userId="u_0123456789abcdef" />)
    expect(screen.getByRole('img').style.getPropertyValue('--member-dark')).toBe(before)
  })

  it('takes its colour from the name when there is no userId', () => {
    render(<MemberAvatar username="Sam" />)
    expect(screen.getByRole('img').style.getPropertyValue('--member-dark')).toBe(memberColor('Sam', 'dark'))
  })

  it('is 24px by default and 20px for facepiles, where only the first initial fits', () => {
    const { rerender } = render(<MemberAvatar username="Sam Lee" />)
    expect(screen.getByRole('img')).toHaveClass('size-6')
    expect(screen.getByRole('img')).toHaveTextContent(/^SL$/)

    rerender(<MemberAvatar username="Sam Lee" size="sm" />)
    expect(screen.getByRole('img')).toHaveClass('size-5')
    expect(screen.getByRole('img')).toHaveTextContent(/^S$/)
  })

  it('hides from assistive tech when decorative', () => {
    const { container } = render(<MemberAvatar username="Sam" decorative />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const avatar = container.firstChild as HTMLElement
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).not.toHaveAttribute('aria-label')
    expect(avatar).toHaveTextContent('S')
  })
})
