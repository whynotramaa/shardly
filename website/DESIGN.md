---
name: "Shardly engineering guide"
description: "A source-backed engineering reader with compact interactive drawings."
colors:
  page: "var(--ivory)"
  ink-1: "light-dark(#eae4d6, #0d0d0f)"
  ink-2: "light-dark(#e4ddcc, #121215)"
  ivory: "light-dark(#15151a, #efe9dc)"
  ivory-ink: "light-dark(#ece7db, #16150f)"
  accent: "var(--on-accent)"
  accent-hi: "light-dark(#ffc7a1, #c26a35)"
  accent-lo: "light-dark(#24486a, #d98a52)"
  accent-block: "light-dark(#9ec5e8, #f0a878)"
  on-accent: "light-dark(#0a1622, #241206)"
  fg: "var(--on-accent)"
  fg-2: "color-mix(in srgb, var(--fg) 83%, var(--page))"
  fg-3: "color-mix(in srgb, var(--fg) 72%, var(--page))"
  hair: "color-mix(in srgb, var(--on-accent) 20%, transparent)"
  hair-2: "color-mix(in srgb, var(--on-accent) 36%, transparent)"
  hair-solid: "color-mix(in srgb, var(--on-accent) 45%, var(--accent-block))"
  wash-5: "color-mix(in srgb, var(--on-accent) 6%, transparent)"
  wash-9: "color-mix(in srgb, var(--fg) 9%, transparent)"
  acc-6: "color-mix(in srgb, var(--accent) 8%, transparent)"
  acc-30: "color-mix(in srgb, var(--accent) 36%, transparent)"
  field-ground: "light-dark(#e6dfcd, #08080a)"
typography:
  display:
    fontFamily: "Coconat, Georgia, serif"
    fontSize: "clamp(32px,calc(4.2vw - 2px),60px)"
    fontWeight: 400
    lineHeight: 1.13
    letterSpacing: "-.025em"
  headline:
    fontFamily: "Coconat, Georgia, serif"
    fontSize: "clamp(28px,2.7vw,36px)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-.015em"
  title:
    fontFamily: "Coconat, Georgia, serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-.015em"
  body:
    fontFamily: "\"Syne\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: "\"Syne\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
  diagram:
    fontFamily: "\"Geist Mono\", \"SFMono-Regular\", Menlo, Consolas, monospace"
    fontSize: "15px"
  table:
    fontFamily: "\"Syne\", \"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  control: "4px"
  preview: "14px"
spacing:
  reader-inset: "36px"
  header-inset: "24px"
  paragraph: "24px"
  hero-bottom: "64px"
  figure-block: "30px"
  control-gap: "8px"
components:
  button-primary:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.label}"
    padding: "10px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
  button-theme:
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  button-lab:
    textColor: "{colors.fg-2}"
    padding: "9px 15px"
  button-lab-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
  button-lab-solid:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
    padding: "9px 15px"
  field:
    backgroundColor: "{colors.field-ground}"
    textColor: "{colors.fg}"
    padding: "12px 14px"
    width: "100%"
  panel:
    backgroundColor: "{colors.ink-1}"
    padding: "clamp(16px,3vw,28px)"
  rail-preview:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.preview}"
    padding: "13px 15px"
    width: "310px"
  tag:
    textColor: "{colors.accent}"
    padding: "5px 9px"
---

# Design System: Shardly engineering guide

## Overview

**Creative North Star: "The engineering reader"**

This system belongs to website/, the separate Shardly engineering guide. It records the approved Coconat reader as implemented in app/globals.css and the guide components. The repository-root DESIGN.md governs web/ and remains separate.

Plain paper and charcoal grounds hold long-form text, compact diagrams, and runnable examples. Blue in light mode and peach in dark mode identify links and changing diagram state. Source links, captions, and measurements support the reading rather than competing with it.

**Key Characteristics:**

- Local Coconat headings with Syne reading text and Geist Mono code/data.
- A centered reading column with an independent tick navigation rail.
- Flat reading grounds, fine rules, and compact geometric SVG drawings.
- Explicit finite playback, manual steps, and static reduced-motion exploration.

## Colors

The primary accent changes with the color scheme; warm neutral grounds carry the page.

### Primary

Use accent for links, active ticks, selected steps, and transfer paths. Accent-block fills active diagram details. On-accent supplies dark text on the active evidence highlight. Accent-hi and accent-lo retain the existing interactive color vocabulary.

### Neutral

Page is the reader ground; ink-1 is the quiet lab and preview ground; ink-2 is a secondary inherited panel tone. Fg carries text. The final reader overrides derive fg-2 with 83% foreground and fg-3 with 72%, mixed into the page. Hair and hair-2 separate chapters and controls. Hair-solid is an opaque diagram stroke. Ivory and ivory-ink form the contrasting Open app button.

**The surface derivation Rule.** A component that redefines foreground or accent must recompute derived tokens on that component, as the existing contrasting plate does.

Selection uses accent with page-colored text in the final reader override. Keep the native theme-aware scrollbar. CSS light-dark() pairs are normative; do not replace them with only one theme's hex values.

## Typography

Coconat Regular supplies display and section headings. It is served locally from public/fonts/Coconat-Regular.woff2, preloaded in app/layout.tsx, and uses font-display: swap. Preserve public/fonts/Coconat-LICENSE.txt, Collletttivo's SIL Open Font License 1.1, alongside the font.

Syne supplies reading text and UI. Geist Mono supplies code, fields, diagram labels, and numeric data. These two families still load through the existing Google Fonts stylesheet in app/layout.tsx, with local system fallbacks. They require a network request; Coconat does not.

The frontmatter records the effective desktop hierarchy. At widths up to 800px, reading text becomes 16px. At widths up to 600px, reading text becomes 15px, the hero heading becomes 28px, section headings become 27px, and subsection headings become 24px. The brand is 24px Coconat on desktop and 20px on small screens. Header actions are 10px desktop and 9px on small screens. Reading emphasis uses weight 600; heading emphasis stays upright and changes color. Inline code is .84em of reading text and may wrap anywhere.

## Layout

The reader shell has a 1180px maximum width. Its article and hero copy share a 690px maximum width with automatic inline margins. Both are centered in the desktop viewport; the fixed rail does not consume a grid column. Reader shell padding is 36px per side on desktop. The header uses 24px. The header is sticky and 70px tall, changing to 62px at widths up to 600px.

At widths up to 800px, the reading shell reserves 66px on the left for the rail and 24px on the right. At widths up to 600px, these become 56px and 18px. Preserve this mobile reading inset. Hero spacing starts at 52px above and 64px below on desktop; chapters use clamp(64px,7vw,96px) bottom spacing. Adjacent chapters add a fine rule and clamp(44px,5vw,64px) top spacing.

Diagram figures cap at 680px. Drawing SVGs preserve a 600px minimum internal width, and seek drawings preserve 560px; their containers scroll rather than shrinking text beyond readability. Tables preserve a 560px minimum width. Small screens show panning instructions. Scene steps change from four columns to two at 800px; footer columns stack there. The small introductory document mark disappears at 1100px.

**The centered reading Rule.** Center the hero and article at the same maximum width. Keep the chapter rail independent.

## Elevation & Depth

The reading ground, labs, and header are flat. Fine borders and quiet panel colors separate content. The header has no backdrop blur and the primary action has no offset shadow in the approved reader. A chapter preview alone uses the soft shadow 0 12px 28px #00000014 to distinguish it from the article beneath it.

## Shapes

Panels, table rows, and lab controls keep straight edges. Theme and playback controls use the control radius. Chapter previews use the larger preview radius. Lab panels override the inherited clipped corner treatment. Diagram document silhouettes may retain folded or cut corners as explanatory drawing geometry.

## Components

### Header and actions

The sticky header contains the Coconat brand, Source link, theme toggle, Open app action, and a one-pixel reading progress line. The Source link disappears below 600px. The theme defaults to the system scheme; an explicit choice persists in local storage when available. The Open app action uses the contrasting plate and changes to accent on hover. Theme controls use a fine border and accent hover state.

### Chapter rail

Each chapter anchor contains three narrow ticks in a 28px by 24px target. The active middle tick extends to 22px and uses accent. Hover or keyboard focus reveals a rounded text preview, 310px wide with a viewport-based cap; its summary clamps to three lines. Escape and clicking dismiss it. Real fragment links and aria-current retain navigation meaning. Preview motion uses a small 4px translation and 160ms opacity transition; keyboard focus opens it without transition.

### Fields, lab buttons, and tags

Fields use the field-ground token, a fine border, mono text, and the reader's 16px field override. Focus changes the border to accent. Lab buttons retain uppercase mono text, reduced letter spacing, a 12px reader size, and a 40px minimum height. Selected buttons use accent with page-colored text. Solid lab actions use the same fill and weight 600, with accent-hi on hover. Tags show generated tokens as compact bordered mono labels; they are not buttons. Lab panels use ink-1 with responsive internal padding and square corners.

### Engineering scenes

A scene has a fine border, title, Play sequence or Pause sequence control, scrollable SVG, four manual step buttons, live description, and timing note. Scenes start paused. Manual stepping pauses playback. Playback advances at 1900ms per stage and stops after one pass. Offscreen scenes stop advancing and hide transfer playback; they can resume when visible. Hiding the document stops playback. Reduced motion disables playback while preserving manual steps.

Transfer paths draw over 1300ms using the shared ease-out curve. Diagram plate, dot, and fill transitions use 600ms. The active evidence span uses on-accent text and its highlight has no color transition, so the text and background stay legible together.

### Tables and accessibility

Tables use sentence-case labels, fine horizontal rules, and top-aligned cells. Numeric measurement columns use mono text, right alignment, and tabular figures. Scroll regions have accessible names and keyboard focus. Preserve captions and mobile panning hints. The guide has a skip link. Interactive controls use a visible accent outline, 2px wide with a 4px offset. Fragment navigation leaves room below the header. Reduced motion also removes smooth scrolling and scene/preview transitions.

## Do's and Don'ts

### Do:

- Do center hero copy and the article together while keeping text left-aligned.
- Do use the theme-aware color tokens and recompute derived colors on a contrasting plate.
- Do preserve keyboard focus, skip navigation, preview dismissal, and horizontally scrollable tables.
- Do keep scene playback optional, finite, pausable, and inactive offscreen.

### Don't:

- Don't replace local Coconat with an approximate display face.
- Don't turn the narrow tick rail into thumbnail cards.
- Don't restore the inherited offset header shadows or oversized display utilities in this reader.
- Don't use animated emphasis that obscures the active evidence span.
