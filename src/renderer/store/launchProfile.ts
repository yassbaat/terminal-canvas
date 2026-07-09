import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { LaunchProfile, StoredLaunchProfile } from "@renderer/type/launchProfile";
import { AGENT_META } from "@renderer/util/agents";
import { generateId } from "@renderer/util/ids";
import { Command, Settings2 } from "lucide-vue-next";

const CUSTOM_PROFILES_KEY = "terminal-canvas:custom-launch-profiles";

const PLAIN_SHELL_PROFILE: LaunchProfile = {
  id: "plain-shell",
  label: "Plain Shell",
  command: "",
  icon: Command,
  color: "#8a8aa0",
  isBuiltIn: true,
};

// Built from the same AGENT_META used for the header badge/canvas accent, so
// a terminal launched from a profile immediately shows the matching badge --
// the auto-typed command is exactly the token detectAgentFromCommand expects.
const BUILT_IN_AGENT_PROFILES: LaunchProfile[] = (
  Object.keys(AGENT_META) as Array<keyof typeof AGENT_META>
).map((id) => ({
  id: `builtin-${id}`,
  label: AGENT_META[id].label,
  command: id,
  icon: AGENT_META[id].icon,
  color: AGENT_META[id].color,
  isBuiltIn: true,
}));

function loadStoredProfiles(): StoredLaunchProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Custom profiles' display fields (icon, color) are derived at read time,
// not persisted -- a Vue component reference can't survive a JSON
// round-trip through localStorage, so only {id, label, command} are stored.
function toDisplayProfile(stored: StoredLaunchProfile): LaunchProfile {
  return {
    ...stored,
    icon: Settings2,
    color: "#8a8aa0",
    isBuiltIn: false,
  };
}

/**
 * Pinia store for launch profiles: the built-in coding-agent CLIs (shared
 * with the header/canvas agent-badge feature) plus user-defined custom
 * commands, both selectable in the New Terminal dialog to auto-run once the
 * shell is ready. Custom profiles are global (not per-workspace) via
 * localStorage, same pattern as theme/sound/idle-threshold in ui.ts.
 */
export const useLaunchProfileStore = defineStore("launchProfile", () => {
  const storedProfiles = ref<StoredLaunchProfile[]>(loadStoredProfiles());

  const builtInProfiles = computed(() => [PLAIN_SHELL_PROFILE, ...BUILT_IN_AGENT_PROFILES]);

  const customProfiles = computed<LaunchProfile[]>(() =>
    storedProfiles.value.map(toDisplayProfile)
  );

  const allProfiles = computed<LaunchProfile[]>(() => [
    ...builtInProfiles.value,
    ...customProfiles.value,
  ]);

  function persist(): void {
    localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(storedProfiles.value));
  }

  function addCustomProfile(label: string, command: string): LaunchProfile {
    const stored: StoredLaunchProfile = { id: generateId("profile"), label, command };
    storedProfiles.value.push(stored);
    persist();
    return toDisplayProfile(stored);
  }

  function updateCustomProfile(id: string, patch: Partial<Pick<StoredLaunchProfile, "label" | "command">>): void {
    const profile = storedProfiles.value.find((p) => p.id === id);
    if (!profile) return;
    Object.assign(profile, patch);
    persist();
  }

  function removeCustomProfile(id: string): void {
    storedProfiles.value = storedProfiles.value.filter((p) => p.id !== id);
    persist();
  }

  function getProfile(id: string): LaunchProfile | null {
    return allProfiles.value.find((p) => p.id === id) || null;
  }

  return {
    customProfiles,
    builtInProfiles,
    allProfiles,
    addCustomProfile,
    updateCustomProfile,
    removeCustomProfile,
    getProfile,
  };
});
