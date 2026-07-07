# Terminal Canvas

> **Figma for coding terminals.** An infinite-canvas workspace for managing multiple coding-agent terminal sessions on Windows and macOS.

Terminal Canvas lets you open many embedded terminals, pan and zoom around them like a canvas, group them into project frames, and keep a visible memory of every prompt you typed -- so you always remember what you asked each coding agent to do.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Development](#development)
- [Building for Windows & macOS](#building-for-windows--macos)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
  - [PTY Process Lifecycle](#pty-process-lifecycle)
  - [Terminal Input/Output Flow](#terminal-inputoutput-flow)
  - [Prompt Capture (Agent Memory)](#prompt-capture-agent-memory)
  - [Groq Auto-Naming](#groq-auto-naming)
  - [Workspace Persistence](#workspace-persistence)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Security](#security)
- [Groq API Setup](#groq-api-setup)
- [Known Limitations](#known-limitations)
- [What's Next](#whats-next)
- [License](#license)

---

## Features

### Core
- **Multiple Embedded Terminals** -- Create as many terminals as you need (cmd, PowerShell, PowerShell 7, Git Bash, WSL)
- **Infinite Canvas** -- Pan and zoom around your terminals with mouse wheel and drag
- **Drag & Resize** -- Move terminals freely, resize to fit your workflow
- **Terminal Focus** -- Click to focus a terminal, `Esc` to unfocus, `Ctrl+C` works inside
- **Dark Polished UI** -- Professional dark theme designed for long coding sessions

### Agent Memory (Prompt Rail)
- **Captures What You Type** -- Every command and prompt you submit is captured
- **Not Terminal Output** -- Only your input is stored, not what the terminal prints back
- **Pinned Prompts** -- Pin important prompts to keep them at the top
- **Resend** -- Double-click or click resend to run a prompt again
- **Search** -- Search through your prompt history per terminal
- **Copy** -- Copy any prompt to clipboard

### Groups
- **Group Terminals** -- Select multiple terminals and group them into a frame
- **Move Together** -- Dragging a group moves all contained terminals
- **Collapse/Expand** -- Collapse groups to save space

### Groq Auto-Naming
- **AI-Powered Names** -- "Zoy API Dev Server" instead of "Terminal 1"
- **Privacy First** -- Sensitive data is redacted before sending to Groq
- **Fallback Naming** -- Works without an API key using deterministic rules
- **Manual Override** -- Rename manually and auto-naming will respect your choice

### Workspace Persistence
- **Save Layouts** -- Save your canvas layout, terminal positions, names, and agent memory
- **Restore Layouts** -- Pick up where you left off
- **JSON-Based** -- No external database needed

### Shells
**Windows**
- cmd.exe (always available)
- Windows PowerShell
- PowerShell 7 (pwsh)
- Git Bash (auto-detected)
- WSL (auto-detected)

**macOS**
- Your default login shell ($SHELL -- usually zsh), detected first
- zsh, bash, fish, sh -- whichever are installed
- All spawned as login + interactive shells, so PATH from `.zshrc`/`.bash_profile`/Homebrew/nvm etc. is available exactly like a normal terminal window

---

## Architecture

```
Electron Main Process (Node.js)
  |-- TerminalManager (node-pty)
  |-- ShellDetector (Windows + macOS shell discovery)
  |-- PromptCapture (input classification & redaction)
  |-- WorkspaceService (JSON persistence)
  |-- GroqNamingService (AI naming via API)
  |-- IPC Handlers (typed channels)

Electron Preload (secure bridge)
  |-- contextIsolation: true
  |-- nodeIntegration: false
  |-- Exposes: window.api.terminal.*, window.api.prompt.*, window.api.workspace.*, window.api.groq.*

Vue 3 Renderer (Chromium)
  |-- Vue Flow Canvas (infinite pan/zoom)
  |-- TerminalNode (header + xterm + Agent Memory + footer)
  |-- Pinia Stores (terminal, workspace, prompt, ui)
  |-- Toolbar / Sidebar / Inspector / Statusbar
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 28+ |
| Bundler | Vite 5 |
| UI | Vue 3 (Composition API) |
| Language | TypeScript 5.3+ |
| State | Pinia 2 |
| PTY | node-pty 1.1+ |
| Terminal | @xterm/xterm 5.4+ |
| Canvas | @vue-flow/core 1.3+ |
| Persistence | Local JSON |
| AI Naming | Groq API (OpenAI-compatible) |

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+ or **pnpm**
- **Windows 10/11** or **macOS 11+** (Intel or Apple Silicon)
- (Windows, optional) **Git for Windows** -- for Git Bash shell support
- (Windows, optional) **WSL** -- for WSL terminal support
- (Windows, optional) **PowerShell 7** -- for pwsh support
- (Optional) **GROQ_API_KEY** -- for AI auto-naming

---

## Installation

```bash
# Clone or extract the project
cd terminal-canvas

# Install dependencies
npm install

# Install native dependencies (rebuilds node-pty for Electron)
npm run postinstall
```

---

## Development

```bash
# Start in development mode (runs Vite + Electron)
npm run dev

# This will:
# - Start the Vite dev server for the renderer
# - Build and watch the main process
# - Build and watch the preload script
# - Launch Electron
```

The app will open with a default workspace. You can:
- Press `Ctrl+N` to quickly create a new terminal
- Click the `+ New` button in the toolbar
- Use the Command Palette (`Ctrl+Shift+P`) for more options

---

## Building for Windows & macOS

### Windows
```bash
npm run dist:win     # NSIS installer + portable .exe
```
- Installer: `release/Terminal Canvas Setup.exe`
- Portable: `release/win-unpacked/Terminal Canvas.exe`

### macOS
```bash
npm run dist:mac     # .dmg + .zip, both x64 and arm64
```
- Disk image: `release/Terminal Canvas-<version>[-arm64].dmg`
- Zip: `release/Terminal Canvas-<version>[-arm64]-mac.zip`

The app is not code-signed or notarized (no Apple Developer certificate).
Gatekeeper will block a plain double-click on first launch -- **right-click
the app -> Open -> Open** once to approve it, then it launches normally from
then on. This is expected for an indie/unsigned build and only needs doing once.

### Building from scratch
```bash
npm install          # also rebuilds node-pty's native binding for your platform
npm run build
npm run dist:win      # or dist:mac
```

### Notes for macOS packaging
- `node-pty`'s native `spawn-helper` binary must remain executable and must
  **not** be sealed inside `app.asar` (native binaries can't run from there).
  This repo's `build.asarUnpack` config in `package.json` handles that --
  don't remove it, and if you fork/rename the package, keep an
  `asarUnpack` entry matching `node-pty`'s path.
- `scripts/fix-native-perms.cjs` runs on every `npm install` (via
  `postinstall`) to force the executable bit on `spawn-helper`, since some
  npm registries/tarball extraction paths don't preserve it -- without this,
  every terminal on macOS/Linux fails with "posix_spawnp failed".

---

## Project Structure

```
terminal-canvas/
|-- package.json
|-- vite.main.config.ts          # Vite config for main process
|-- vite.preload.config.ts       # Vite config for preload script
|-- vite.renderer.config.ts      # Vite config for renderer
|-- tsconfig.json                # TypeScript configuration
|-- index.html                   # Renderer HTML entry
|-- README.md                    # This file
|-- src/
    |-- main/                    # Electron main process
    |   |-- index.ts             # Main entry point (window creation, IPC registration)
    |   |-- terminal/
    |   |   |-- terminal-manager.ts    # PTY lifecycle (spawn, kill, resize, restart)
    |   |   |-- shell-detector.ts      # Windows + macOS shell detection
    |   |   |-- prompt-capture.ts      # Input classification & privacy redaction
    |   |   |-- terminal-types.ts      # Main-process terminal types
    |   |-- workspace/
    |   |   |-- workspace-service.ts   # Save/load workspace JSON
    |   |   |-- workspace-types.ts     # Workspace file format
    |   |-- groq/
    |   |   |-- groq-naming-service.ts # AI naming via Groq API
    |   |   |-- groq-types.ts          # Groq config types
    |   |-- ipc/
    |   |   |-- index.ts             # IPC registration aggregator
    |   |   |-- terminal-ipc.ts      # Terminal channel handlers
    |   |   |-- workspace-ipc.ts     # Workspace channel handlers
    |   |   |-- groq-ipc.ts          # Groq channel handlers
    |   |-- util/
    |       |-- logger.ts            # Prefix-based logger
    |       |-- ids.ts               # UUID generator
    |       |-- paths.ts             # App data paths
    |
    |-- preload/                   # Secure preload bridge
    |   |-- index.ts               # Preload entry
    |   |-- api.ts                 # Exposed API methods
    |   |-- api-types.ts           # Renderer-facing API types
    |
    |-- renderer/                  # Vue 3 renderer
        |-- main.ts                # Renderer entry point
        |-- App.vue                # Root component (layout shell)
        |-- asset/
        |   |-- css/
        |       |-- variables.css  # CSS custom properties (theme)
        |       |-- index.css      # Global styles, Vue Flow overrides
        |-- component/
        |   |-- app/
        |   |   |-- Toolbar.vue    # Top toolbar
        |   |   |-- Sidebar.vue    # Left sidebar (sessions/workspaces)
        |   |   |-- Inspector.vue  # Right inspector panel
        |   |   |-- Statusbar.vue  # Bottom status bar
        |   |-- canvas/
        |   |   |-- WorkspaceCanvas.vue  # Vue Flow infinite canvas
        |   |   |-- TerminalNode.vue     # Terminal card on canvas
        |   |   |-- GroupNode.vue        # Group container on canvas
        |   |-- terminal/
        |   |   |-- XtermView.vue        # xterm.js terminal component
        |   |   |-- TerminalHeader.vue   # Terminal card header (name, cwd, status)
        |   |   |-- TerminalFooter.vue   # Terminal card footer (status, dims)
        |   |   |-- TerminalMenu.vue     # Terminal dropdown menu
        |   |   |-- PromptRail.vue       # Agent Memory side panel
        |   |   |-- PromptItem.vue       # Individual prompt entry
        |   |-- dialog/
        |       |-- NewTerminalDialog.vue    # Create terminal dialog
        |       |-- CommandPalette.vue       # Quick command palette
        |       |-- GroqSettingsDialog.vue   # Groq API settings
        |-- store/
        |   |-- terminal.ts          # Terminal sessions store
        |   |-- workspace.ts         # Workspace state store
        |   |-- prompt.ts            # Agent Memory store
        |   |-- ui.ts                # UI state store
        |-- type/
        |   |-- terminal.ts          # Terminal types
        |   |-- workspace.ts         # Workspace types
        |   |-- prompt.ts            # Prompt/Agent Memory types
        |   |-- groq.ts              # Groq naming types
        |-- util/
            |-- debounce.ts          # Debounce/throttle utilities
            |-- ids.ts               # ID generator
            |-- path.ts              # Path helpers
            |-- format.ts            # Formatting utilities
```

---

## How It Works

### PTY Process Lifecycle

The Electron **main process** owns all PTY (pseudo-terminal) processes via `node-pty`:

1. **Spawn** -- When you create a terminal, `TerminalManager.spawn()` calls `node-pty.spawn()` with the selected shell path, args, columns, rows, and working directory.
2. **Data Flow** -- PTY `onData` events stream terminal output to the renderer via IPC (`terminal:data`).
3. **Input** -- When you type in xterm.js, keystrokes are sent to the main process via `terminal:write`, which writes to the PTY stdin.
4. **Resize** -- When you resize a terminal node, the new dimensions are forwarded to `pty.resize()`.
5. **Kill** -- When you close a terminal or the app, `pty.kill()` terminates the underlying shell process.
6. **Cleanup** -- On app quit, `TerminalManager.cleanupAll()` kills every remaining PTY process to prevent orphaned shells.

**Important:** The renderer never spawns shell processes directly. All shell execution goes through the typed IPC bridge.

### Terminal Input/Output Flow

```
User types in xterm.js
    |
    v
XtermView.vue: xterm.onData(data)
    |
    v
window.api.terminal.write(terminalId, data)
    |
    v
Preload bridge (secure IPC)
    |
    v
Main: TerminalManager.writeToTerminal(id, data)
    |
    v
node-pty.write(data) --> Shell process stdin
    |
    v
Shell produces output
    |
    v
node-pty.onData(output)
    |
    v
Main: ipcRenderer.send("terminal:data", { terminalId, output })
    |
    v
Preload bridge
    |
    v
Renderer: onData callback --> xterm.write(output)
```

### Prompt Capture (Agent Memory)

The app captures what you type (not what the terminal outputs) to create a visible memory:

1. **Buffer Tracking** -- `TerminalManager` maintains an `inputBuffer` per terminal that accumulates keystrokes.
2. **Enter Detection** -- When you press Enter (`\r` or `\n`), the buffer is flushed and classified.
3. **Classification** -- `prompt-capture.ts` uses heuristics to determine prompt kind:
   - **shell-command** -- Short command-like input (`npm run dev`, `git status`)
   - **agent-prompt** -- Natural language > 8 words or action verbs ("create", "fix", "implement")
   - **multiline** -- Contains newlines (pasted code blocks)
   - **unknown** -- Fallback
4. **Storage** -- The prompt is added to the Agent Memory store via the `prompt:add` IPC channel.
5. **Display** -- `PromptRail.vue` ("Agent Memory") shows all prompts latest-first with pins, search, copy, and resend.
6. **Privacy** -- Sensitive data (API keys, passwords, tokens) is redacted before storage and before any API calls.

### Groq Auto-Naming

Terminal sessions are automatically given meaningful names:

1. **Trigger Conditions** -- After terminal creation + CWD known, after first meaningful command, after 3 prompts, or on manual request.
2. **Context Gathering** -- The main process collects: project name, CWD, shell type, recent prompts (redacted), and output preview.
3. **API Call** -- Sends a structured prompt to Groq's `/chat/completions` endpoint with `response_format: { type: "json_object" }`.
4. **Response** -- Expected JSON: `{ "name": "...", "reason": "...", "confidence": 0.0 }`
5. **Fallback** -- If Groq is unavailable or fails, deterministic rules apply:
   - `npm run dev` --> "{Project} Dev Server"
   - `npm test` --> "{Project} Tests"
   - `docker compose` --> "Docker Compose"
   - `git ...` --> "{Project} Git"
   - WSL shell --> "{Project} WSL"
   - Default --> "{Project} Shell"
6. **Privacy** -- Before sending to Groq, sensitive data is redacted using regex patterns for API keys, tokens, passwords, `.env` lines, private keys, and base64 strings.

### Workspace Persistence

Workspaces are saved as JSON files in `%APPDATA%/Terminal Canvas/workspaces/`:

- **Saved:** Workspace name, viewport position/zoom, terminal nodes (position, size, name, shell, CWD), groups, prompt history, settings
- **Not Saved:** Full terminal output (can be large), secrets, environment variables
- **Restore Modes:**
  - `layout-only` (default) -- Restores positions and names only
  - `start-shells` -- Restores layout + restarts shells
  - `full-restore` -- Restarts shells + reruns saved initial commands (with confirmation)

---

## Keyboard Shortcuts

`Ctrl` below also works as `Cmd` on macOS -- both modifiers are accepted everywhere.

### Global / Canvas
| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New terminal |
| `Ctrl+S` | Save workspace |
| `Ctrl+G` | Group selected terminals |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Plus` / `Ctrl+=` | Zoom in |
| `Ctrl+Minus` | Zoom out |
| `Ctrl+0` | Reset zoom to 100% |
| `Delete` / `Backspace` | Remove selected terminals, notes, or ungroup selected groups (terminals inside a group are kept) |
| `Esc` | Exit terminal focus mode |
| Scroll | Pan canvas |
| `Ctrl + scroll` / pinch | Zoom canvas |
| `Space + drag` or middle-click drag | Pan canvas |

Canvas shortcuts are intentionally disabled while a terminal has keyboard
focus (so `Ctrl+G`, etc. don't get swallowed by your shell) -- click empty
canvas or press `Esc` first.

### Terminal Focused
| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Send to PTY (not copy) |
| `Ctrl+V` | Paste into terminal |
| `Ctrl+L` | Clear terminal (if shell handles it) |
| Canvas shortcuts | Do NOT interrupt terminal typing |

---

## Security

- **contextIsolation: true** -- Renderer cannot access Node.js or Electron internals
- **nodeIntegration: false** -- Node APIs are not available in the renderer
- **Typed Preload Bridge** -- Only explicitly exposed APIs are available via `window.api.*`
- **IPC Payload Validation** -- All IPC handlers validate incoming data
- **No Remote Module** -- Not used
- **No Direct Filesystem Access** -- Renderer cannot read/write files directly
- **Privacy Redaction** -- Sensitive data stripped before external API calls
- **Secure Settings Storage** -- Groq API key handled in main process

---

## Groq API Setup

Terminal Canvas uses the Groq API for AI-powered session naming. To set it up:

1. **Get an API key** from [console.groq.com](https://console.groq.com)
2. **Set as environment variable** (recommended):
   ```bash
   # Windows (cmd)
   set GROQ_API_KEY=gsk_your_key_here

   # macOS / Linux (zsh/bash)
   export GROQ_API_KEY=gsk_your_key_here
   ```
3. **Or set in the app:**
   - Open Terminal Canvas
   - Click the Settings (gear) icon in the toolbar
   - Enter your API key in the Groq Settings dialog
   - Click "Test Connection" to verify
   - Click "Save"

The default model is `llama-3.1-8b-instant` for fast, low-cost naming. You can change it in settings.

**Note:** Auto-naming works without an API key using deterministic fallback rules.

---

## Known Limitations

1. **Not Code-Signed** -- No Apple Developer / Windows code-signing certificate yet, so macOS Gatekeeper and Windows SmartScreen will warn on first launch. See the build sections above for the one-time workaround.
2. **CWD Tracking** -- CWD detection uses heuristics from shell prompts (including the default zsh `~` prompt) rather than OS-level process querying. Very complex/custom prompts may confuse detection.
3. **Prompt Capture** -- Heuristic-based, not 100% accurate. Password mode detection is basic.
4. **Workspace Output** -- Full terminal output is not persisted by design (can be very large). Only prompt history is saved.
5. **WSL Detection** (Windows) -- Requires `wsl.exe` to be in PATH.
6. **Packaging Size** -- Includes Electron and node-pty native modules. First build may take several minutes.
7. **No Multi-Monitor** -- Dragging terminals across monitors is not explicitly supported in the canvas model.
8. **Linux** -- Not officially targeted yet, though the macOS shell-detection path (POSIX shells, login+interactive spawn) is shared code and likely mostly works.

---

## What's Next

### Phase 1 (MVP - Current)
- [x] Multiple embedded terminals
- [x] Infinite canvas with pan/zoom
- [x] Drag and resize terminal nodes
- [x] Terminal focus management
- [x] CWD display
- [x] Agent Memory (Prompt Rail)
- [x] Prompt actions (copy, resend, pin, delete)
- [x] Workspace save/load
- [x] Groups
- [x] Groq auto-naming
- [x] Deterministic fallback naming
- [x] Command palette

### Phase 2 (Next)
- [ ] Command broadcast to multiple terminals
- [ ] Group actions (kill all, restart all, broadcast)
- [ ] Auto-layout terminals inside groups
- [ ] Workspace templates/recipes
- [ ] Session badges (Claude, Codex, Aider, etc.)
- [ ] Export prompt history as Markdown
- [ ] Improved CWD detection (OS-level)
- [ ] Terminal search/find

### Phase 3 (Future)
- [ ] Custom themes
- [ ] Plugin system
- [ ] Remote terminal sessions (SSH)
- [ ] Collaborative workspaces
- [ ] AI-powered command suggestions
- [ ] Terminal recording/replay

---

## License

MIT License. See LICENSE file for details.

---

Built with Electron, Vue 3, node-pty, and xterm.js.
