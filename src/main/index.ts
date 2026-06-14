import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { statSync } from "fs";
import { registerAllIPC } from "./ipc";
import { terminalManager } from "./terminal/terminal-manager";
import { createLogger } from "./util/logger";

const logger = createLogger("Main");

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingOpenDir: string | null = null;

/**
 * Parse command line arguments looking for --open-dir=<path> or directory paths.
 * Validates that the resolved path is actually a directory.
 */
function parseOpenDir(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--open-dir=")) {
      let dir = arg.slice("--open-dir=".length).replace(/^"+|"+$/g, "");
      dir = path.normalize(dir);
      if (isValidDirectory(dir)) return dir;
    }
    if (arg === "--open-dir") {
      const next = argv[i + 1];
      if (next) {
        let dir = next.replace(/^"+|"+$/g, "");
        dir = path.normalize(dir);
        if (isValidDirectory(dir)) return dir;
      }
    }
  }
  // Fallback: look for a path-like argument that isn't a flag
  for (const arg of argv) {
    if (!arg.startsWith("-") && (arg.includes(":\\") || arg.includes("/"))) {
      let dir = arg.replace(/^"+|"+$/g, "");
      dir = path.normalize(dir);
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
    return statSync(path.normalize(dir)).isDirectory();
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
 * Create the main application window.
 */
function createWindow(): void {
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
  createWindow();

  // Check if this launch was triggered with a directory argument
  const dir = parseOpenDir(process.argv);
  if (dir) {
    pendingOpenDir = dir;
    logger.info(`Captured open-dir at startup: ${dir}`);
  }

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

// Extra cleanup guard for before-quit (ensures PTYs are killed)
app.on("before-quit", () => {
  logger.info("App quitting, cleaning up terminals");
  terminalManager.cleanupAll();
});

// Prevent any new window creation from the renderer
app.on("web-contents-created", (_, contents) => {
  contents.setWindowOpenHandler(() => {
    logger.warn("Blocked new-window request from renderer");
    return { action: "deny" };
  });
});
