import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";

import "@xterm/xterm/css/xterm.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";
import "@vue-flow/node-resizer/dist/style.css";
import "./asset/css/index.css";

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.mount("#app");
