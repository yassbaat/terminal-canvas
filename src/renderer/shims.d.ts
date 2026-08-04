declare module "@xterm/xterm/css/xterm.css" {}
declare module "@vue-flow/core/dist/style.css" {}
declare module "@vue-flow/controls/dist/style.css" {}
declare module "@vue-flow/minimap/dist/style.css" {}
declare module "./asset/css/index.css" {}
declare module "*.css" {}

/**
 * Vite's HMR handle, used by the `acceptHMRUpdate` block at the bottom of each
 * Pinia store. Declared narrowly on purpose rather than pulling in
 * `vite/client`, whose own ambient `*.css` module declarations would collide
 * with the ones above. `undefined` in a production build, which is what makes
 * those blocks drop out.
 */
interface ImportMeta {
  readonly hot?: {
    accept(callback: (module: unknown) => void): void;
  };
}
