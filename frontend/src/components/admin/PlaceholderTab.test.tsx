import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PlaceholderTab } from './PlaceholderTab'

describe('PlaceholderTab', () => {
  it('renders title and message', () => {
    render(<PlaceholderTab title="Test Title" message="Test message" />)

    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('renders optional description when provided', () => {
    render(
      <PlaceholderTab
        title="Test Title"
        message="Test message"
        description="Test description text"
      />
    )

    expect(screen.getByText('Test description text')).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(<PlaceholderTab title="Test Title" message="Test message" />)

    // Only title and message should be rendered
    const container = screen.getByText('Test Title').closest('div')
    expect(container).not.toHaveTextContent('undefined')
  })

  it('renders an icon', () => {
    render(<PlaceholderTab title="Test Title" message="Test message" />)

    // Look for SVG element (icon)
    const icon = document.querySelector('svg')
    expect(icon).toBeInTheDocument()
  })

  it('centers content properly', () => {
    render(<PlaceholderTab title="Test Title" message="Test message" />)

    // The outermost div (wrapper) should have centering classes
    const title = screen.getByText('Test Title')
    // Go up to find the container with flex classes
    const container = title.closest('.flex.flex-col.items-center.justify-center')
    expect(container).toBeInTheDocument()
  })
})
