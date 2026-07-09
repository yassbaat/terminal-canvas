import type { LucideIcon } from "lucide-vue-next";

/** What's actually persisted to localStorage for a custom profile -- no
 * component references here, since those can't survive JSON round-tripping. */
export interface StoredLaunchProfile {
  id: string;
  label: string;
  command: string;
}

export interface LaunchProfile {
  id: string;
  label: string;
  /** Shell command typed and submitted once the new terminal's shell is ready. Empty = plain shell, no auto-run. */
  command: string;
  icon: LucideIcon;
  color: string;
  isBuiltIn: boolean;
}
