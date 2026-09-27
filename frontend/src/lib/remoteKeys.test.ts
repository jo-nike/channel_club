import { describe, it, expect, afterEach } from 'vitest'
import { getRemoteAction, isKeyForFocusedControl, type RemoteAction } from './remoteKeys'

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

describe('isKeyForFocusedControl', () => {
  // A dispatched event keeps its target
  const keydownOn = (target: EventTarget, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  const mount = (html: string) => {
    document.body.innerHTML = html
    return document.querySelector('[data-target]')!
  }

  it('leaves keys on the page body to the TV view', () => {
    expect(isKeyForFocusedControl(keydownOn(document.body))).toBe(false)
  })

  it('leaves keys on a plain button to the TV view', () => {
    expect(isKeyForFocusedControl(keydownOn(mount('<button data-target>Play</button>')))).toBe(false)
  })

  it.each([
    ['an input', '<input data-target />'],
    ['a textarea', '<textarea data-target></textarea>'],
    ['a select', '<select data-target></select>'],
    ['contenteditable', '<div contenteditable="true" data-target></div>'],
    ['a slider', '<div role="slider" data-target></div>'],
    ['a dialog', '<div role="dialog"><button data-target>OK</button></div>'],
    ['a menu', '<div role="menu"><div role="menuitem" data-target>Item</div></div>'],
    ['a listbox', '<div role="listbox"><div role="option" data-target>One</div></div>'],
  ])('keeps keys inside %s for the control', (_label, html) => {
    expect(isKeyForFocusedControl(keydownOn(mount(html)))).toBe(true)
  })

  it.each(['altKey', 'ctrlKey', 'metaKey'] as const)('keeps keys with %s for the browser', (modifier) => {
    expect(isKeyForFocusedControl(keydownOn(document.body, { [modifier]: true }))).toBe(true)
  })
})
