import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { expect, it, vi } from 'vitest'
import { GifPicker } from './GifPicker'
vi.mock('@/services/gifApi', () => ({ fetchTrending: vi.fn().mockResolvedValue({ gifs: [{ id: 'one', title: 'Fixture GIF', url: '/one.gif', previewUrl: '/one.gif' }] }), searchGifs: vi.fn() }))
it('FE-11 keeps GIF selection open on transport rejection and closes on acceptance', async () => {
  const onSelect = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  const onClose = vi.fn()
  render(<GifPicker onSelect={onSelect} onClose={onClose} />)
  const button = await screen.findByRole('button', { name: 'Fixture GIF' })
  fireEvent.click(button)
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})
