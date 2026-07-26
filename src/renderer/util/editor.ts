import { EditorView } from "@codemirror/view";
import { tags as t, tagHighlighter } from "@lezer/highlight";
import type { LanguageSupport } from "@codemirror/language";

/**
 * CodeMirror 6 wiring shared by every code surface in the app.
 *
 * Why CodeMirror and not Monaco: file tabs live inside canvas nodes, and the
 * canvas applies a CSS `transform: scale()`. xterm already needed a pointer
 * -coordinate fixup to survive that (see XtermView's correctPointerEventForZoom);
 * CodeMirror derives its own scaleX/scaleY from the container rect and handles
 * it natively, while Monaco is well known to misplace the caret under a scaled
 * ancestor. Monaco would also need a CSP amendment -- its worker bootstrap uses
 * blob: URLs and index.html is `default-src 'self'` -- where CodeMirror needs no
 * workers, no blob:, no wasm and no eval, so the existing CSP covers it as-is.
 */

/**
 * Token colors are applied as classes rather than a HighlightStyle so the exact
 * same class names can be reused by any non-editor code surface, and so the
 * colors stay in CSS (variables.css `--tc-syn-*`) where the rest of the app's
 * theming lives instead of being frozen into a JS object.
 */
export const cateHighlighter = tagHighlighter([
  { tag: t.comment, class: "tok-comment" },
  { tag: t.lineComment, class: "tok-comment" },
  { tag: t.blockComment, class: "tok-comment" },
  { tag: t.docComment, class: "tok-comment" },

  { tag: t.keyword, class: "tok-keyword" },
  { tag: t.controlKeyword, class: "tok-keyword" },
  { tag: t.moduleKeyword, class: "tok-keyword" },
  { tag: t.operatorKeyword, class: "tok-keyword" },
  { tag: t.definitionKeyword, class: "tok-keyword" },
  { tag: t.modifier, class: "tok-keyword" },
  { tag: t.self, class: "tok-keyword" },

  { tag: t.string, class: "tok-string" },
  { tag: t.special(t.string), class: "tok-string" },
  { tag: t.regexp, class: "tok-string" },
  { tag: t.escape, class: "tok-constant" },

  { tag: t.number, class: "tok-number" },
  { tag: t.bool, class: "tok-constant" },
  { tag: t.null, class: "tok-constant" },
  { tag: t.atom, class: "tok-constant" },
  { tag: t.constant(t.variableName), class: "tok-constant" },

  { tag: t.function(t.variableName), class: "tok-function" },
  { tag: t.function(t.propertyName), class: "tok-function" },
  { tag: t.definition(t.function(t.variableName)), class: "tok-function" },
  { tag: t.macroName, class: "tok-function" },

  { tag: t.variableName, class: "tok-variable" },
  { tag: t.definition(t.variableName), class: "tok-variable" },
  { tag: t.propertyName, class: "tok-property" },
  { tag: t.definition(t.propertyName), class: "tok-property" },

  { tag: t.typeName, class: "tok-type" },
  { tag: t.className, class: "tok-type" },
  { tag: t.namespace, class: "tok-type" },
  { tag: t.annotation, class: "tok-type" },

  { tag: t.operator, class: "tok-operator" },
  { tag: t.punctuation, class: "tok-punctuation" },
  { tag: t.bracket, class: "tok-punctuation" },
  { tag: t.separator, class: "tok-punctuation" },

  { tag: t.tagName, class: "tok-tag" },
  { tag: t.attributeName, class: "tok-attribute" },
  { tag: t.attributeValue, class: "tok-string" },

  { tag: t.heading, class: "tok-heading" },
  { tag: t.link, class: "tok-link" },
  { tag: t.url, class: "tok-link" },
  { tag: t.emphasis, class: "tok-emphasis" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.strikethrough, class: "tok-strikethrough" },

  { tag: t.invalid, class: "tok-invalid" },
]);

/**
 * All colors go through CSS custom properties so the editor follows the app's
 * `data-theme` switch without any JS re-theming on toggle.
 */
export const cateEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--tc-editor-font-size, 12px)",
    backgroundColor: "var(--tc-editor-bg)",
    color: "var(--tc-editor-fg)",
  },
  ".cm-scroller": {
    fontFamily: "var(--tc-font-mono)",
    lineHeight: "1.5",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "var(--tc-editor-cursor)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tc-editor-cursor)" },
  "&.cm-focused .cm-cursor": { borderLeftWidth: "2px" },
  ".cm-gutters": {
    backgroundColor: "var(--tc-editor-bg)",
    color: "var(--tc-editor-gutter-fg)",
    border: "none",
    borderRight: "1px solid var(--tc-border-color)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--tc-editor-gutter-active-fg)",
  },
  ".cm-activeLine": { backgroundColor: "var(--tc-editor-active-line)" },
  // CodeMirror renders selection through .cm-selectionBackground when the view
  // owns selection drawing, and through ::selection otherwise -- set both.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--tc-editor-selection)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--tc-editor-match)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--tc-editor-match)",
    outline: "1px solid var(--tc-success)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--tc-accent-soft)" },
  ".cm-panels": {
    backgroundColor: "var(--tc-bg-header)",
    color: "var(--tc-text-primary)",
    borderColor: "var(--tc-border-color)",
  },
  ".cm-panels input, .cm-panels button": {
    backgroundColor: "var(--tc-bg-card)",
    color: "var(--tc-text-primary)",
    border: "1px solid var(--tc-border-color)",
    borderRadius: "var(--tc-border-radius-sm)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--tc-bg-card)",
    color: "var(--tc-text-primary)",
    border: "1px solid var(--tc-border-color)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--tc-bg-hover)",
    color: "var(--tc-text-secondary)",
    border: "none",
  },
});

/**
 * Extension -> grammar loader. Every entry is a dynamic import so the initial
 * renderer bundle doesn't carry a dozen parsers; a grammar is fetched the first
 * time a file of that kind is opened and cached by the module system after that.
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<LanguageSupport>> = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  ts: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  mts: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  cts: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true })
    ),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  vue: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  pyi: () => import("@codemirror/lang-python").then((m) => m.python()),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  yml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  kt: () => import("@codemirror/lang-java").then((m) => m.java()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cc: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  svg: () => import("@codemirror/lang-xml").then((m) => m.xml()),
};

/** Dotfiles and extensionless names whose name alone tells us the grammar. */
const FILENAME_LANGUAGES: Record<string, string> = {
  ".babelrc": "json",
  ".eslintrc": "json",
  ".prettierrc": "json",
  ".swcrc": "json",
};

function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Short label for the status line ("TypeScript", "JSON", …). */
export function languageLabel(filePath: string): string {
  const ext = extensionOf(filePath);
  const labels: Record<string, string> = {
    js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
    ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
    json: "JSON", jsonc: "JSON", html: "HTML", htm: "HTML", vue: "Vue",
    css: "CSS", scss: "SCSS", less: "Less", md: "Markdown", markdown: "Markdown",
    mdx: "MDX", py: "Python", pyi: "Python", rs: "Rust", go: "Go",
    yaml: "YAML", yml: "YAML", sql: "SQL", java: "Java", kt: "Kotlin",
    c: "C", h: "C", cc: "C++", cpp: "C++", hpp: "C++", php: "PHP",
    xml: "XML", svg: "SVG", sh: "Shell", bash: "Shell", zsh: "Shell",
    toml: "TOML", txt: "Text",
  };
  return labels[ext] ?? (ext ? ext.toUpperCase() : "Text");
}

/**
 * Resolve the grammar for a path, or null when we don't bundle one (the file
 * still opens -- it just renders unhighlighted, which is the right failure).
 */
export async function languageFor(filePath: string): Promise<LanguageSupport | null> {
  const base = (filePath.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase();
  const key = extensionOf(filePath) || FILENAME_LANGUAGES[base] || "";
  const loader = LANGUAGE_LOADERS[key];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    // A grammar chunk failing to load must not take the file view down.
    return null;
  }
}
