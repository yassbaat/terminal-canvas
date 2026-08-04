# Reddit Launch Kit — Termloom

(Name find-and-replace if you chose differently. See naming-domains.md.)

---

## Part 1 — What to record

**Tool:** Screen Studio (worth it — auto-zoom + smooth cursor sells a canvas app) or built-in `Cmd+Shift+5` full-screen recording.
**Format:** landscape 16:9, export 1080p MP4 (H.264), **45–60 seconds**, no voiceover (Reddit autoplays muted). If using Screen Studio, add 2–3 short text captions instead.
**Upload as a native Reddit video post** — never a YouTube link (native video gets ~3–5x the reach).

### Stage the workspace BEFORE recording (15 min)

This is 80% of the result. The demo must look like a real day of work, not an empty app:

- [ ] Run the **v2.1 build** (`npm run dev` on this branch), dark theme, full screen, hide the macOS dock (System Settings → auto-hide) and any personal menu-bar items.
- [ ] Create **6 terminals**:
  - 2 running **real Claude Code sessions mid-task** (start them 5 min early so there's colorful scrollback and a streaming response you can catch live)
  - 1 running a dev server (`npm run dev` on any project — live output)
  - 1 running tests in watch mode
  - 1 running aider/codex (or a third Claude session)
  - 1 plain zsh
- [ ] Let auto-naming give them real names ("Zoy API Dev Server" etc.) — rename any bad ones manually. **No terminal may be called "Terminal 1".**
- [ ] Arrange into **2 groups** (two fake "projects"), one **sticky note** with a real-looking TODO ("agent 2: migrate auth to v2 → then merge"), and **2 file nodes pulled out of a terminal** with their connection lines visible.
- [ ] One terminal with the **Agent Memory rail open**, ~6 prompts in history, 1 pinned.
- [ ] Do a full practice run of the shot list twice, then record.

### Shot list (60s)

| Time | Shot | Action |
|------|------|--------|
| 0–5s | **The money shot.** Fully zoomed-out canvas: 6 named terminals, groups, note, connection lines, one agent visibly streaming. | Hold still 2s, then begin a slow zoom toward the busiest Claude terminal. Caption: *"every coding agent. one canvas."* |
| 5–15s | Live agent | Zoom into the Claude Code terminal while it streams. Click in, type a short real prompt ("now add tests for the retry path"), hit Enter. |
| 15–25s | Agent Memory | Slide over to the memory rail: scroll the prompt history, pin one, **double-click one to resend it**. Caption: *"every prompt you ever typed — pinned, searchable, resendable."* |
| 25–35s | Files + connections | Open the file drawer, drag a file out onto the canvas → connection line draws to its terminal. Then drag the terminal — the whole linked cluster moves together. |
| 35–45s | Organization | Drag a group (everything moves together), collapse it, pass the sticky note. |
| 45–55s | Focus Mode | Trigger Focus Mode → full-screen stage. Flip between 2–3 sessions. Caption: *"focus mode when it's time to go deep."* |
| 55–60s | Zoom back out to the full canvas. End frame: whole board + caption: *"Termloom — macOS · Windows"* | |

**Rules:** slow deliberate cursor, never hover-hunt for a button (that's what the practice runs are for), cut any second where nothing moves.

---

## Part 2 — Where and what to post

Post to **one subreddit per day**, in this order. Same video everywhere; title and body tailored. Reply to every comment in the first 2 hours — that's what the algorithm rewards.

### Day 1 — r/ClaudeAI (primary — this is exactly your buyer)

**Title (pick one):**

1. `I got tired of alt-tabbing between 6 Claude Code sessions, so I built an infinite canvas that runs them all side by side`
2. `Running multiple Claude Code sessions in tabs was killing me, so I built "Figma for terminals"`
3. `I built an infinite canvas where every Claude Code session gets its own terminal — pan, zoom, group, and it remembers every prompt you typed`

**Body (post with the video):**

```
Like a lot of people here, I've ended up running several Claude Code sessions in parallel — one writing tests, one fixing types, one on a refactor. Tabs and split panes fall apart past 3 sessions: everything is an unlabeled black box and I kept losing track of what I asked each agent to do.

So I built Termloom, a desktop app where terminals live on an infinite canvas instead of in tabs:

- **Real terminals** (node-pty + xterm, your actual shell with your actual PATH — not a fake web shell)
- **Agent Memory** — it captures every prompt/command you type (not the output), per terminal. Pin the important ones, search, double-click to resend.
- **Auto-naming** — sessions name themselves from what you're doing ("Auth refactor agent" instead of "Terminal 3"). Secrets are redacted before anything leaves your machine, and it works fully offline with rule-based names.
- **Files on the canvas** — pull a file out of any session and it stays visually linked to the terminal it came from; drag one and the whole cluster moves together.
- **Groups, sticky notes, workspaces** — save the whole layout (local JSON, no account, no cloud) and pick up tomorrow where you left off.
- **Focus Mode** — one keypress turns the canvas into a full-screen stage when you need to go deep on one session.

macOS (Intel + Apple Silicon) and Windows. Everything is local — no telemetry, no login.

Honest caveats: it's an indie build so it isn't code-signed yet (macOS will make you approve it once in Privacy & Security), and prompt capture is heuristic so it occasionally misclassifies.

Happy to answer anything about how it works. Link in the comments.
```

**First comment (post immediately after):**

```
Download: https://termloom.com (or your Gumroad link)

FAQ:
- macOS 11+ (Intel & Apple Silicon) and Windows 10/11
- Works with any CLI agent — Claude Code, aider, codex, or plain shells
- 100% local: workspaces are JSON files on your disk, no account
- Auto-naming uses Groq if you add a key, or offline rules if you don't
- $19 one-time, no subscription. Code REDDIT gets 25% off this week.
```

### Day 2 — r/SideProject

**Title:** `I built "Figma for terminals" — an infinite canvas for running multiple AI coding agents at once`

**Body:** same as above, but replace the first paragraph with:

```
Solo project, Electron + Vue 3 + node-pty. I run multiple AI coding agents daily and tabs stop working past 3 sessions, so I built the workspace I wanted: terminals on an infinite canvas.
```

…and add at the end: `Would love feedback on the landing/pricing — first thing I've ever sold.`

### Day 3 — r/ChatGPTCoding (or r/vibecoding)

**Title:** `Tabs don't scale past 3 coding agents. I built an infinite canvas that does.`
Body: same as Day 1, with "Claude Code sessions" generalized to "coding agents (Claude Code, aider, codex…)".

### Day 4+ — r/macapps, r/commandline (tool-first framing, drop the AI angle)

**r/macapps title:** `Termloom — a native canvas of real terminals: pan, zoom, group, save the layout, per-terminal command history`
**r/commandline title:** `I made an infinite-canvas terminal workspace — real PTYs, spatial layout instead of tabs, per-terminal input history`

⚠️ Read each sub's self-promo rules before posting (r/macapps requires flair; some subs want links only in comments — the templates already do that).

---

## Part 3 — Timing & engagement

- Post **Tue–Thu, 8–10am US Eastern** (builder subs peak mid-morning US).
- Stay online 2 hours after posting; answer every comment, even the critical ones — especially the critical ones.
- Someone will say "just use tmux." Prepared answer:
  ```
  tmux is great — I still use it inside these terminals. This solves a different problem: seeing 6 agent sessions at once spatially, remembering what you asked each one, and files/notes living next to the terminal they belong to. Tabs and panes are for one train of thought; a canvas is for six.
  ```
- Someone will ask "why Electron / why not open source." Decide your answers before posting.
