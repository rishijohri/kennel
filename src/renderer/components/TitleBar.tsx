import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Settings,
  FolderGit2,
  GitBranch,
  ChevronDown,
  FolderOpen,
  House,
  Trash2,
  Coffee
} from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { IconButton } from './ui'
import { appIcon } from '../assets/icons'

export function TitleBar() {
  const project = useKennel((s) => s.state?.project ?? null)
  const nodes = useKennel((s) => s.state?.nodes ?? [])
  const openSettings = useKennel((s) => s.openSettings)

  const active = project ? nodes.find((n) => n.id === project.activeNodeId) : null

  return (
    <header className="drag-region relative z-30 flex h-11 shrink-0 items-center border-b border-line/70 bg-surface/60 pl-[88px] pr-3">
      <div className="flex items-center gap-2.5">
        <img
          src={appIcon}
          alt="Kennel"
          className="h-6 w-6 rounded-md object-cover shadow-[0_2px_10px_-2px_rgba(124,108,255,0.8)]"
        />
        <span className="text-[13px] font-semibold tracking-tight text-ink">Kennel</span>
      </div>

      {project && (
        <div className="ml-3 flex min-w-0 items-center gap-2 text-xs text-ink-faint">
          <span className="text-line-strong">/</span>
          <ProjectMenu />
          {active && (
            <>
              <span className="text-line-strong">·</span>
              <GitBranch size={12} className="shrink-0 text-iris-soft" />
              <span className="max-w-[220px] truncate text-ink-soft">{active.title}</span>
            </>
          )}
        </div>
      )}

      <div className="no-drag ml-auto flex items-center gap-1">
        <WakeToggle />
        <IconButton onClick={() => openSettings('providers')} aria-label="Settings">
          <Settings size={16} />
        </IconButton>
      </div>
    </header>
  )
}

/**
 * Wake Mode toggle — keeps the device awake (Electron `powerSaveBlocker`) so a
 * long agent/process run isn't interrupted by the machine sleeping. Amber glow
 * when on, muted when off. State lives in the main process (transient, off on
 * launch); we read it once on mount and stay in sync since only this toggles it.
 */
function WakeToggle() {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.kennel.getWakeMode().then((v) => {
      if (alive) setOn(v)
    })
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = await window.kennel.setWakeMode(!on)
      setOn(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={() => void toggle()}
      aria-label="Wake Mode"
      aria-pressed={on}
      title={
        on
          ? 'Wake Mode is ON — your device won’t sleep while Kennel works. Click to turn off.'
          : 'Wake Mode is OFF — your device may sleep. Click to keep it awake while working.'
      }
      className={clsx(
        'no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95',
        on
          ? 'bg-amber/15 text-amber ring-1 ring-amber/40 shadow-[0_0_14px_-3px_rgba(255,180,84,0.7)] hover:bg-amber/25'
          : 'text-ink-soft hover:bg-surface-hover hover:text-ink'
      )}
    >
      <Coffee size={16} className={clsx(on && 'animate-[pulse_2.4s_ease-in-out_infinite]')} />
    </button>
  )
}

function ProjectMenu() {
  const project = useKennel((s) => s.state?.project ?? null)
  const recents = useKennel((s) => s.state?.recentProjects ?? [])
  const openFolder = useKennel((s) => s.openFolder)
  const openProjectPath = useKennel((s) => s.openProjectPath)
  const closeProject = useKennel((s) => s.closeProject)
  const removeProject = useKennel((s) => s.removeProject)

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!project) return null
  const others = recents.filter((p) => p.id !== project.id)

  return (
    <div ref={ref} className="no-drag relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex max-w-[260px] items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-overlay',
          open && 'bg-surface-overlay'
        )}
        title="Switch, open, or close project"
      >
        <FolderGit2 size={13} className="shrink-0 text-ink-ghost" />
        <span className="truncate text-ink-soft">{project.name}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-ghost" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-line bg-surface-overlay p-1.5 shadow-node">
          {others.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Switch project
              </div>
              <div className="max-h-64 overflow-y-auto">
                {others.map((p) => (
                  <div
                    key={p.id}
                    className="group flex items-center rounded-lg pr-1 transition-colors hover:bg-surface"
                  >
                    <button
                      onClick={() => {
                        setOpen(false)
                        void openProjectPath(p.path)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <FolderGit2 size={14} className="shrink-0 text-ink-ghost" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-ink">{p.name}</span>
                        <span className="block truncate text-[10px] text-ink-faint">{p.path}</span>
                      </span>
                    </button>
                    <button
                      onClick={() => void removeProject(p.id)}
                      title="Remove from list"
                      className="shrink-0 rounded-md p-1 text-ink-ghost opacity-0 transition-all hover:text-rose group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="my-1 border-t border-line" />
            </>
          )}

          <MenuItem
            icon={<FolderOpen size={14} />}
            label="Open another project…"
            onClick={() => {
              setOpen(false)
              void openFolder()
            }}
          />
          <MenuItem
            icon={<House size={14} />}
            label="Close project (Home)"
            onClick={() => {
              setOpen(false)
              void closeProject()
            }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-surface hover:text-ink"
    >
      <span className="text-ink-ghost">{icon}</span>
      {label}
    </button>
  )
}
