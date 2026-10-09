# session-sidebar

A [Claude Code mod](https://code.claude.com/docs/en/plugins). Part of my wider collection, [claude-mods](https://github.com/icedevil2001/claude-mods).

A right-hand sidebar for the session with three lists: **Action items**, **Things to know** and **Links**. Tick an action item and it is crossed out, then folds into a collapsed **Done** dropdown, so it is still there but out of the way. Inspired by [samaphp/session-links](https://github.com/samaphp/session-links), which puts links in a band above the prompt; this one moves them to a side panel and adds notes and to-dos.

## Install

```bash
claude plugin marketplace add icedevil2001/session-sidebar
claude plugin install session-sidebar@session-sidebar --scope user
```

Needs a Claude Code build with mods (tested on 2.1.295).

## Use

- The sidebar opens at session start. It docks on the right in the fullscreen terminal layout (110+ columns) and in the desktop app; on the main terminal screen it sits above the prompt. `/sidebar` opens it again after you close it.
- **Links**: every http(s) link you or Claude mention is collected. Tool output is left out. `×` dismisses a link.
- **Things to know / Action items**: Claude adds these with its `note` tool when something should outlive the turn, such as a caveat, or a step only you can do. You can add your own action items in the `+` box.
- `☐` ticks an item. It stays crossed out for a moment, then moves under `▸ Done (n)`. Open the dropdown to see it, and press `☑` / `↺` to bring it back.
- Everything is saved per session and comes back on `--resume`.

## Footprint

- The `note` tool's schema is in Claude's tool list, which costs a few hundred tokens of context. Each call to it is a normal tool call.
- Link collection is local: nothing is fetched and the model never sees the list.

## Limits

- After `/clear` the sidebar keeps the previous session's items until the next start.
- One store entry per session, never pruned (see the `ponytail:` note in `hooks/register.tsx`).
