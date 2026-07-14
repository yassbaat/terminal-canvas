import { ipcMain } from "electron";
import {
  generateTerminalName,
  generateGroupName,
  getGroqConfig,
  updateGroqConfig,
  summarizeCommand,
} from "../groq/groq-naming-service";
import { terminalManager } from "../terminal/terminal-manager";
import { createLogger } from "../util/logger";
import type { NamingContext, GroupNamingContext } from "@renderer/type/groq";

const logger = createLogger("GroqIPC");

export function registerGroqIPC(): void {
  ipcMain.handle(
    "groq:generateTerminalName",
    async (_, { terminalId, context }) => {
      try {
        logger.debug(`IPC: groq:generateTerminalName ${terminalId}`);
        const result = await generateTerminalName(context as NamingContext);
        return result;
      } catch (error) {
        logger.error(
          `IPC: groq:generateTerminalName failed for ${terminalId}`,
          error
        );
        return {
          name: "Terminal Session",
          reason: "Generation failed",
          confidence: 0,
        };
      }
    }
  );

  ipcMain.handle("groq:renameTerminal", async (_, { terminalId }) => {
    try {
      logger.debug(`IPC: groq:renameTerminal ${terminalId}`);
      const result = await terminalManager.renameTerminal(terminalId);
      return result;
    } catch (error) {
      logger.error(`IPC: groq:renameTerminal failed for ${terminalId}`, error);
      return null;
    }
  });

  ipcMain.handle("groq:getSettings", async () => {
    try {
      const config = getGroqConfig();
      return config;
    } catch (error) {
      logger.error("IPC: groq:getSettings failed", error);
      return null;
    }
  });

  ipcMain.handle("groq:updateSettings", async (_, { settings }) => {
    try {
      updateGroqConfig(settings);
    } catch (error) {
      logger.error("IPC: groq:updateSettings failed", error);
      throw error;
    }
  });

  ipcMain.handle("groq:testConnection", async () => {
    try {
      const config = getGroqConfig();
      if (!config.apiKey) {
        return { success: false, message: "No API key configured" };
      }

      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (response.ok) {
        logger.info("Groq connection test succeeded");
        return { success: true, message: "Connected to Groq successfully" };
      }
      return {
        success: false,
        message: `Groq API returned ${response.status}`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error("Groq connection test failed:", error);
      return { success: false, message: `Connection failed: ${message}` };
    }
  });

  ipcMain.handle("groq:summarizeCommand", async (_, { text }) => {
    try {
      return await summarizeCommand(String(text ?? ""));
    } catch (error) {
      logger.error("IPC: groq:summarizeCommand failed", error);
      // Never reject -- the renderer treats the raw text as its own fallback.
      const t = String(text ?? "").replace(/\s+/g, " ").trim();
      return t.length > 120 ? t.slice(0, 119) + "…" : t;
    }
  });

  ipcMain.handle(
    "groq:generateGroupName",
    async (_, { context }) => {
      try {
        logger.debug("IPC: groq:generateGroupName");
        const result = await generateGroupName(context as GroupNamingContext);
        return result;
      } catch (error) {
        logger.error("IPC: groq:generateGroupName failed", error);
        return {
          name: "Terminal Group",
          reason: "Generation failed",
          confidence: 0,
        };
      }
    }
  );

  logger.info("Groq IPC handlers registered");
}
