/**
 * Correctness only, no style.
 *
 * This exists because `npm run lint` was in package.json and eslint was in
 * devDependencies, but there was no config -- so the script errored out and
 * nobody noticed. A missing import for normalizePin then reached production
 * and killed rider registration: a ReferenceError only fires when its line
 * runs, and that line only runs on the last step of a 14-step flow.
 *
 * Style rules are deliberately left out. The tree is not prettier-formatted,
 * so turning them on would bury the errors that matter.
 */

const browserGlobals = [
  "window", "document", "navigator", "location", "history", "localStorage",
  "sessionStorage", "alert", "confirm", "getComputedStyle", "matchMedia",
  "requestAnimationFrame", "cancelAnimationFrame", "Image", "Audio",
  "MediaRecorder", "FileReader", "CustomEvent", "XMLHttpRequest", "CSS",
  "IntersectionObserver", "MutationObserver", "ResizeObserver", "Notification",
  "Node", "Element", "HTMLElement", "DOMParser", "AudioContext", "screen",
  // Provided by <script> tags, not by us. Every use is already guarded with a
  // typeof check; declaring them keeps the guard from reading as a bug.
  "QRCode", "SokoniQR", "tailwind", "io", "Chart",
];

const nodeGlobals = [
  "process", "console", "Buffer", "__dirname", "__filename", "module",
  "require", "exports", "global", "setImmediate", "clearImmediate",
];

const shared = [
  "fetch", "URL", "URLSearchParams", "FormData", "Blob", "File", "Response",
  "Request", "Headers", "AbortController", "AbortSignal", "TextEncoder",
  "TextDecoder", "ReadableStream", "WebSocket", "Event", "EventTarget",
  "MessageChannel", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "queueMicrotask", "structuredClone", "performance",
  "crypto", "atob", "btoa", "Intl", "createImageBitmap",
];

const globals = Object.fromEntries(
  [...nodeGlobals, ...browserGlobals, ...shared].map((name) => [name, "readonly"])
);

export default [
  {
    ignores: [
      "**/node_modules/**",
      "whatsapp-bot/data/**",
      // Vendored bundles carry their own globals and are not ours to fix.
      "website/assets/js/sokoni-motion/**",
      "website-motion/**",
      "**/*.min.js",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals },
    rules: {
      // Listed one by one rather than pulling in @eslint/js, so this needs no
      // dependency beyond the eslint already in devDependencies. Every rule
      // here catches something that breaks at runtime.
      "no-undef": "error",
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-dupe-class-members": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-obj-calls": "error",
      "no-self-assign": "error",
      "no-unreachable": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-cond-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-sparse-arrays": "error",
    },
  },
  {
    // Loaded by <script>, so these share one global scope rather than being
    // modules.
    files: ["website/assets/js/**/*.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    // Tests are run by node, not the browser.
    files: ["**/*.test.js"],
    languageOptions: { sourceType: "module" },
  },
];
