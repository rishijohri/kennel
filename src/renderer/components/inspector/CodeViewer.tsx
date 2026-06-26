import { Editor } from '@monaco-editor/react'
import { Spinner } from '../ui'
import { ensureKennelTheme, languageForPath } from '../../lib/monaco'

/** Read-only, syntax-highlighted single-file viewer (Monaco). Never editable. */
export function CodeViewer({ path, content }: { path: string; content: string }) {
  return (
    <Editor
      height="100%"
      theme="kennel-dark"
      language={languageForPath(path)}
      value={content}
      beforeMount={ensureKennelTheme}
      loading={
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} />
        </div>
      }
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12.5,
        lineHeight: 19,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        renderLineHighlight: 'none',
        automaticLayout: true,
        smoothScrolling: true,
        hover: { enabled: false },
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        parameterHints: { enabled: false },
        scrollbar: { useShadows: false, verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
        padding: { top: 10, bottom: 10 }
      }}
    />
  )
}
