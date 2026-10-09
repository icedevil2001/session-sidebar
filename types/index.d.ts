/** `link`: a URL the conversation mentioned. `know`: a thing to keep in mind. `todo`: an action item for the person. */
export type Kind = 'link' | 'know' | 'todo'

export type Item = {
  /** `link:<url>` for links, so a second mention is the same item. */
  id: string
  kind: Kind
  /** The URL for a link, the sentence otherwise. */
  text: string
  from: 'you' | 'claude'
  /** Set when ticked off (todo) or dismissed (link, know): the item moves under Done. */
  done?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-sidebar': {
      sessionId: string
      items: Item[]
      /** Whether the Done dropdown is open. */
      showDone: boolean
      /** Ids just ticked off: drawn crossed out in place for a moment before they fold into Done. */
      settling: string[]
    }
  }
}
