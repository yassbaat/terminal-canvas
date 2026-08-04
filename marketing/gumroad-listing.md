# Gumroad Listing Kit — Termloom

(Name find-and-replace if you chose differently.)

---

## 0. Before you can list: build the actual product

`release/` currently only contains **v0.1.0** builds — months behind this branch. On `v2.1-files`:

```bash
npm run dist:mac   # → release/Termloom-2.1.0-arm64.dmg + x64 dmg + zips
npm run dist:win   # run on a Windows machine/VM → installer .exe + portable .exe
```

Before that, update `package.json`: `productName` → your chosen name, bump `version` to `2.1.0`. Test the DMG on a machine (or fresh user account) that has never run the dev build.

**Files to upload to Gumroad:**
1. `Termloom-2.1.0-arm64.dmg` (Apple Silicon)
2. `Termloom-2.1.0.dmg` (Intel)
3. `Termloom-Setup-2.1.0.exe` (Windows installer)
4. `INSTALL.pdf` — one page: which file to pick + the Gatekeeper/SmartScreen steps from the FAQ below

---

## 1. Product fields (exact values)

| Field | Value |
|-------|-------|
| **Name** | `Termloom — Infinite Canvas for AI Coding Agents (macOS + Windows)` |
| **URL slug** | `termloom` |
| **Price** | **$19** (see pricing rationale below) |
| **Summary** (short field) | `Run every coding agent on one infinite canvas. Real terminals you can pan, zoom, group, and connect — with a memory of every prompt you typed. macOS + Windows, 100% local.` |
| **Category** | Software Development → Developer Tools |
| **Tags** | `terminal`, `ai coding`, `claude code`, `developer tools`, `productivity`, `macos`, `windows` |
| **Discount code** | `REDDIT` — 25% off, limit 1 week (create before the Reddit post goes live) |

**Pricing rationale:** $19 one-time. Low enough for an impulse buy from a Reddit thread, high enough to signal a real product. Don't do pay-what-you-want (you'll get $0s and it reads as a hobby project). Raise to $29 after launch week — say so in the listing ("launch price"), it creates urgency and gives early buyers a win.

---

## 2. Description (paste into Gumroad's editor)

```
## Tabs don't scale past 3 coding agents.

You're running Claude Code on the refactor, another session on tests, aider on the API, plus a dev server and a test watcher. In tabs, that's five unlabeled black boxes — and no record of what you asked any of them to do.

**Termloom puts every session on one infinite canvas.** Pan and zoom across your whole operation like a Figma file. Every terminal is real — your actual shell, your actual PATH — and every one of them remembers what you typed.

## What you get

**🖥️ Real terminals on an infinite canvas**
Native PTY terminals (zsh, bash, fish / cmd, PowerShell, Git Bash, WSL). Drag, resize, arrange spatially. Not a fake web shell.

**🧠 Agent Memory**
Every prompt and command you submit is captured per terminal — your input, not the noise. Pin the important ones, search your history, double-click to resend. Never again "what did I ask this agent to do?"

**🏷️ Sessions that name themselves**
"Auth refactor agent" instead of "Terminal 3". AI naming via Groq (bring your own free key) or fully-offline rule-based naming. Secrets are redacted before anything leaves your machine.

**📄 Files live next to their terminal**
Browse the repo in a built-in drawer, open files with syntax highlighting, and pull them out as nodes on the canvas — visually linked to the session they came from. Drag a terminal and its files travel with it.

**🗂️ Groups, notes, workspaces**
Frame terminals into project groups, drop sticky notes, save the entire layout — positions, names, prompt history — as local JSON. Reopen tomorrow exactly where you left off.

**🎯 Focus Mode**
One keypress turns the canvas into a distraction-free full-screen stage when it's time to go deep on a single session.

**🔒 Local-first, no strings**
No account. No cloud. No telemetry. Your workspaces are JSON files on your disk.

## Requirements

- macOS 11+ (Apple Silicon & Intel) or Windows 10/11
- Works with any CLI tool or agent: Claude Code, aider, codex, or plain shells

## Launch price

$19 — one-time purchase, all 2.x updates included. Price goes up after launch week.

## FAQ

**Is it code-signed?**
Not yet (indie build — a signing certificate is on the roadmap). One-time approval on first launch:
— macOS: open the app, it will be blocked → System Settings → Privacy & Security → scroll down → "Open Anyway".
— Windows: SmartScreen → "More info" → "Run anyway".

**Does it need an API key?**
No. AI auto-naming is optional (free Groq key); everything else — and offline naming — works with zero setup.

**Do my prompts leave my machine?**
Only if you enable Groq naming, and secrets/keys are redacted first. Otherwise, nothing does.

**Refunds?**
14 days, no questions asked.
```

---

## 3. Images

Gumroad needs a **cover** (1280×720, shows in the gallery — you can add up to 8) and a **thumbnail** (600×600 square, shows in search/library).

### Gallery plan (order matters — first image is the sale)

1. **Cover** — real hero screenshot composited on an AI background with headline text (build below)
2. Screenshot: full canvas (raw, no frame)
3. Screenshot: Agent Memory close-up
4. Screenshot: file nodes + connection lines
5. Screenshot: Focus Mode
6. Feature-grid image (6 icons + one-liners — make in Figma/Canva in 10 min)

### Screenshots to capture (use the same staged workspace as the Reddit video — stage it once, capture everything)

Capture at full Retina resolution, `Cmd+Shift+4 → Space → click window`, then crop to 16:9.

| # | Shot | Staging |
|---|------|---------|
| S1 | **Full canvas, zoomed out** | 6 named terminals, 2 groups, sticky note, 2 file nodes with connection lines, one agent mid-stream. Your hero. |
| S2 | **Agent Memory rail** | Zoom to one terminal + open rail: ~6 realistic prompts, 1 pinned, cursor hovering the resend button. |
| S3 | **Files + connections** | File drawer open, 2 file nodes on canvas, connection lines clearly visible against the background. |
| S4 | **Focus Mode** | Full-screen stage with an active Claude session front and center. |
| S5 | **Groups** | Two collapsed/expanded project frames with clean auto-names. |
| S6 | (spare) **Settings/naming dialog** — for the FAQ section or socials. |

### AI image prompts (exact, for Midjourney / DALL·E / Ideogram)

**P1 — Cover background** (generate 16:9, then composite S1 on top at a slight angle with a drop shadow; add headline text in Figma — AI text will be garbled, always add text yourself):

```
Dark premium background for a developer tool product banner: deep charcoal gradient from #0d1117 to #131a2a, a subtle perspective grid of thin faint lines receding to infinity suggesting an endless canvas, soft cyan glow bottom-left and faint violet glow top-right, extremely minimal, high-end devtool aesthetic, no text, no logos, no objects, 16:9
```

Overlay text on the cover (set in Inter/Geist Bold, white):
- Headline: `Every coding agent. One canvas.`
- Sub: `Termloom — macOS + Windows`

**P2 — Thumbnail 600×600** (app-icon style):

```
Minimal flat app icon on a dark background: a rounded dark square tile containing three small overlapping terminal windows at slightly different offsets, connected by two thin glowing cyan lines, each terminal showing a tiny green prompt chevron, crisp vector style, subtle depth, single cyan accent color on near-black #0d1117, centered composition, no text, square 1:1
```

**P3 — Optional closing gallery image** (abstract product vision):

```
Clean 3D render, floating dark glass terminal windows arranged spatially on an infinite dark canvas viewed at a slight angle, thin glowing connection lines linking them, one window highlighted with warm amber glow among cool cyan ones, soft depth of field, dark #0d1117 environment, premium developer tool aesthetic, cinematic lighting, no text, no people, 16:9
```

**P4 — Feature-grid background** (behind your 6 feature icons):

```
Very subtle dark texture background, near-black #0d1117 with an extremely faint dot grid pattern and one soft radial cyan glow in the center, minimal, flat, suitable as a background for white text overlay, 16:9
```

---

## 4. Receipt / post-purchase message (Gumroad "receipt" field)

```
Thanks for buying Termloom! 🎉

1. Download the file for your machine (arm64 = Apple Silicon M1/M2/M3/M4, x64 = Intel; .exe = Windows).
2. First launch — macOS: if blocked, System Settings → Privacy & Security → "Open Anyway" (one time only). Windows: SmartScreen → More info → Run anyway.
3. Press Ctrl/Cmd+N for your first terminal. Ctrl/Cmd+Shift+P opens the command palette.

All 2.x updates are free — you'll get an email when they drop.
Questions or bugs: reply to this email, I read everything.
```

---

## 5. Launch-day order of operations

1. Buy the domain(s) → set termloom.com to redirect to the Gumroad page (Gumroad supports custom domains too).
2. Build + test v2.1 artifacts on clean machines (both macOS archs + Windows).
3. Create the Gumroad product with everything above; create the `REDDIT` code; test-buy it yourself at 100% off.
4. Record the video + capture the screenshots in one staging session.
5. Post r/ClaudeAI (Tue–Thu morning US), link in first comment.
6. Reuse the x-posts.md sequence on X the same week, now with the link filled in.
