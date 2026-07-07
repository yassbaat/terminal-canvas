#!/usr/bin/env node
// node-pty ships a small "spawn-helper" native binary for macOS/Linux inside
// node_modules/node-pty/prebuilds/<platform-arch>/. Some npm registries /
// tarball extraction paths do not preserve the executable bit, which makes
// every terminal spawn on macOS/Linux fail with "posix_spawnp failed" even
// though the file is present. Belt-and-suspenders fix: force +x after every
// install so this can never silently break a user's build.
const fs = require("fs");
const path = require("path");

if (process.platform === "win32") {
  process.exit(0);
}

const prebuildsDir = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
if (!fs.existsSync(prebuildsDir)) {
  process.exit(0);
}

let fixed = 0;
for (const entry of fs.readdirSync(prebuildsDir)) {
  const helperPath = path.join(prebuildsDir, entry, "spawn-helper");
  if (fs.existsSync(helperPath)) {
    fs.chmodSync(helperPath, 0o755);
    fixed++;
  }
}
console.log(`[fix-native-perms] chmod +x applied to ${fixed} node-pty spawn-helper binary(ies)`);
