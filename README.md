# Teams requirements agent

A Node process that sits in a signed-in Microsoft Teams web session. It watches one colleague’s chat, asks for the missing pieces of a task, and posts a structured brief into a second chat when the request is complete.

Playwright types into Teams. GPT-4o only chooses what to say.

## What it does

1. Poll the requester’s chat every 60 seconds and read the newest bubble.
2. Treat it as new when its Teams message id has not been handled yet. If Teams gives no id, the full text is the key.
3. Send the text to `gpt-4o` with the conversation so far.
4. Act on one of three contracts from the model:

| Model returns | What gets typed |
| --- | --- |
| Ordinary prose | A short follow-up in the source chat, after a random 3–7 second pause |
| `NEED_TO_CHECK` | A fixed hold sentence. The model’s guess is discarded |
| `TASK_READY` JSON | A brief in the target chat. Memory is then cleared |

Chat replies are lowercased and flattened so they read like a person, not a bot. The task brief keeps its own template and is sent immediately.

On startup, if the newest bubble is already from the requester, it is handled at once. The loop does not walk backward through older messages, and two messages in one poll interval keep only the latest.

## Requirements

- Node.js
- pnpm
- An OpenAI API key
- A Microsoft Teams account that can open both chats in the web client

## Setup

```bash
pnpm install
```

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk-...
SOURCE_USER=Requester Display Name
TARGET_USER=Recipient Display Name
```

`.env` and the local browser profile are gitignored.

## Run

Local Chrome, with a visible window and a persistent profile:

```bash
pnpm teams:local
```

The first launch may need a manual sign-in. The session is stored in `.teams-browser-profile` (override with `TEAMS_USER_DATA_DIR`). If Chrome is missing, Playwright’s Chromium is used instead.

Anchor cloud browser, attached over CDP:

```bash
pnpm teams:anchor
```

Set `ANCHOR_API_KEY`. If `ANCHOR_SESSION_ID` points at a session that is still running, that session is reused. Otherwise a new persistent session is created. Save the printed session id if you want to reconnect later.

Both commands call the same monitor. The decision loop does not know which browser it is driving.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required for local mode. The process exits if it is missing |
| `SOURCE_USER` | `Haseeb Devops` | Display name of the chat to watch |
| `TARGET_USER` | `Natenal FSD` | Display name that receives briefs and status lines |
| `POLL_INTERVAL_MS` | `60000` | Time between reads |
| `REPLY_DELAY_MIN_MS` | `3000` | Shortest pause before a chat reply |
| `REPLY_DELAY_MAX_MS` | `7000` | Longest pause before a chat reply |
| `TEAMS_USER_DATA_DIR` | `.teams-browser-profile` | Local Chrome profile |
| `ANCHOR_API_KEY` | none | Cloud browser API key |
| `ANCHOR_SESSION_ID` | none | Reuse a running cloud session |
| `ANCHOR_PROFILE_ID` | none | Named persistent cloud profile |

Matching is the visible display name in the chat list, not a user id.

## Project layout

| File | Role |
| --- | --- |
| `ms-teams-local.js` | Launches local Chrome and starts the monitor |
| `ms-teams-test.js` | Creates or reuses an Anchor session, connects over CDP, starts the monitor |
| `teams-monitor.js` | Poll loop, Teams selectors, prompt, humanizer, and the brief template |

## Walkthrough

- [docs/presentation.html](docs/presentation.html) — diagrams of the runtime, one message, and the three replies
- [docs/walkthrough.md](docs/walkthrough.md) — notes for presenting the flow, the demo order, and design questions

## Limits

- Only the newest bubble is read.
- Selectors are Teams DOM test ids. A web redesign breaks the poll until those strings are updated.
- Conversation history lives in memory. It clears after a handoff, and a restart starts empty. A trailing requester message is handled again on the next launch.
- There is no test suite. `pnpm test` is the package-init placeholder.
