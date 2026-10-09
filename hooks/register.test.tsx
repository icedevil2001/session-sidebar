import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { extractUrls } from './register'

const PULL = 'https://github.com/acme/app/pull/12'

// Stands in for the engine: one session, a store in memory.
const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-a' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__session-sidebar__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))

  return { clock, store }
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)

// The kit has no bottom for `session.append`; the mod reads the row on its way down, which is what is tested.
const say = ($: Engine, door: 'prompt' | 'response' | 'tool-result', text: string) =>
  $.session
    .append({
      message: { type: door === 'response' ? 'assistant' : 'user', role: door === 'response' ? 'assistant' : 'user', content: [{ type: 'text', text }] },
      door,
      origin: door === 'response' ? { kind: 'model', model: 'test' } : { kind: 'composer' },
      uuid: `row-${Math.random()}`,
    } as never)
    .catch((error: unknown) => {
      if (!String(error).includes('no implementation for session.append')) {
        throw error
      }
    })

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'session-sidebar',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-sidebar',
    props: { title: 'Session', isFocused: true, bodyColumns: 40, placement: 'dock' },
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  } as never) as unknown as Promise<Mounted<'terminal', 'Pane'>>

test('urls: punctuation trimmed, balanced parens kept, prose and ellipses skipped', () => {
  expect(extractUrls(`See (${PULL}). Also https://en.wikipedia.org/wiki/Foo_(bar), http://word, https://a.com/… and http://localhost:5173.`)).toEqual([
    PULL,
    'https://en.wikipedia.org/wiki/Foo_(bar)',
    'http://localhost:5173/',
  ])
})

test('links from prompts and replies land once; tool output stays out', async ($, on) => {
  const { store } = world(on)
  await start($)
  await say($, 'prompt', `look at ${PULL}`)
  await say($, 'response', `the PR ${PULL} again`)
  await say($, 'tool-result', 'noise https://example.com/x')

  expect((store.get('session:session-a') as { text: string }[]).map(item => item.text)).toEqual([PULL])
})

test('a ticked action item is crossed out, then folds into the Done dropdown', async ($, on) => {
  const { clock } = world(on)
  await start($)
  await $.tool.call({ tool: 'mcp__session-sidebar__note', items: [{ kind: 'todo', text: 'Rotate the API key' }, { kind: 'know', text: 'Staging uses the old DB' }] } as never)

  let ui = await pane($)
  const box = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === ' ☐ ')
  expect(box).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Staging uses the old DB' })).toBeDefined()
  await ui.press({ key: box?.key ?? '' })

  // Crossed out in place for a moment.
  expect((await ui.find({ type: 'Text', text: 'Rotate the API key' }))?.props.strikethrough).toBe(true)
  await ui.unmount()

  await clock.advance(2_000)
  ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'Rotate the API key' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle-done' }))?.props.label).toBe('▸ Done (1)')

  await ui.press({ key: 'toggle-done' })
  expect((await ui.find({ type: 'Text', text: 'Rotate the API key' }))?.props.strikethrough).toBe(true)
  await ui.unmount()
})
