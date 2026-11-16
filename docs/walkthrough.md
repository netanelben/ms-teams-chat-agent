# Teams requirements agent

Speaker notes for a walkthrough. Open [the briefing](presentation.html) full screen for the diagrams, and keep this page for what to say.

The diagrams use roles, not the default display names: "the requester" and "the person who gets the brief." The defaults live in `SOURCE_USER` and `TARGET_USER`.

## Thirty seconds

This is a Node process that sits inside a signed-in Microsoft Teams web session. A colleague sends a task that is missing details. GPT-4o asks one or two short questions, written like a busy person in chat. When the request is complete, the agent posts a structured brief into a second chat and clears its memory so the next request starts clean.

The model never touches the page. Playwright does.

## What to show first

Three files, one job each.

| File | Job |
| --- | --- |
| `ms-teams-local.js` | Opens a local Chrome profile and calls the monitor |
| `ms-teams-test.js` | Opens an Anchor cloud browser over CDP and calls the same monitor |
| `teams-monitor.js` | Polls Teams, calls the model, and types the reply |

`pnpm teams:local` and `pnpm teams:anchor` are the two commands. Both end in `runTeamsMonitor(page)`.

## Figure 1 — two ways in

Local mode launches Chrome through Playwright's persistent context. The profile directory is `.teams-browser-profile`, unless `TEAMS_USER_DATA_DIR` is set. That folder is gitignored, so the Teams login survives restarts and stays out of the repo. If Chrome is missing, it falls back to Playwright's Chromium. The window is visible on purpose: the first run may need a person to sign in.

Anchor mode asks `api.anchorbrowser.io` for a session. If `ANCHOR_SESSION_ID` is already running, it reuses it. Otherwise it creates a session that opens Teams and persists the named browser profile. Playwright then attaches with `chromium.connectOverCDP`.

After that, the paths are the same. `ensureTeamsLoaded` opens `https://teams.microsoft.com/v2/` only when the chat list is not already on screen. If an email field is visible, it waits up to five minutes for a manual login.

## Figure 2 — one message

Say this while the second diagram is up.

1. The loop wakes every `POLL_INTERVAL_MS`, default 60 seconds, and reads the newest bubble in the requester's chat.
2. A bubble counts as incoming only when its author display name equals `SOURCE_USER`.
3. It is new when `data-mid` differs from the last handled id. If Teams gives no id, the full text is the key.
4. The text is appended to an in-memory thread and sent to `gpt-4o` with the system prompt, temperature 0.7.
5. The code branches on the model's contract, then either types a reply or posts a brief.

Startup uses a simpler rule. If the newest bubble is already from the requester, it is handled immediately, as an unanswered message. If the newest bubble is from the signed-in account, the loop waits. It does not walk backward through older messages.

Two messages landing in the same minute: only the latest is seen. Say that out loud. It is the sharpest limit in the design.

## Figure 3 — the only three replies

The prompt allows three shapes. `processIncomingMessage` trusts those shapes, not free-form judgment.

**Follow-up.** The model returns ordinary prose because something is missing. `humanizeReply` strips code fences and list markers, collapses line breaks, lowercases the text, then restores the people's names. The page waits a random 3–7 seconds (`REPLY_DELAY_MIN_MS` / `REPLY_DELAY_MAX_MS`), clicks the Teams textbox, fills it, and presses Enter.

**Defer.** The model emits a `NEED_TO_CHECK` fence when it would have to guess. The code throws that text away and sends one fixed sentence: "one moment, let me check that and get back to you." Same delay, same textbox. The thread stays open.

**Task ready.** The model emits a `TASK_READY` fence containing JSON: `title`, `description`, `priority`, `details`, `original_request`. The code parses it, opens the target user's chat by display name, and sends the brief. There is no delay and no lowercase pass on that message. History is then wiped, the source chat is opened again, and the message that just completed is marked handled so it cannot fire twice.

If the fence is present but the JSON does not parse, the raw model text falls through the follow-up path.

The brief is assembled in `sendTaskToTarget`. Priority is whatever the model wrote. The prompt asks for high, medium, or low, and the code does not validate the fields beyond `JSON.parse`.

## What the prompt is for

The system prompt is the product spec. Worth reading two rules aloud:

- Ask one or two questions, not a checklist.
- Write like a person in Teams: short, lowercase, no greeting, no sign-off, no bullets, no "happy to help."

The prompt also lists the facts it wants before it may close a task: what to do, context, deadline, affected systems, priority. It is instructed to keep the whole thread in mind. The code enforces that by resending `conversationHistory` on every call.

## Decisions worth defending

**The agent types as the signed-in user.** A Graph bot would be a new identity, with app registration and admin consent, posting into chats as itself. This version joins chats the account can already open. The cost is polling and DOM coupling. The gain is that the reply lands in the existing thread, in that person's voice.

**The transport is replaceable.** `runTeamsMonitor` takes a Playwright `page`. Local Chrome and Anchor are launchers. A later version can swap the page for Graph or a webhook and keep the prompt, the three-way branch, and the brief format.

**The model proposes, the code disposes.** Chat replies are rewritten and delayed. A confident guess is replaced by the hold sentence. The brief is a template, not the raw completion. That split is the part to point at in `evaluateWithLLM`.

**The pause is part of the interface.** Three to seven seconds, then a one-line question, reads as a person glancing at the chat. The brief skips the pause because nobody is waiting on a conversational beat.

**Memory is scoped to one request.** The array lives in the module. It clears only after a successful handoff, together with a fresh baseline on the source chat. A follow-up question still has the earlier turns. A new task does not inherit them.

## Say these limits before they ask

- Latest bubble only. A burst of messages keeps the last one.
- Author match is the visible display name, not a user id. A renamed contact stops the match.
- "Unanswered" means "the newest bubble is theirs." There is no read receipt.
- Selectors are Teams test ids (`chat-pane-item`, `message-author-name`, `chat-pane-message`, `data-mid`, the chat-list item, the textbox). A web redesign breaks the loop until those strings move.
- History is gone on process exit. After a restart, a trailing requester message is handled again.
- Poll errors are caught, typed to the target chat, and the loop continues. A fatal error outside the loop exits the process.
- There is no test suite. `pnpm test` is the npm init placeholder.
- The Anchor CDP URL carries the API key. Keep that process on a trusted machine. Keys and the browser profile are gitignored.

## A demo that works without two laptops

Live path, if both accounts are available:

1. `pnpm teams:local`, with `OPENAI_API_KEY` set. Sign in once if the profile is new.
2. From the requester, send something thin: "please restart the payments worker."
3. Wait for the poll, or point at the startup path if their bubble is already newest.
4. Show the short follow-up. Answer with an environment and a window.
5. Show the brief arriving in the target chat, then the log line that history was reset.

Code path, when a live session with both accounts is not available:

1. `runTeamsMonitor` — startup, then the `while (true)` poll.
2. `getLatestChatMessage` — how a bubble becomes `{ id, text, author }`.
3. `evaluateWithLLM` — the three return types.
4. `humanizeReply` and `sendTaskToTarget` — the two different ways text hits the page.

## Design questions

**Why not the Graph API?** Graph is the right long-term transport if you can register an app and get consent to read that chat. This version ships against the web client the account already uses. The monitor's input is a `page`, so the browser is a boundary, not the whole design.

**How do you stop double replies?** The handled key is the Teams message id, with the full text as a fallback. After a brief is sent, that id is marked before the loop sleeps again.

**What if the model invents an answer?** The prompt must emit `NEED_TO_CHECK` instead of guessing. The code does not send that completion. It sends the fixed hold sentence.

**Why does the reply look unlike the completion?** `humanizeReply` runs only on chat replies. It lowercases, flattens, and strips list markup, then puts names back. The brief keeps the template's capitalization.

**What happens when Teams is slow or the selector misses?** A poll throw is caught. The target chat gets the error text, the source chat is opened again, and the loop continues after five seconds plus the normal interval. Login and first load use long waits: 75 seconds for the chat list, 5 minutes if a sign-in form is up.

**Is this production?** It is a working agent for one pair of chats. It is not a multi-tenant bot. The production version of this idea keeps the prompt contract and replaces the DOM poll with a subscribed message source, durable history, and a real schema check on `TASK_READY`.

## Configuration

| Variable | Used for | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Model calls. Local mode exits if it is missing | none |
| `SOURCE_USER` | Display name to listen to | `Haseeb Devops` |
| `TARGET_USER` | Display name that receives briefs and status lines | `Natenal FSD` |
| `POLL_INTERVAL_MS` | Time between reads | `60000` |
| `REPLY_DELAY_MIN_MS` | Shortest pause before a chat reply | `3000` |
| `REPLY_DELAY_MAX_MS` | Longest pause before a chat reply | `7000` |
| `TEAMS_USER_DATA_DIR` | Local Chrome profile | `.teams-browser-profile` |
| `ANCHOR_API_KEY` | Cloud browser | none |
| `ANCHOR_SESSION_ID` | Reuse a running cloud session | none |
| `ANCHOR_PROFILE_ID` | Named persistent cloud profile | none |

Status lines the target chat can receive: an online notice when the loop starts, and the poll error text if a cycle throws. Both are sent by `notifyMe`, which opens that chat and types.

## Suggested walkthrough

1. Thirty-second version, no slides yet.
2. Figure 1, the seam between launchers and `runTeamsMonitor`.
3. Figure 2, one message, and the latest-bubble limit.
4. Figure 3, and the code that enforces each branch.
5. One limit you would fix next. A good answer: durable history plus a queue of unread messages, still behind the same `page` boundary. Another good answer: validate the task JSON before navigating away from the source chat.
