# Kennel — Icon & Brand-Art Generation Prompts

> Ready-to-paste prompts for Nano Banana (Gemini 2.5 Flash Image), Imagen,
> Midjourney, Ideogram, or Flux. Style is locked to the Kennel design system
> (see `docs/DESIGN_SYSTEM.md` §2 colors, §6 iconography).
>
> Two layers: **duotone-glass UI/agent marks** (this file) and the working
> **lucide** functional icons (in-app, no generation needed).

---

## 0. Workflow (Nano Banana)

Nano Banana keeps style consistent via **reference images**. Don't generate cold:

1. **Anchor** → generate the app icon (hound) first.
2. **Contact sheet** → generate all UI icons in one prompt (§4) for internal consistency.
3. **Refine** → upload the sheet/anchor and prompt: *"In the EXACT same style, stroke
   weight, palette and glow as this reference, render just the `<name>` icon, centered."*

Keep the **Style Block** (§1) at the top of every UI-icon prompt.

---

## 1. Style Block (prepend to every UI-icon prompt)

```
STYLE — "Kennel" duotone-glass icon system.
A cohesive set of modern app UI icons for a dark, node-based agentic IDE.
Rendering: clean 2px rounded-cap vector strokes with a subtle inner gradient
from electric iris #7c6cff to deep violet #5b4ddb. Each icon has ONE small
accent pop — warm amber #ffb454 OR mint #4fd6a8 — on its most meaningful element.
A faint outer glow in rgba(124,108,255,0.35) sits behind the glyph.
Geometry: rounded corners (~14px radius feel), balanced negative space,
optically centered on a 24px grid with ~2px safe padding.
Background: fully transparent (alpha). Flat, front-facing, no perspective,
no drop shadows other than the soft iris glow, no background card.
Mood: precise, premium, slightly futuristic. Consistent stroke weight across
the whole set. Crisp at 20px, scalable to 512px.
PALETTE LOCK: iris #7c6cff, iris-deep #5b4ddb, amber #ffb454, mint #4fd6a8,
rose #ff6b8b, ink #e7e9f3 on transparent. No other colors.
```

**Negative / constraints** (append):

```
No background, no rounded-square tile, no text or letters, no photorealism,
no 3D bevels, no skeuomorphism, no busy detail, no neon overload,
no gradient banding, no watermark. Single centered glyph only.
```

---

## 2. Main app icon — stylized hound (anchor)

```
A premium macOS-style app icon for "Kennel", a node-based agentic IDE.
Subject: a minimal, geometric HOUND HEAD in profile-to-three-quarter view —
alert, intelligent, calm. Built from clean confident curves, long muzzle,
one upright pointed ear. Crafted from a smooth iris-to-deep-violet gradient
(#9a8dff → #7c6cff → #5b4ddb). A single glowing AMBER eye (#ffb454) is the
focal accent, with a soft amber glow. A subtle detail: the hound's collar is
formed from two small connected graph nodes + an edge (a quiet nod to a node
graph), tiny mint #4fd6a8 node accent.
Container: a rounded-square app tile (~22% corner radius) in deep slate,
a dark vertical gradient #161922 → #0a0b10, with a faint top inner-light rim
and an ambient iris radial glow in the upper-right (rgba(124,108,255,0.18)).
Soft, premium lighting; crisp edges; centered; generous padding.
Flat-modern with just a hint of depth. No text. 1024x1024.
```

---

## 3. UI / agent icon pack — subject specs

Use **Style Block + Negative + the SUBJECT line**. Accent noted per icon so the
set stays balanced. Maps 1:1 to real components (see DESIGN_SYSTEM §6.1).

| # | Slot | SUBJECT |
|---|------|---------|
| 1 | **Care Taker** | a steward/shield badge with a small paw print embossed at center + a subtle "watching" eye-dot above. **Amber** accent on the paw. The agent that tends the kennel. |
| 2 | **Walker** | a forward lead/leash line curving across two connected graph nodes (a path being walked), a paw-print/chevron stepping along it, a small handle-loop at the leash start (controlled autonomy budget). Sibling of Care Taker but dynamic. **Mint** accent on leash + leading node. |
| 3 | Root node | a single solid origin node with a radiating crown of 3 short edge-stubs. **Amber** core. |
| 4 | Agentic node | a node containing a spark/asterisk-star inside a rounded square, two edges. **Mint** spark. |
| 5 | Deterministic node | a node with a tidy gear-meets-flow glyph, two edges. **Amber** gear teeth. |
| 6 | Run / Execute | a play triangle in a soft ring with a tiny motion spark trail. **Mint** triangle. |
| 7 | AI Providers | a cloud merged with a small chip/node (remote models). **Amber** chip notch. |
| 8 | Local Models | a CPU/chip square with rounded pins + a small lightning bolt. **Mint** bolt. |
| 9 | Perm: edit files | a document page with a pen nib over its corner. **Amber** nib. |
| 10 | Perm: run shell | a rounded terminal window with a `>` chevron + cursor. **Mint** chevron. |
| 11 | Perm: core memory | a brain outline fused with circuit traces + one memory node. **Amber** node. |
| 12 | Add node | a plus inside a node circle with a faint edge stub. **Mint** plus. |
| 13 | Settings | a clean 6-tooth gear, hollow center. **Amber** center ring. |
| 14 | Git / version | a commit dot splitting into two branch paths with end-dots. **Amber** branch-point. |
| 15 | Inspector | a magnifier lens over a small node. **Mint** lens rim. |
| 16 | State: thinking | three pulsing dots in a soft thought-bubble. Iris-only glow (no 2nd accent). |
| 17 | State: done | a check inside a soft ring. **Mint** check. |
| 18 | State: error | an alert triangle with a centered exclamation. **Rose** accent (override). |

> Provider logos (Claude/OpenAI) — use **official trademarks**, never AI-generate them.

---

## 4. One-shot contact sheet (recommended)

```
[PASTE STYLE BLOCK]

Create a single CONTACT SHEET: a 3x6 grid of 18 separate icons on a transparent
background, evenly spaced, each in an invisible equal cell, all sharing identical
stroke weight, gradient, accent treatment and glow. Reading order:
1 care taker shield with paw + watching eye (amber)
2 walker leash walking across two connected nodes with a paw-print + start handle (mint)
3 root origin node with radiating edge-stubs (amber)
4 agentic node with spark-star (mint)
5 deterministic node with gear-flow (amber)
6 run/play triangle in a ring with motion spark (mint)
7 cloud+chip AI providers (amber)
8 CPU chip with lightning, local models (mint)
9 document with pen nib, edit files (amber)
10 terminal window with > chevron, run shell (mint)
11 brain+circuit core memory (amber)
12 plus inside a node, add node (mint)
13 six-tooth gear, settings (amber)
14 git branch with commit dots, versioning (amber)
15 magnifier over a node, inspector (mint)
16 thinking dots in a thought bubble (iris glow only)
17 check in a ring, done (mint)
18 alert triangle with exclamation (rose)
Keep every icon centered in its cell, consistent size, no labels, no text,
no grid lines, transparent background.
```

---

## 5. Sibling consistency (Care Taker ↔ Walker)

After the Care Taker icon exists, upload it and prompt:

```
In the EXACT same style, stroke weight, palette and glow as this Care Taker icon,
create its sibling the Walker — same family, but conveying forward motion /
traversal instead of a static shield (a leash walking across two connected nodes
with a stepping paw-print). Mint accent instead of amber.
```

---

## 6. Export & integration

- **UI icons:** 512px transparent PNG; downscale to 20/24px in-app. Prefer tracing
  flat marks to **SVG** so they inherit `currentColor` / `text-*` tokens.
- **App icon:** 1024², then build the macOS `.icns` set (1024/512/256/128/64/32/16)
  for `electron-builder.yml`.
- **Brand marks:** keep glassy raster for hero/marquee (TitleBar, Welcome, agent
  stages); place source in `assets/`, downscale to 256px into `src/renderer/assets/`,
  re-export via `icons.ts`.
```
