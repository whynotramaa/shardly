---
name: Shardly
description: Search-first document tool in a flat, technical-drawing style with one rust accent.
---

# Design system: Shardly

## Overview

Shardly opens to a search box and little else. The look is a technical drawing: hairlines, square corners, mono labels, serif display headings, and rust as the only color. Sources, Library, and Engine sit behind the menu in the top bar. Matching and ranking options live in one popover on the search box. Technical detail (scores, inspector, comparisons) appears only when asked for.

`web/app/globals.css` is the only stylesheet. `web/components/ui.tsx` holds the shared primitives: `Icon`, `Brand`, `Check`, `Switch`, `Segmented`, `Progress`, and `Toast`. Use them before writing new markup.

## Color

Dark is the default. `data-theme="light"` on `<html>` swaps every token.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0b0b0c` | `#f4f4f3` | Page |
| `--surface` | `#141416` | `#ffffff` | Fields, panels, active rows |
| `--surface-2` / `--surface-3` | `#1b1b1e` / `#242428` | `#ececeb` / `#e2e2e0` | Hover, tracks, chips |
| `--ink` / `--ink-2` / `--ink-muted` | `#ededec` / `#b9b9bd` / `#87878c` | `#17171a` / `#3d3d43` / `#5f5f66` | Headings / body / metadata |
| `--ember` | `#c4552e` | `#b0431d` | Fills: the Search button, checked controls, progress |
| `--ember-text` | `#e27950` | `#a33c17` | Accent text and links (meets contrast at small sizes) |

`--ember-soft` tints matches and selected rows. `--ember-line` outlines focused fields. Status colors `--good`, `--warn`, `--bad` always sit next to a text label.

## Typography

Three faces load through `next/font` in `web/app/layout.tsx`.

- **Fraunces** (`--serif`, weight 400) for display headings: the landing headline, page titles, the idle search title, document titles, and guide sections.
- **Syne** (`--sans`) for interface text and result titles.
- **Geist Mono** (`--mono`) for fields, paths, IDs, timings, scores, tags, and section labels.

Section labels (`.label`, segmented legends, guide kickers) are mono, 11.5px, uppercase, tracked 0.12em. Result titles are rust, 18px, weight 600; snippets are 15px at 1.7 line height, capped at 75ch.

## Shape and depth

Corners are 2px on fields, buttons, chips, and tags; 3px on panels, menus, and the drop zone; 6px on the search box, whose Search button is 3px. Results, documents, and collections are flat rows separated by hairlines. Nothing casts a shadow. Menus, the sheet, and toasts separate from the page with a hairline border only.

## Controls

- **Buttons.** `.button.primary` is a rust outline. `.button.solid` (filled rust) is reserved for the Search button. `.button.ink` is the solid GitHub link on the landing page. Also `ghost`, `danger`, `danger-outline`, `small`. `.text-button` is an underlined muted link that turns rust on hover. `.icon-button` needs an `aria-label`.
- **Current item.** A 2px rust underline marks the current workspace area, menu item, and tour step.
- **Fields.** Native inputs styled globally: page background, hairline border, mono text, rust border on focus.
- **Checkbox, radio, switch.** Native inputs with `appearance: none`. Square checkbox and square switch with a rust fill; round radio with a rust dot. Use `Check`, `Switch`, or a plain `<input type="radio">`.
- **Choices of two to four.** `Segmented`, not `<select>`. Each option is a hairline box; the selected one is rust-tinted.
- **Menus.** Native `popover` with `popoverTarget`, positioned by CSS anchor positioning, with a top-right fallback.
- **Feedback.** Errors render inline as `.alert`. Confirmations go to `Toast`. Destructive actions confirm inline in `.confirm`.

## Motion

Ease `cubic-bezier(0.16, 1, 0.3, 1)` at 140, 240, and 520ms. Animate transform and opacity only.

- Results rise in with a 32ms stagger, then their matched words paint in left to right.
- The landing page keeps the live index animation and the signal-path diagram.
- While a search runs, a rust scan line sweeps under the search box.
- Menus scale in from their anchor. The preview slides in from the right.
- `prefers-reduced-motion` removes all of it.

## Layout

The search page centers when idle and moves to the top once results arrive, max width 1200px. With a preview open, results and preview split `1fr / 440px` above 1000px and stack below. Sources, Library, and Engine use a 760px column of hairline-separated rows, each with a 38px icon tile. At 640px and below, side padding is 16px and result ranks hide.

## Rules

- Keep the query and matched passages ahead of everything else.
- New controls come from `ui.tsx` and the global control styles, never browser defaults.
- Icons come from `Icon`. No unicode arrows, stars, or check marks as icons.
- No cards for result rows, no rounded pills, no thick colored borders, no gradient text.
