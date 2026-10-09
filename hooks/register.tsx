import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Kind } from '../types'

const PANE = 'session-sidebar'
const TOOL = 'mcp__session-sidebar__note'
// How long a ticked item stays crossed out in place before it folds into Done.
const SETTLE_MS = 1500
const URL_RE = /https?:\/\/[^\s<>"'`\\^{}|]+/gi

const sessionId = atom({ plugin: 'session-sidebar', key: 'sessionId' } as const, '')
const items = atom({ plugin: 'session-sidebar', key: 'items' } as const, [])
const showDone = atom({ plugin: 'session-sidebar', key: 'showDone' } as const, false)
const settling = atom({ plugin: 'session-sidebar', key: 'settling' } as const, [])

type Engine = EngineInterface
type Row = { agentId?: string; message: { content: unknown } }

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)
const tally = (text: string, mark: string): number => text.split(mark).length - 1

/** Drops sentence punctuation off a URL's end; a `)` or `]` stays when the URL opened it (`/wiki/Foo_(bar)`). */
function trimTail(url: string): string {
  for (;;) {
    const last = url.at(-1) ?? ''
    const isLoose =
      last === ')' ? tally(url, ')') > tally(url, '(') : last === ']' ? tally(url, ']') > tally(url, '[') : '.,;:!?*_~'.includes(last)

    if (url === '' || !isLoose) {
      return url
    }

    url = url.slice(0, -1)
  }
}

/** The http(s) links a text mentions, normalized, each once. Injected reminders are not the conversation. */
export function extractUrls(text: string): string[] {
  const found = new Set<string>()
  const said = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')

  for (const [raw] of said.matchAll(URL_RE)) {
    const url = trimTail(raw)

    // `https://host/…` was shortened by its writer and opens nothing.
    if (url.includes('…') || !URL.canParse(url)) {
      continue
    }

    const { hostname, port, href } = new URL(url)

    if (hostname.includes('.') || hostname === 'localhost' || port !== '') {
      found.add(href)
    }
  }

  return [...found]
}

/** Host and path, the query folded: that is where tokens ride. */
const displayOf = (url: string, max: number): string => {
  const { host, pathname, search } = new URL(url)

  return clip(host.replace(/^www\./, '') + pathname.replace(/\/$/, '') + (search === '' ? '' : '?…'), max)
}

async function save($: Engine): Promise<void> {
  const id = await read($, sessionId)

  // ponytail: one store key per session, never pruned; prune by age if $.store's 4 MiB fills.
  if (id !== '') {
    await $.store.set(`session:${id}`, await read($, items))
  }
}

async function add($: Engine, kind: Kind, texts: readonly string[], from: Item['from']): Promise<number> {
  let added = 0

  await update($, items, list => {
    const next = [...list]

    for (const raw of texts) {
      const text = raw.replace(/\p{Cc}/gu, ' ').trim().slice(0, 300)
      const id = kind === 'link' ? `link:${text}` : `${kind}:${crypto.randomUUID()}`

      // A link mentioned again is the same item, even dismissed: a mention never undoes a decision.
      if (text !== '' && !next.some(item => item.id === id)) {
        next.push({ id, kind, text, from })
        added += 1
      }
    }

    return next
  })

  if (added > 0) {
    await save($)
  }

  return added
}

/** Ticks a todo or dismisses a link/note; the item stays crossed out in place for a moment, then folds into Done. */
async function setDone($: Engine, id: string, done: boolean): Promise<void> {
  await update($, items, list => list.map(item => (item.id === id ? { ...item, done } : item)))
  await save($)

  if (done) {
    await update($, settling, ids => [...ids, id])
    $.clock.after(SETTLE_MS, () => void update($, settling, ids => ids.filter(one => one !== id)))
  }
}

async function capture($: Engine, row: Row, from: Item['from']): Promise<void> {
  // A subagent's conversation is its own; what matters of it reaches the main one.
  if (row.agentId !== undefined || !Array.isArray(row.message.content)) {
    return
  }

  const text = row.message.content
    .map(block => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')

  await add($, 'link', extractUrls(text), from)
}

/** Never let a sidebar failure cost the conversation a row or a turn. */
async function quietly($: Engine, what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.log(`could not ${what}: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

const openPane = ($: Engine) => $.ui.open({ id: PANE, title: 'Session' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const id = await $.session.id()
    const saved = await $.store.get(`session:${id}`)

    // A hot reload keeps the host's state: only a different session reloads from the store.
    if ((await read($, sessionId)) !== id) {
      await update($, items, () => (Array.isArray(saved) ? (saved as Item[]) : []))
      await update($, sessionId, () => id)
    }

    await $.command.register({ name: 'sidebar', description: 'Open the session sidebar: links, things to know, action items' })
    await $.tool.register({
      name: 'note',
      isDeferred: false,
      description:
        "Pin short items to the person's session sidebar. kind 'todo': an action item the PERSON must do themselves " +
        "(rotate a key, run a command on their machine, reply to someone); never work you will do. kind 'know': a fact, " +
        'caveat or decision they should keep in mind after this turn scrolls away. One line each, under 100 characters. ' +
        'Use sparingly, only for things that outlive the current turn. Links are collected automatically; do not add them.',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { kind: { type: 'string', enum: ['todo', 'know'] }, text: { type: 'string' } },
              required: ['kind', 'text'],
            },
          },
        },
        required: ['items'],
      },
    })
    void openPane($)

    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const given = (e as unknown as { items?: unknown }).items
    const list = Array.isArray(given) ? (given as { kind?: unknown; text?: unknown }[]) : []
    let added = 0

    for (const kind of ['todo', 'know'] as const) {
      const texts = list.filter(one => one?.kind === kind && typeof one.text === 'string').map(one => one.text as string)
      added += await add($, kind, texts, 'claude')
    }

    return { result: `Added ${added} item${added === 1 ? '' : 's'} to the sidebar.` }
  })

  // What the person typed and what Claude answered. Tool output stays out: one search result would bury the rest.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    await quietly($, 'collect links', () => capture($, e, 'you'))

    return next(e)
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    await quietly($, 'collect links', () => capture($, e, 'claude'))

    return next(e)
  })

  on('command.run', { command: 'sidebar' }, async $ => {
    const opened = await openPane($)

    return { text: opened.isPlaced ? 'Session sidebar opened.' : `Session sidebar is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Button, Link, Text } = kit
    // The mobile app draws no text field: there the add box is left out.
    const Field = 'Input' in kit ? kit.Input : undefined
    const all = await read($, items)
    const fresh = new Set(await read($, settling))
    const isDoneOpen = await read($, showDone)
    const width = Math.max(12, e.props.bodyColumns - 5)
    const run = (what: string, work: () => Promise<unknown>) => () => quietly($, what, work)
    const shown = (kind: Kind) => all.filter(item => item.kind === kind && (!item.done || fresh.has(item.id)))
    const done = all.filter(item => item.done && !fresh.has(item.id))

    // The control leads the row so a narrow dock never pushes it out of reach.
    const row = (item: Item, isInDone: boolean) => {
      const isStruck = item.done === true
      const mark = item.kind === 'todo' ? (isStruck ? ' ☑ ' : ' ☐ ') : isStruck ? ' ↺ ' : ' × '

      return (
        <Box key={`row:${item.id}`} flexDirection="row">
          <Button
            key={`mark:${item.id}`}
            plain
            dimColor={item.kind !== 'todo' && !isInDone}
            label={mark}
            hover={{ color: item.kind === 'todo' ? 'success' : 'error' }}
            onPress={run('update the item', () => setDone($, item.id, !isStruck))}
          />
          {item.kind === 'link' && !isStruck ? (
            <Link href={item.text} label={displayOf(item.text, width)} />
          ) : (
            <Text strikethrough={isStruck} dimColor={isStruck}>
              {item.kind === 'link' ? displayOf(item.text, width) : item.text}
            </Text>
          )}
        </Box>
      )
    }

    const section = (kind: Kind, title: string, color: 'claude' | 'suggestion' | 'warning', empty: string) => {
      const list = shown(kind)

      return (
        <Box key={`section:${kind}`} flexDirection="column" marginBottom={1}>
          <Text bold color={color}>{`${title} (${list.filter(item => !item.done).length})`}</Text>
          {list.length === 0 && <Text dimColor>{empty}</Text>}
          {list.map(item => row(item, false))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {section('todo', 'ACTION ITEMS', 'warning', 'Nothing to do yet.')}
        {Field !== undefined && (
          <Box key="add" marginBottom={1}>
            <Field
              key="add"
              label="+ "
              placeholder="add an action item"
              submitLabel="add"
              onSubmit={value => quietly($, 'add the item', () => add($, 'todo', [value], 'you'))}
            />
          </Box>
        )}
        {section('know', 'THINGS TO KNOW', 'suggestion', 'Claude pins notes here.')}
        {section('link', 'LINKS', 'claude', 'Links from the session land here.')}
        {done.length > 0 && (
          <Box key="done" flexDirection="column">
            <Button
              key="toggle-done"
              plain
              dimColor
              label={`${isDoneOpen ? '▾' : '▸'} Done (${done.length})`}
              onPress={run('toggle Done', () => update($, showDone, open => !open))}
            />
            {isDoneOpen && done.map(item => row(item, true))}
          </Box>
        )}
      </Box>
    )
  })
}
