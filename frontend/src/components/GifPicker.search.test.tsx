import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { GifPicker } from './GifPicker'
import { searchGifs } from '@/services/gifApi'

vi.mock('@/services/gifApi', () => ({
  fetchTrending: vi.fn().mockResolvedValue({ gifs: [] }),
  searchGifs: vi.fn().mockResolvedValue({ gifs: [] }),
}))

beforeEach(() => {
  vi.mocked(searchGifs).mockClear()
})

it('searches without the outer spaces and never for a blank query', async () => {
  render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />)
  const input = screen.getByPlaceholderText('Search GIFs...')

  fireEvent.change(input, { target: { value: '   ' } })
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(searchGifs).not.toHaveBeenCalled()

  fireEvent.change(input, { target: { value: '  cats ' } })
  await waitFor(() => expect(searchGifs).toHaveBeenCalledWith('cats', 0, 25))
})

it("caps the query at Giphy's 50 characters", () => {
  render(<GifPicker onSelect={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByPlaceholderText('Search GIFs...')).toHaveAttribute('maxLength', '50')
})
