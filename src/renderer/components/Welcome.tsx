import { FolderOpen, Sparkles, GitBranch, ShieldCheck, KeyRound, FolderGit2, Clock, Trash2 } from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { Button } from './ui'
import { appIcon } from '../assets/icons'

export function Welcome() {
  const openFolder = useKennel((s) => s.openFolder)
  const openProjectPath = useKennel((s) => s.openProjectPath)
  const removeProject = useKennel((s) => s.removeProject)
  const openSettings = useKennel((s) => s.openSettings)
  const providers = useKennel((s) => s.state?.providers ?? [])
  const recents = useKennel((s) => s.state?.recentProjects ?? [])
  const hasKey = providers.some((p) => p.hasKey || p.kind === 'openai-compatible')

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-10">
      <div className="w-full max-w-3xl animate-fade-in">
        <div className="mb-10 text-center">
          <img
            src={appIcon}
            alt="Kennel"
            className="mx-auto mb-6 h-16 w-16 rounded-2xl object-cover shadow-glow"
          />
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink">
            Branch your codebase like a conversation
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm leading-relaxed text-ink-soft">
            Kennel turns development into a canvas of states. Every agent run and every command
            becomes a node — a real, versioned snapshot of your code you can branch from, compare,
            and build on.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-3 gap-3">
          <Feature
            icon={<GitBranch size={16} />}
            title="Git-backed nodes"
            body="Each node is a real commit. Branch from any point in your history."
          />
          <Feature
            icon={<Sparkles size={16} />}
            title="Agent personas"
            body="Instructor, Ask, Worker — each with its own model and permissions."
          />
          <Feature
            icon={<ShieldCheck size={16} />}
            title="Scoped permissions"
            body="Decide who can edit files, run shell, or touch core memory."
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button variant="primary" className="px-5 py-2.5 text-[15px]" onClick={openFolder}>
            <FolderOpen size={18} />
            Open a project folder
          </Button>

          {!hasKey && (
            <button
              onClick={() => openSettings('providers')}
              className="no-drag inline-flex items-center gap-1.5 text-xs text-amber transition-colors hover:text-amber-soft"
            >
              <KeyRound size={13} />
              Add an AI provider key to get started
            </button>
          )}
        </div>

        {recents.length > 0 && (
          <div className="mx-auto mt-10 max-w-xl">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              <Clock size={12} />
              Recent projects
            </div>
            <div className="space-y-1.5">
              {recents.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center rounded-xl border border-line bg-surface/60 transition-colors hover:border-line-strong"
                >
                  <button
                    onClick={() => void openProjectPath(p.path)}
                    className="no-drag flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left"
                  >
                    <FolderGit2 size={16} className="shrink-0 text-iris-soft" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-[11px] text-ink-faint">{p.path}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => void removeProject(p.id)}
                    title="Remove from list"
                    className="no-drag mr-2 shrink-0 rounded-lg p-1.5 text-ink-ghost opacity-0 transition-all hover:text-rose group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Feature({
  icon,
  title,
  body
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 p-4 transition-colors hover:border-line-strong">
      <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-iris/12 text-iris-soft">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{body}</p>
    </div>
  )
}
