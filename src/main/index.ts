import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "path";
import { statSync } from "fs";
import { registerAllIPC } from "./ipc";
import { terminalManager } from "./terminal/terminal-manager";
import { loadGroqConfig } from "./groq/groq-naming-service";
import { createLogger } from "./util/logger";

const logger = createLogger("Main");

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingOpenDir: string | null = null;
// Close is intercepted once so the renderer can offer to save the workspace
// first; set when the renderer answers (or can't be asked) to let it through.
let closeConfirmed = false;
// Whether the close came from an app quit (Cmd+Q) rather than the window's
// close button -- decides if we re-issue app.quit() after the confirm.
let quitting = false;

/**
 * Parse command line arguments looking for --open-dir=<path> or directory paths.
 * Validates that the resolved path is actually a directory.
 */
function parseOpenDir(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--open-dir=")) {
      const dir = arg.slice("--open-dir=".length).replace(/^"+|"+$/g, "");
      if (isValidDirectory(dir)) return dir;
    }
    if (arg === "--open-dir") {
      const next = argv[i + 1];
      if (next) {
        const dir = next.replace(/^"+|"+$/g, "");
        if (isValidDirectory(dir)) return dir;
      }
    }
  }
  // Fallback: look for a path-like argument that isn't a flag
  for (const arg of argv) {
    if (!arg.startsWith("-") && (arg.includes(":\\") || arg.includes("/"))) {
      const dir = arg.replace(/^"+|"+$/g, "");
      if (isValidDirectory(dir)) return dir;
    }
  }
  return null;
}

/**
 * Check whether a path exists and is a directory.
 */
function isValidDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Send an open-dir request to the renderer process.
 * Queues the request if the renderer hasn't signaled ready yet.
 */
function sendOpenDir(dir: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (!rendererReady) {
    pendingOpenDir = dir;
    logger.info(`Queued open-dir (renderer not ready yet): ${dir}`);
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
  mainWindow.webContents.send("shell:openDir", dir);
  logger.info(`Sent open-dir to renderer: ${dir}`);
}

/**
 * Install the application menu.
 *
 * Electron's default menu ships Cmd/Ctrl+R (Reload) and Cmd/Ctrl+Shift+R.
 * In this app a reload is destructive: the renderer owns the entire unsaved
 * workspace -- nodes, groups, notes, connections and prompt history -- and
 * there is no re-attach path for PTYs that are already running, so a stray
 * reload silently discards the lot. Those items only exist in dev builds now.
 *
 * On macOS the menu can't simply be removed: the Edit menu's roles are what
 * make Cmd+C/V/X/A work in text fields and in the editor, so the template is
 * always built there and only the View items are gated.
 */
function buildApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const devViewItems: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ];

  if (!isMac) {
    // Windows/Linux: no menu bar at all in a packaged build, but keep the
    // dev tools reachable while developing.
    Menu.setApplicationMenu(
      app.isPackaged
        ? null
        : Menu.buildFromTemplate([{ label: "View", submenu: devViewItems }])
    );
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          ...devViewItems,
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ])
  );
}

/**
 * Create the main application window.
 */
function createWindow(): void {
  // A second window (macOS dock-reopen) starts from a clean slate: leaving
  // closeConfirmed true would skip its save prompt, and leaving rendererReady
  // true would let the close interceptor message a page that hasn't booted.
  closeConfirmed = false;
  rendererReady = false;
  pendingOpenDir = null;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Terminal Canvas",
    backgroundColor: "#1a1a2e",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Register all IPC handlers, binding the window for renderer communication
  registerAllIPC(mainWindow);

  // Load the renderer (Vite dev server in development, built files in production)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Show window once ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Intercept the first close so the renderer can prompt "save workspace?".
  // The renderer answers via app:confirmClose, which sets closeConfirmed and
  // closes again. If the renderer never signaled ready (crashed / still
  // loading), don't trap the user -- let the close through.
  mainWindow.on("close", (e) => {
    if (closeConfirmed || !rendererReady) return;
    e.preventDefault();
    mainWindow?.webContents.send("app:closeRequested");
  });

  // Clean up reference on close
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Single Instance Lock ────────────────────────────────────────────────────

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let gotTheLock = true;
if (!isDev) {
  gotTheLock = app.requestSingleInstanceLock();
}

if (!gotTheLock) {
  logger.info("Another instance is already running, quitting");
  app.quit();
} else if (!isDev) {
  app.on("second-instance", (_event, argv) => {
    logger.debug("Second instance launched", argv);
    const dir = parseOpenDir(argv);
    if (dir) {
      sendOpenDir(dir);
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  logger.info("App ready, creating window");
  loadGroqConfig();
  buildApplicationMenu();
  createWindow();

  // Check if this launch was triggered with a directory argument
  const dir = parseOpenDir(process.argv);
  if (dir) {
    pendingOpenDir = dir;
    logger.info(`Captured open-dir at startup: ${dir}`);
  }

  // Renderer finished (or declined) the save-on-close prompt -- let the
  // close proceed for real this time.
  ipcMain.on("app:confirmClose", () => {
    closeConfirmed = true;
    if (quitting) {
      app.quit();
    } else {
      mainWindow?.close();
    }
  });

  // Renderer chose Cancel in the save prompt -- forget any pending quit so a
  // later window-close isn't misread as one.
  ipcMain.on("app:cancelClose", () => {
    quitting = false;
  });

  // Renderer will send shell:rendererReady when it's fully initialized
  ipcMain.on("shell:rendererReady", () => {
    rendererReady = true;
    logger.info("Renderer signaled ready");
    if (pendingOpenDir) {
      sendOpenDir(pendingOpenDir);
      pendingOpenDir = null;
    }
  });

  // macOS: re-create window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Clean up all PTY processes when all windows are closed
app.on("window-all-closed", () => {
  logger.info("All windows closed, cleaning up terminals");
  terminalManager.cleanupAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Note the quit here, but don't kill PTYs yet: the close handler above may
// still cancel this quit via the renderer's save prompt, and the user's
// terminals must survive a "Cancel".
app.on("before-quit", () => {
  quitting = true;
});

// Extra cleanup guard once the quit is actually going through (ensures PTYs
// are killed).
app.on("will-quit", () => {
  logger.info("App quitting, cleaning up terminals");
  terminalManager.cleanupAll();
});

// Prevent any new window creation from the renderer
app.on("web-contents-created", (_, contents) => {
  contents.setWindowOpenHandler(() => {
    logger.warn("Blocked new-window request from renderer");
    return { action: "deny" };
  });

  // Keep the app pinned to its own document. Without this, dropping a URL onto
  // the canvas (or any stray navigation) replaces the renderer with a remote
  // page that still gets the full window.api bridge -- arbitrary filesystem
  // and shell access for whatever loaded. The renderer is a single page: the
  // only legitimate targets are the dev server and the packaged file://.
  const allowNavigation = (target: string): boolean => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && target.startsWith(devServer)) return true;
    try {
      const url = new URL(target);
      if (url.protocol !== "file:") return false;
      const rendererDir = path.join(__dirname, "../renderer");
      return path.resolve(decodeURIComponent(url.pathname)).startsWith(path.resolve(rendererDir));
    } catch {
      return false;
    }
  };

  const blockNavigation = (event: Electron.Event, target: string): void => {
    if (allowNavigation(target)) return;
    logger.warn(`Blocked navigation to ${target}`);
    event.preventDefault();
  };

  contents.on("will-navigate", blockNavigation);
  contents.on("will-frame-navigate", (event) => blockNavigation(event, event.url));
});
