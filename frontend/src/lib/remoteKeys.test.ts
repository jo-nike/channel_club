import { describe, it, expect } from 'vitest'
import { getRemoteAction, type RemoteAction } from './remoteKeys'

const press = (key: string, keyCode = 0) => new KeyboardEvent('keydown', { key, keyCode })

describe('getRemoteAction', () => {
  it.each<[string, number, RemoteAction | null]>([
    ['ArrowUp', 38, 'channelUp'],
    ['PageUp', 33, 'channelUp'],
    ['ChannelUp', 0, 'channelUp'],
    ['ArrowDown', 40, 'channelDown'],
    ['PageDown', 34, 'channelDown'],
    ['ChannelDown', 0, 'channelDown'],
    ['Escape', 27, 'back'],
    ['Backspace', 8, 'back'],
    ['GoBack', 0, 'back'],
    ['BrowserBack', 0, 'back'],
    ['Enter', 13, 'ok'],
    ['a', 65, null],
    ['ArrowLeft', 37, null],
    [' ', 32, null],
  ])('maps key %s (keyCode %i) to %s', (key, keyCode, action) => {
    expect(getRemoteAction(press(key, keyCode))).toBe(action)
  })

  it.each<[number, RemoteAction]>([
    [461, 'back'], // webOS Back
    [10009, 'back'], // Tizen Return
    [33, 'channelUp'], // webOS CH+
    [34, 'channelDown'], // webOS CH-
    [38, 'channelUp'],
    [40, 'channelDown'],
    [13, 'ok'],
  ])('maps keyCode %i with an unidentified key to %s', (keyCode, action) => {
    expect(getRemoteAction(press('Unidentified', keyCode))).toBe(action)
  })
})
