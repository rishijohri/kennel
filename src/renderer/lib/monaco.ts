import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// The app runs offline and notarized, so Monaco must be BUNDLED locally — never
// fetched from a CDN (the @monaco-editor/react default). We point its loader at
// the npm monaco and provide the editor worker via Vite's ?worker import.
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}
loader.config({ monaco })

// This is a strictly READ-ONLY viewer — no IntelliSense/validation is needed.
// Turn off language-service diagnostics so Monaco never spins up the per-language
// workers (json/ts/css/html). Otherwise their validation would request a worker
// we don't provide and log console errors. (Also keeps the bundle lean.)
const langs = monaco.languages as unknown as {
  typescript?: { typescriptDefaults?: any; javascriptDefaults?: any }
  json?: { jsonDefaults?: any }
  css?: { cssDefaults?: any; scssDefaults?: any; lessDefaults?: any }
}
const noTsDiag = { noSemanticValidation: true, noSyntacticValidation: true, noSuggestionDiagnostics: true }
langs.typescript?.typescriptDefaults?.setDiagnosticsOptions?.(noTsDiag)
langs.typescript?.javascriptDefaults?.setDiagnosticsOptions?.(noTsDiag)
langs.json?.jsonDefaults?.setDiagnosticsOptions?.({ validate: false })
langs.css?.cssDefaults?.setOptions?.({ validate: false })
langs.css?.scssDefaults?.setOptions?.({ validate: false })
langs.css?.lessDefaults?.setOptions?.({ validate: false })

let themed = false
/** A dark theme tuned to Kennel's palette (call before setting theme="kennel-dark"). */
export function ensureKennelTheme(m: typeof monaco): void {
  if (themed) return
  themed = true
  m.editor.defineTheme('kennel-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0a0b10',
      'editor.foreground': '#c8cee0',
      'editorLineNumber.foreground': '#3a4055',
      'editorLineNumber.activeForeground': '#7c6cff',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorGutter.background': '#0a0b10',
      'editor.selectionBackground': '#7c6cff33',
      'editorIndentGuide.background1': '#ffffff0a',
      'diffEditor.insertedTextBackground': '#4fd6a822',
      'diffEditor.removedTextBackground': '#ff6b8b22',
      'diffEditor.insertedLineBackground': '#4fd6a814',
      'diffEditor.removedLineBackground': '#ff6b8b14',
      'scrollbarSlider.background': '#ffffff14'
    }
  })
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  php: 'php', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
  sql: 'sql', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r', scala: 'scala',
  graphql: 'graphql', gql: 'graphql', proto: 'protobuf'
}

/** Best-effort Monaco language id from a file path. */
export function languageForPath(path: string): string {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile'
  if (base === 'makefile') return 'plaintext'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_LANG[ext] ?? 'plaintext'
}
