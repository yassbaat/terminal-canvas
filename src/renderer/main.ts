import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";

import "@xterm/xterm/css/xterm.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";
import "@vue-flow/node-resizer/dist/style.css";
import "./asset/css/index.css";

// Dropping a URL or a file onto the page would otherwise make Chromium
// navigate away from the app -- and the replacement document still gets the
// full window.api bridge. `will-navigate` in the main process is the real
// block; this is the cheap second layer, and it runs on bubble so the canvas's
// own drop handlers (file detach, tab reorder) still fire first.
//
// Only `drop` is prevented, never `dragover`: a blanket dragover preventDefault
// turns the whole window into a drop target and breaks the deliberate
// selective-preventDefault that FileTabStrip and WorkspaceCanvas rely on for
// correct drop-cursor feedback.
window.addEventListener("drop", (e) => e.preventDefault());

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.mount("#app");
