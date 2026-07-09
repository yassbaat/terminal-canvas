import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { app } from "electron";
import { createLogger } from "../util/logger";

const logger = createLogger("FinderQuickAction");

const SERVICE_NAME = "Open in Terminal Canvas";
const SERVICES_DIR = path.join(os.homedir(), "Library", "Services");
const WORKFLOW_PATH = path.join(SERVICES_DIR, `${SERVICE_NAME}.workflow`);

function ensurePackaged(): void {
  if (!app.isPackaged) {
    throw new Error(
      "Finder integration is only supported in a packaged app. " +
        "Run 'npm run dist:mac' (or 'npm run pack'), install the app, and register from the installed version."
    );
  }
}

/**
 * The .app bundle root, derived from the running executable.
 * process.execPath for a packaged mac app is ".../Terminal Canvas.app/Contents/MacOS/Terminal Canvas".
 */
function getAppBundlePath(): string {
  const exe = process.execPath;
  const marker = ".app" + path.sep;
  const idx = exe.indexOf(marker);
  if (idx === -1) {
    throw new Error(`Could not resolve .app bundle path from executable: ${exe}`);
  }
  return exe.slice(0, idx + ".app".length);
}

const INFO_PLIST = (menuLabel: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${menuLabel}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;

const DOCUMENT_WFLOW = (appBundlePath: string) => {
  // Escape for embedding inside a shell double-quoted string within the
  // Automator action's own string value.
  const escapedAppPath = appBundlePath.replace(/"/g, '\\"');
  const script = `for f in "$@"
do
  open -na "${escapedAppPath}" --args --open-dir="$f"
done
`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>1.0.2</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${script.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>1.0.2</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>272C7C13-1B4A-4C2E-9D2B-000000000001</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>272C7C13-1B4A-4C2E-9D2B-000000000002</string>
				<key>UUID</key>
				<string>272C7C13-1B4A-4C2E-9D2B-000000000003</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<true/>
			</dict>
			<key>isViewVisible</key>
			<true/>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
};

/** Ask Finder/pbs to reload registered Services immediately instead of waiting for the next login. */
function refreshServicesMenu(): void {
  try {
    execFileSync("/System/Library/CoreServices/pbs", ["-flush"], { timeout: 5000 });
  } catch (error) {
    logger.warn("pbs -flush failed (Finder may need a restart to show the new item)", error);
  }
}

/**
 * Install a Finder Quick Action ("Open in Terminal Canvas") that appears when
 * right-clicking a folder. Implemented as an Automator Service (.workflow)
 * rather than a Finder Sync Extension, since the latter requires code
 * signing/notarization and an extension the user must manually enable in
 * System Settings -- a plain Service just works once dropped into
 * ~/Library/Services.
 */
export function registerFinderQuickAction(): void {
  ensurePackaged();
  const appBundlePath = getAppBundlePath();

  if (existsSync(WORKFLOW_PATH)) {
    rmSync(WORKFLOW_PATH, { recursive: true, force: true });
  }
  const contentsDir = path.join(WORKFLOW_PATH, "Contents");
  mkdirSync(contentsDir, { recursive: true });
  writeFileSync(path.join(contentsDir, "Info.plist"), INFO_PLIST(SERVICE_NAME), "utf-8");
  writeFileSync(path.join(contentsDir, "document.wflow"), DOCUMENT_WFLOW(appBundlePath), "utf-8");

  refreshServicesMenu();
  logger.info(`Finder Quick Action installed at ${WORKFLOW_PATH}`);
}

export function unregisterFinderQuickAction(): void {
  if (existsSync(WORKFLOW_PATH)) {
    rmSync(WORKFLOW_PATH, { recursive: true, force: true });
  }
  refreshServicesMenu();
  logger.info("Finder Quick Action removed");
}

export function isFinderQuickActionRegistered(): boolean {
  return existsSync(WORKFLOW_PATH);
}
