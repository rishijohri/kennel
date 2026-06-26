# Kennel — Design System

> Single source of truth for Kennel's visual language: color, type, motion,
> iconography, components, and layout. Derived from the live implementation
> (`tailwind.config.js`, `src/renderer/styles/global.css`, `src/renderer/components/**`).
> When code and this doc disagree, the **tokens in `tailwind.config.js` are authoritative** —
> update this doc to match.

---

## 1. Brand foundation

**Product.** Kennel is a node-based agentic IDE. Development becomes a *canvas of
states*: every agent run and every command is a real, git-versioned node you can
branch from, compare, and build on.

**Metaphor.** A kennel keeps and tends working "agents" (hounds). Two off-canvas
operators embody this:
- **Care Taker** — tends the kennel: builds agent personas & deterministic processes.
- **Walker** — walks the agents through the graph: the autonomous orchestrator that
  spawns/reads canvas nodes on an autonomy *leash* (node budget).

**Personality.** Precise, premium, quietly futuristic. Deep-space dark surfaces,
one electric **iris/violet** signature, warm accents, glass + glow. Never loud,
never flat. The canvas is calm; energy comes from focused glow and motion.

**Design principles**
1. **Dark-first, depth by layering** — stack translucent slate surfaces, not borders alone.
2. **One hero hue** — iris `#7c6cff` leads; accents (amber/mint/rose/blue) carry *meaning*, not decoration.
3. **Glass over scrims** — floating surfaces frost the world behind them rather than boxing it.
4. **Glow = focus** — the iris glow signals the active/important element; use sparingly.
5. **Color is semantic** — mint = good, rose = bad, amber = caution/attention, iris = primary/AI, blue = workflow.
6. **Density with rhythm** — compact but on a consistent 4px spacing grid.

---

## 2. Color system

All tokens live in `tailwind.config.js → theme.extend.colors`. Use the **named
Tailwind tokens** (`bg-iris`, `text-mint`, `border-line`) — never raw hex in JSX,
except for *data-driven* colors (persona colors, accent rings) applied inline.

### 2.1 Surfaces (deep slate, layered for depth)

| Token | Hex | Role |
|---|---|---|
| `base` | `#0a0b10` | App background / deepest layer / code editor bg |
| `surface` | `#101218` | Default panel surface |
| `surface-raised` | `#161922` | Node cards, raised controls |
| `surface-overlay` | `#1c2030` | Menus, popovers, elevated overlays |
| `surface-hover` | `#222639` | Hover state for interactive surfaces |

Surfaces are frequently used at partial opacity for translucency over the ambient
glow: `bg-surface/40`, `/50`, `/60`, `/70`.

### 2.2 Lines (borders & dividers)

| Token | Hex | Role |
|---|---|---|
| `line` | `#262a3a` | Default 1px borders, dividers |
| `line-strong` | `#343a52` | Hover/emphasis borders |

Common opacities: `border-line/70` (soft structural dividers), `/40`–`/60` (faint section rules).

### 2.3 Ink (text)

| Token | Hex | Role |
|---|---|---|
| `ink` | `#e7e9f3` | Primary text, titles |
| `ink-soft` | `#a9adc4` | Secondary text, body |
| `ink-faint` | `#6b7090` | Tertiary text, labels, hints |
| `ink-ghost` | `#474b64` | Quaternary — placeholders, metadata, disabled |

Hierarchy is expressed almost entirely through these four steps. Uppercase
section labels use `ink-faint`; placeholders use `ink-ghost`/`ink-faint`.

### 2.4 Brand & semantic accents

| Token | Hex | Soft | Meaning / usage |
|---|---|---|---|
| `iris` | `#7c6cff` | `iris-soft #9a8dff` | **Primary brand / AI.** Primary buttons, focus rings, active tabs, agentic nodes, Care Taker, edges, selection. Also `iris-deep #5b4ddb`, `iris-glow rgba(124,108,255,0.35)`. |
| `mint` | `#4fd6a8` | `mint-soft #7fe6c4` | **Success / active / Walker.** Done states, "checked out", positive diffs (`+`), Walker accent, enabled toggles. |
| `amber` | `#ffb454` | `amber-soft #ffc97a` | **Caution / attention / deterministic.** Warnings, untested, deterministic (command) nodes, Wake Mode, neutral result states. |
| `rose` | `#ff6b8b` | `rose-soft #ff97ad` | **Error / destructive.** Errors, delete actions, negative diffs (`−`), stop/cancel. |
| `blue` (Park) | `#56b6ff` | `mint-soft` family | **Workflow / Park.** Park nodes, park edges, the `blue` StageAccent. Defined in code as `PARK_ACCENT`, not a Tailwind token — use the literal `#56b6ff`. |

**Persona palette** (`ui.tsx → COLORS`, also used by the Care Taker for new agents) —
each persona picks one; the node/inspector tints itself from it:
`#7c6cff` `#4fd6a8` `#ffb454` `#ff6b8b` `#56b6ff` `#c678dd` `#e5c07b` `#98c379`

### 2.5 Opacity & tint conventions

Accents are almost always used as **low-alpha tints** for fills and **mid-alpha**
for borders/rings, with the solid color for the icon/text:

| Pattern | Recipe | Example |
|---|---|---|
| Soft status chip | `bg-<accent>/12 text-<accent>` | `bg-mint/12 text-mint` (done) |
| Alert box | `border-<accent>/30 bg-<accent>/10 text-<accent>-soft` | error / success banners |
| Icon tile | `bg-<accent>/15 text-<accent>` | node kind icon, feature tiles |
| Data-driven tile | inline `background: <color>22` + `boxShadow: inset 0 0 0 1px <color>55` | persona/park icon boxes |
| Selection ring | `ring-2` + inline `--tw-ring-color: <accent>` | selected node / active card |
| Glass control (on stages) | `border-white/10 bg-black/40…/70` + `backdrop-blur` | breadcrumb, history, prompt box |

Hex-alpha suffixes seen in inline styles: `22` (≈13%) for fills, `55` (≈33%) for
inset borders, `1f` (≈12%), `18`/`40` for park buttons.

### 2.6 Signature gradients & glows

- **Ambient app glow** (`#root`): iris radial top-right + mint radial bottom-left over `base`.
  ```
  radial-gradient(1200px 600px at 75% -10%, rgba(124,108,255,0.10), transparent 60%),
  radial-gradient(900px 500px at 0% 110%, rgba(79,214,168,0.06), transparent 55%)
  ```
- **Glow shadow** (`shadow-glow`): `0 0 0 1px rgba(124,108,255,0.4), 0 8px 30px -8px rgba(124,108,255,0.45)` — hero marks, key CTAs.
- **Primary button shadow**: `0 6px 20px -8px rgba(124,108,255,0.9)`.
- **Selection / hue rings**: per-accent, applied via `--tw-ring-color`.

---

## 3. Typography

**Families** (`tailwind.config.js`)
- **Sans:** `Inter var, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif` — all UI.
- **Mono:** `JetBrains Mono, SF Mono, ui-monospace, Menlo, monospace` — code, commit hashes, commands, file paths, model IDs, I/O contract keys, Monaco.

**Type scale** (the app uses fine-grained arbitrary sizes — keep to this set):

| Size | Usage |
|---|---|
| `text-3xl` (30) | Welcome hero headline |
| `text-xl` (20) | Stage headings |
| `text-base` (16) | Modal titles |
| `text-sm` (14) | Body, card titles, buttons |
| `text-[13px]` | Node titles, dense body, list rows |
| `text-xs` (12) | Labels, secondary controls, hints |
| `text-[11px]` / `[10.5px]` / `[10px]` | Metadata, badges, pills, captions |

**Weights:** `font-semibold` (titles/headings), `font-medium` (labels, buttons, tabs),
normal (body). `font-bold` only for tiny status glyphs.

**Conventions**
- **Section labels:** `text-[11px] font-medium uppercase tracking-wide text-ink-faint` (`tracking-wider` for the smallest).
- **Balance long headings:** `.text-balance` utility.
- **Selectable content** (logs, code, errors): add `.selectable` (the app sets `user-select: none` globally).
- Numbers/IDs/commands → always `font-mono`.

---

## 4. Spacing, radius, elevation

**Spacing** — 4px grid. Common gaps: `gap-1.5` (6) / `gap-2` (8) / `gap-2.5` (10) /
`gap-3` (12). Card padding `p-3`–`p-4`; panel padding `p-5`; pill padding `px-2 py-0.5`.

**Radius**

| Token | px | Usage |
|---|---|---|
| `rounded-md` | 6 | inline chips, tiny toggles |
| `rounded-lg` | 8 | icon buttons, small controls, menu items |
| `rounded-xl` | 14 (custom) | inputs, buttons, cards, alert boxes |
| `rounded-2xl` | 18 (custom) | node cards, modals, feature tiles, hero marks |
| `rounded-full` | — | pills, badges, toggles, FABs, avatars |
| `rounded-[26px]` | 26 | hero prompt box |

**Elevation** (`tailwind.config.js → boxShadow`)

| Token | Value | Usage |
|---|---|---|
| `shadow-node` | `0 1px 2px rgba(0,0,0,.4), 0 8px 24px -10px rgba(0,0,0,.6)` | node cards, popovers, floating controls |
| `shadow-panel` | `0 24px 60px -20px rgba(0,0,0,.75)` | modals, large flyouts |
| `shadow-glow` | iris ring + drop (see §2.6) | hero marks, emphasis |

---

## 5. Motion & effects

Transitions are short and physical. Defaults: `transition-colors` / `transition-all`
at `duration-150`. Press feedback: `active:scale-95` (icon buttons) / `active:scale-[0.98]` (buttons).
Hover lift on cards: `hover:-translate-y-0.5`. Icon nudges: `group-hover:scale-110`.

**Keyframes** (`tailwind.config.js` + `global.css`)

| Name | Defined | Use |
|---|---|---|
| `animate-fade-in` | config | overlays, content fade/translate-in |
| `animate-scale-in` | config | modal pop (`scale .96→1`, eased) |
| `animate-pulseline` | config | pulsing connection/lines |
| `dashdraw` | global.css | animated (running) React Flow edges |
| `aura-in / aura-breathe / aura-drift` | global.css | the prompt-box breathing aura |
| `animate-fly-down`, `animate-chip-pop`, `animate-float-in` | (stage components) | history flyout, breadcrumb chips, stage transitions |

**Signature effects**

- **`.glass`** — `linear-gradient(180deg, rgba(22,25,34,.92), rgba(16,18,24,.92))` + `backdrop-blur(18px)`. Modals, docked panels.
- **`.frost-scrim`** — full-screen agent "stage" backdrop: `radial-gradient(... rgba(18,20,30,.42)→rgba(5,6,10,.74))` + `backdrop-blur(46px) saturate(118%)`. The canvas is *barely felt* behind it.
- **`.prompt-aura`** — the breathing multi-hue glow behind the prompt box (Gemini-style). Three timelines (fade-in, breathe scale/opacity, slow hue-drift). Tinted per agent via `--aura-1/2/3`. `.is-compact` variant for docked size. Honors `prefers-reduced-motion`.
- **Glass controls on stages** — `border-white/10 bg-black/40–/70 backdrop-blur-md`, hover `border-white/20–/25`.

**Accessibility:** respect `prefers-reduced-motion` (already done for the aura); keep
new infinite animations behind the same guard.

---

## 6. Iconography scheme

Kennel uses **two complementary icon layers**:

### 6.1 In-app functional icons — [lucide-react](https://lucide.dev)

The working UI icon set. Stroke icons, colored via `currentColor` (so they inherit
`text-*` tokens). **Sizing scale:**

| Context | size (px) |
|---|---|
| Pills / badges / inline meta | 10–11 |
| Section controls, list-row glyphs | 12–13 |
| Buttons (with label), tabs | 14–15 |
| Panel headers, modal actions | 15–16 |
| Stage close / large affordances | 16–18 |
| Mode cards, empty-state icons | 18–22 |

**Color-coding** (always semantic): neutral `text-ink-soft`/`-faint`/`-ghost`,
primary/AI `text-iris-soft`, success `text-mint`, warning `text-amber`/`-soft`,
error/destructive `text-rose`, workflow `#56b6ff`.

**Canonical icon map** (keep these stable — they form the visual vocabulary):

| Concept | lucide icon | Concept | lucide icon |
|---|---|---|---|
| App / settings | `Settings` | Root node ("codebase") | `Box` |
| Agentic node | `Sparkles` (or persona emoji) | Deterministic node | `TerminalSquare` |
| Park / workflow node | `Workflow` | Branch / new step | `Plus` |
| Run / play | `Play` | Stop / cancel | `Square` |
| Send (prompt) | `ArrowUp` | Trigger (park) | `Zap` |
| Schedule (park) | `Clock` | Project (git) | `FolderGit2` |
| Branch / version | `GitBranch` | Commit | `GitCommitHorizontal` |
| Diff / changes | `FileDiff` / `GitCompare` | Code view | `Code2` |
| AI Providers | `Server` | Local Models | `Cpu` |
| MCP | `Plug` / `PlugZap` | Personas | `Users` / `Sparkles` |
| Perm: edit files | `FilePen` | Perm: run shell | `TerminalSquare` |
| Perm: core memory | `BrainCircuit` | Perm: web search | `Globe` |
| Walker | `Footprints` | Care Taker | `Sparkles` |
| Autonomy: cautious | `ShieldCheck` | Autonomy: balanced | `Scale` |
| Autonomy: autonomous | `Rocket` | Wake Mode | `Coffee` |
| Success | `Check` / `CheckCircle2` | Error / warning | `AlertTriangle` / `XCircle` |
| Loading | `Loader2` (`animate-spin`) / `Spinner` | Delete | `Trash2` |
| Edit | `Pencil` | Close | `X` |
| Skipped step | `SkipForward` | History | `History` |

> **Rule:** one concept → one icon, everywhere. Don't introduce a second "run"
> or "delete" glyph. Add new entries to this table before using them.

### 6.2 Brand marks — custom "duotone-glass" art

Raster brand art (the hound family + feature marquees). Shipped in `assets/` at
high res, downscaled to 256px for in-app use via `src/renderer/assets/icons.ts`.

| Asset | Source (assets/) | In-app (256px) | Role |
|---|---|---|---|
| App icon | `app_main_icon.png` (2048²) | `app.png` | TitleBar mark, Welcome hero, packaged app icon |
| Care Taker | `care_taker_icon.png` (2048²) | `caretaker.png` | Care Taker stage/sidebar |
| Walker | `walker_agent_icon.png` (2048²) | `walker.png` | Walker stage/sidebar |
| AI Providers | `ai_provider.png` (2816×1536) | — | Providers feature art |
| Local AI | `local_ai.png` (2816×1536) | — | Local Models feature art |

**Style contract for all brand art** (so the family stays coherent):
- **App icon:** stylized geometric **hound head**, iris→deep-violet gradient, single
  **amber** glowing eye, collar formed from connected graph nodes (mint node accent),
  on a glassy dark rounded-square tile with upper-right iris glow.
- **UI/agent marks:** **duotone-glass** — 2px rounded iris→`#5b4ddb` gradient strokes,
  one accent pop per icon, faint iris glow (`rgba(124,108,255,0.35)`), transparent bg.
- **Per-agent accent:** Care Taker = **amber** pop on iris; Walker = **mint** (sibling of
  Care Taker, conveying motion/traversal — leash across two nodes with a stepping paw-print).

**Generation:** prompts and the Nano-Banana / Imagen workflow for producing/extending
this set live in `docs/ICON_PROMPTS.md` (see §11). Convert flat marks to **SVG +
`currentColor`** where they sit in button slots; keep glassy raster for hero/marquee.

---

## 7. Component library (`src/renderer/components/ui.tsx`)

Shared primitives. Reuse these — don't re-style buttons/inputs ad hoc.

### Button — `<Button variant>`
Base: `inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-40`.

| Variant | Style |
|---|---|
| `primary` | `bg-iris text-white shadow-[0_6px_20px_-8px_rgba(124,108,255,.9)] hover:bg-iris-soft` |
| `subtle` (default) | `bg-surface-overlay text-ink border border-line hover:border-line-strong hover:bg-surface-hover` |
| `ghost` | `text-ink-soft hover:text-ink hover:bg-surface-hover` |
| `danger` | `bg-rose/15 text-rose border border-rose/30 hover:bg-rose/25` |

### IconButton
`h-8 w-8 rounded-lg text-ink-soft hover:bg-surface-hover hover:text-ink active:scale-95`. 16px icon.

### Inputs — `TextInput` / `TextArea` / `Select`
Shared field: `w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-ghost outline-none transition-colors focus:border-iris focus:ring-2 focus:ring-iris/25`.
`Select` adds `appearance-none cursor-pointer pr-8`. `TextArea` adds `leading-relaxed`, no resize.

### Toggle
Row: `rounded-xl border border-line bg-surface px-3.5 py-2.5 hover:border-line-strong` with label + optional hint.
Switch: `h-6 w-11 rounded-full`; track ON = accent (default iris) via inline bg, OFF = `bg-line-strong`; knob `h-5 w-5 bg-white` slides `left-0.5 → left-[22px]`.

### Badge / pill
`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium`; color via the §2.5 status recipes.

### Label
`mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint`.

### Modal + ModalHeader
`Modal`: fixed inset, scrim `bg-black/55 backdrop-blur-sm animate-fade-in` (click-to-close), panel `rounded-2xl border border-line glass shadow-panel animate-scale-in`. Sizes via `className` (e.g. `max-w-3xl h-[82vh]`, `max-w-md` confirm, `max-w-6xl` file viewer).
`ModalHeader`: `border-b border-line px-6 py-4`, title `text-base font-semibold text-ink`, subtitle `text-xs text-ink-faint`, close `IconButton`.

### Spinner
`animate-spin rounded-full border-2 border-current` with transparent top — size-prop driven. Inline loaders use lucide `Loader2 … animate-spin`.

### Tokens exported for data-driven UI
`EMOJIS` (persona glyph picker) and `COLORS` (persona palette, §2.4).

---

## 8. App shell & layout

```
┌───────────────────────────────────────────────────────────┐
│ TitleBar  (h-11, drag region, glass)                        │
├──────────┬───────────────────────────────┬─────────────────┤
│ Sidebar  │  FlowCanvas (React Flow)       │ NodeInspector   │
│ (resize  │   …or ParkCanvas               │ (w-440, when a  │
│ 220–460, │                                │  node selected) │
│ def 256) │                                │                 │
└──────────┴───────────────────────────────┴─────────────────┘
  Overlays (portal-level): RunLauncher · SettingsModal · LocalSetupModal
                           CaretakerPanel · WalkerPanel · Toasts
```

- **TitleBar** — `h-11`, `drag-region`, `border-b border-line/70 bg-surface/60`, `pl-[88px]` for macOS traffic lights. App mark + name, project menu (`FolderGit2`), active-node breadcrumb, Wake toggle (`Coffee`, amber glow when on), Settings. Interactive bits use `.no-drag`.
- **Sidebar** — `border-r border-line/70 bg-surface/40`, user-resizable (drag handle shows `bg-iris/60`, persisted to `localStorage`, double-click resets). Holds the two **agent launch buttons** (Care Taker = iris gradient card + `Sparkles`; Walker = mint gradient card + `Footprints`), persona/process tabs & cards, and a footer (Providers/Local Models with running status dots, close project).
- **FlowCanvas** — transparent over the ambient glow; **Dots** background `gap=26 size=1.5 color=rgba(124,108,255,.12)`; `smoothstep` edges with iris arrowheads; MiniMap tinted by node kind; "Tidy up" panel button. `fitView` padding `.35`, zoom `.2–1.75`.
- **NodeInspector** — right `w-[440px]` panel, `border-l border-line/70 bg-surface/50`. Header (kind icon tinted by persona color, title, commit) + action buttons + tabs **Overview / Activity / Files** (`border-b-2 border-iris` active).
- **Agent stages** (`AgentStage` / `AgentChatStage`) — **full-screen frosted stages**, not boxed modals: `frost-scrim` backdrop, History pill top-left, Close top-right, content floating on the scrim, the **breathing PromptBox** docked. This is the signature surface for Care Taker, Walker, and the New-Step wizard (RunLauncher).

---

## 9. Key patterns

### 9.1 Node card (`KennelNode`)
`w-[260px] rounded-2xl border bg-surface-raised/95 shadow-node`. State borders:
selected → `border-transparent ring-2` (ring = accent), active → `border-mint/45`,
default → `border-line hover:border-line-strong`. Anatomy: kind-icon tile (color by
kind — root iris, deterministic amber, park blue, agentic persona color) + title +
**StatusPill** + truncated prompt/summary + diff-stat footer (`+mint / −rose`) +
hover **branch FAB** (`Plus`, bottom-center). Top/bottom React Flow handles.

### 9.2 Status & result color-coding (canonical)
| State | Style | Glyph |
|---|---|---|
| Running | `bg-iris/15 text-iris-soft` | `Spinner` |
| Success / done | `bg-mint/12 text-mint` | `Check` |
| Failure / error | `bg-rose/15 text-rose` | `AlertTriangle` |
| Neutral result | `bg-amber/12 text-amber-soft` | `Check` |
| Skipped | `bg-amber/12 text-amber-soft` | `SkipForward` |
| Park trigger / schedule | `#56b6ff` tint | `Zap` / `Clock` |

### 9.3 Agent identity (accent) system
| Surface | StageAccent | Color | Send button |
|---|---|---|---|
| Care Taker | `iris` | `#7c6cff` | `bg-iris text-white` |
| Walker | `mint` | `#4fd6a8` | `bg-mint text-base` |
| Park context / workflow | `blue` | `#56b6ff` | `bg-[#56b6ff] text-base` |
Each drives the PromptBox aura trio, focus ring, history active-state, and accent text.

### 9.4 Autonomy control (Walker)
3-up grid of cards (`grid-cols-3 gap-1.5`), active = `border-mint/50 bg-mint/12`:
**Cautious** (`ShieldCheck`, ≤3 nodes) · **Balanced** (`Scale`, ≤8) · **Autonomous** (`Rocket`, ≤25).

### 9.5 Empty / loading / feedback
- **Empty:** dashed border (`border-dashed border-line` or `border-white/15` on stages), centered muted icon (18–22px `ink-ghost`) + two-line `ink-faint`/`ink-ghost` copy.
- **Loading:** `Loader2 animate-spin` in-place of the resting icon; disable the control.
- **Alerts:** `border-<accent>/30 bg-<accent>/10 text-<accent>-soft`, leading icon `mt-0.5 shrink-0`.
- **Destructive:** confirm via small `Modal` (`max-w-md`) with `danger`/rose button.
- **Toasts:** bottom overlay; success mint, error rose, info iris.

### 9.6 Monaco (read-only code/diff)
`readOnly`, no minimap, `fontSize 12.5`, `lineHeight 19`, mono family, bg `#0a0b10`,
thin 9px scrollbars, no hover/suggest. Diff toggles side-by-side (`Rows2`/`Columns2`).

---

## 10. Accessibility & quality bar

- **Contrast:** `ink` on `surface` passes AA; keep body text at `ink-soft` or lighter on dark surfaces. Avoid `ink-ghost` for anything that must be read.
- **Focus:** inputs show `focus:border-iris focus:ring-2 focus:ring-iris/25`; preserve visible focus on all custom buttons.
- **Keyboard:** modals/stages close on `Esc` (stages close flyout first, then stage); menus close on outside-click + `Esc`.
- **Motion:** gate infinite animations behind `prefers-reduced-motion` (done for the aura).
- **ARIA:** dialogs use `role="dialog" aria-modal labelledby`; icon-only buttons need `aria-label` + `title`.
- **Selection:** global `user-select: none`; add `.selectable` to logs/code/errors.
- **Color is never the only signal:** pair status colors with an icon (mint+`Check`, rose+`AlertTriangle`).

---

## 11. Asset & icon production

- **Brand art lives in** `assets/` (hi-res source) → downscaled 256px in `src/renderer/assets/` → re-exported via `icons.ts`. Packaged app icon is wired through `electron-builder.yml`.
- **Generation prompts** (Nano Banana / Imagen / Midjourney) for the duotone-glass
  set + hound marks, including the contact-sheet workflow and the Walker, are in
  **`docs/ICON_PROMPTS.md`**. Always paste the shared **Style Block** so new icons
  match: 2px iris→`#5b4ddb` strokes, one accent pop, faint iris glow, transparent bg.
- **When adding an in-app glyph:** prefer lucide first (extend §6.1 table); only
  commission custom art for brand/agent identity, not generic UI actions.

---

## 12. Token quick-reference

```
COLOR     base #0a0b10 · surface #101218 / raised #161922 / overlay #1c2030 / hover #222639
          line #262a3a / strong #343a52
          ink #e7e9f3 / soft #a9adc4 / faint #6b7090 / ghost #474b64
          iris #7c6cff (soft #9a8dff, deep #5b4ddb) · mint #4fd6a8 (soft #7fe6c4)
          amber #ffb454 (soft #ffc97a) · rose #ff6b8b (soft #ff97ad) · park-blue #56b6ff
TYPE      Inter (UI) · JetBrains Mono (code) · 11→30px · medium/semibold
RADIUS    md 6 · lg 8 · xl 14 · 2xl 18 · full
SHADOW    node · panel · glow
MOTION    150ms · fade-in · scale-in · frost-scrim · prompt-aura
ICONS     lucide (stroke, currentColor) + duotone-glass brand marks
ACCENTS   Care Taker iris · Walker mint · Park blue · deterministic amber
```
