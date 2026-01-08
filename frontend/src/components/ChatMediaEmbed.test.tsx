import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { ChatMediaEmbed } from './ChatMediaEmbed'

describe('ChatMediaEmbed', () => {
  describe('Image rendering', () => {
    it('renders img element for gif type', () => {
      render(<ChatMediaEmbed url="https://example.com/funny.gif" type="gif" />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/funny.gif')
    })

    it('renders img element for image type', () => {
      render(<ChatMediaEmbed url="https://example.com/photo.png" type="image" />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/photo.png')
    })

    it('has lazy loading attribute on images', () => {
      render(<ChatMediaEmbed url="https://example.com/image.gif" type="gif" />)
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('loading', 'lazy')
    })

    it('applies max dimension constraints', () => {
      render(<ChatMediaEmbed url="https://example.com/large.gif" type="gif" />)
      const img = screen.getByRole('img')
      expect(img).toHaveClass('max-w-64', 'max-h-48')
    })
  })

  describe('Video rendering', () => {
    it('renders video element for video type', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />)
      // Video elements don't have an accessible role by default, query by tag
      const video = document.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', 'https://example.com/clip.mp4')
    })

    it('has loop attribute on video', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.webm" type="video" />)
      const video = document.querySelector('video')
      expect(video).toHaveAttribute('loop')
    })

    it('has muted attribute on video', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />)
      const video = document.querySelector('video')
      expect(video).toHaveProperty('muted', true)
    })

    it('has autoplay attribute on video', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />)
      const video = document.querySelector('video')
      expect(video).toHaveAttribute('autoplay')
    })

    it('has playsInline attribute on video', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />)
      const video = document.querySelector('video')
      expect(video).toHaveAttribute('playsinline')
    })

    it('applies max dimension constraints to video', () => {
      render(<ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />)
      const video = document.querySelector('video')
      expect(video).toHaveClass('max-w-64', 'max-h-48')
    })
  })

  describe('Error handling', () => {
    it('shows fallback link when image fails to load', () => {
      render(<ChatMediaEmbed url="https://example.com/broken.gif" type="gif" />)
      const img = screen.getByRole('img')

      // Simulate error
      fireEvent.error(img)

      // Should show fallback link
      const fallbackLink = screen.getByText(/media unavailable/i)
      expect(fallbackLink).toBeInTheDocument()
      expect(fallbackLink.closest('a')).toHaveAttribute(
        'href',
        'https://example.com/broken.gif'
      )
    })

    it('shows fallback link when video fails to load', () => {
      render(
        <ChatMediaEmbed url="https://example.com/broken.mp4" type="video" />
      )
      const video = document.querySelector('video')!

      // Simulate error
      fireEvent.error(video)

      // Should show fallback link
      const fallbackLink = screen.getByText(/media unavailable/i)
      expect(fallbackLink).toBeInTheDocument()
    })

    it('fallback link opens in new tab', () => {
      render(<ChatMediaEmbed url="https://example.com/broken.gif" type="gif" />)
      const img = screen.getByRole('img')
      fireEvent.error(img)

      const fallbackLink = screen.getByText(/media unavailable/i).closest('a')
      expect(fallbackLink).toHaveAttribute('target', '_blank')
      expect(fallbackLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Loading state', () => {
    it('shows loading placeholder initially', () => {
      render(<ChatMediaEmbed url="https://example.com/image.gif" type="gif" />)
      // Should have a skeleton/loading state
      const skeleton = document.querySelector('[class*="animate-pulse"]')
      expect(skeleton).toBeInTheDocument()
    })

    it('hides loading placeholder after image loads', () => {
      render(<ChatMediaEmbed url="https://example.com/image.gif" type="gif" />)
      const img = screen.getByRole('img')

      // Simulate load
      fireEvent.load(img)

      // Skeleton should be gone
      const skeleton = document.querySelector('[class*="animate-pulse"]')
      expect(skeleton).not.toBeInTheDocument()
    })

    it('shows loading placeholder for videos initially', () => {
      render(
        <ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />
      )
      const skeleton = document.querySelector('[class*="animate-pulse"]')
      expect(skeleton).toBeInTheDocument()
    })

    it('hides loading placeholder after video loads', () => {
      render(
        <ChatMediaEmbed url="https://example.com/clip.mp4" type="video" />
      )
      const video = document.querySelector('video')!

      // Simulate loaded data event
      fireEvent.loadedData(video)

      const skeleton = document.querySelector('[class*="animate-pulse"]')
      expect(skeleton).not.toBeInTheDocument()
    })
  })
})
