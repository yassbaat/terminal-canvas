import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, computed } from "vue";
import type { LaunchProfile, StoredLaunchProfile } from "@renderer/type/launchProfile";
import { AGENT_META, type KnownAgentId } from "@renderer/util/agents";
import { generateId } from "@renderer/util/ids";
import { Command, Settings2 } from "lucide-vue-next";

const CUSTOM_PROFILES_KEY = "terminal-canvas:custom-launch-profiles";
const LAST_PROFILE_KEY = "terminal-canvas:last-launch-profile";
const LAST_CWD_KEY = "terminal-canvas:last-launch-cwd";

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
  Object.keys(AGENT_META) as KnownAgentId[]
).map((id) => ({
  id: `builtin-${id}`,
  label: AGENT_META[id].label,
  command: id,
  icon: AGENT_META[id].icon,
  color: AGENT_META[id].color,
  isBuiltIn: true,
}));

// The subset offered as one-click chips in the New Terminal dialog. Every
// built-in stays listed in Settings and stays recognized when typed by hand --
// this is only about which handful is worth a chip on the create path.
const FEATURED_PROFILE_IDS = new Set(
  (Object.keys(AGENT_META) as KnownAgentId[])
    .filter((id) => AGENT_META[id].featured)
    .map((id) => `builtin-${id}`)
);

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

  /** What the New Terminal dialog offers: plain shell, the featured providers, and every custom profile. */
  const featuredProfiles = computed<LaunchProfile[]>(() => [
    PLAIN_SHELL_PROFILE,
    ...BUILT_IN_AGENT_PROFILES.filter((p) => FEATURED_PROFILE_IDS.has(p.id)),
    ...customProfiles.value,
  ]);

  // ─── Last New Terminal selection ─────────────────────────────────
  // Creating terminals is repetitive -- the same agent in the same project,
  // over and over -- so the dialog reopens on whatever was used last rather
  // than back at "Plain Shell" with an empty path. Global (not per-workspace)
  // via localStorage, same as the custom profiles above.
  const rememberedProfileId = ref(
    localStorage.getItem(LAST_PROFILE_KEY) ?? PLAIN_SHELL_PROFILE.id
  );
  const lastCwd = ref(localStorage.getItem(LAST_CWD_KEY) ?? "");

  /**
   * Validated at read time rather than pruned on write: the remembered pick can
   * stop existing between two opens of the dialog (a custom profile deleted in
   * Settings, or a provider that has since become Settings-only), and falling
   * back here means the dialog never opens with nothing selected.
   */
  const lastProfileId = computed(() =>
    featuredProfiles.value.some((p) => p.id === rememberedProfileId.value)
      ? rememberedProfileId.value
      : PLAIN_SHELL_PROFILE.id
  );

  /** Called once a terminal is actually created -- cancelling shouldn't stick. */
  function rememberSelection(profileId: string, cwd: string): void {
    rememberedProfileId.value = profileId;
    lastCwd.value = cwd;
    localStorage.setItem(LAST_PROFILE_KEY, profileId);
    localStorage.setItem(LAST_CWD_KEY, cwd);
  }

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
    featuredProfiles,
    lastProfileId,
    lastCwd,
    rememberSelection,
    addCustomProfile,
    updateCustomProfile,
    removeCustomProfile,
    getProfile,
  };
});

// Pinia caches store instances by id, so a hot-swapped store module would
// otherwise leave every component bound to the instance built from the *old*
// code -- newly added state and getters simply wouldn't exist on it, and the
// symptom is a component rendering as if half its data vanished. This patches
// the live instance instead. Dev only: `import.meta.hot` is undefined in a
// production build, so the block drops out.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLaunchProfileStore, import.meta.hot));
}
