---
name: Keryx site
description: The keryx-kit public site. Calm, bank-grade, Mercury-like. One real phone carries the story; soft photographic objects stand for the keys.
colors:
  canvas: "#f5f5f3"
  surface: "#ffffff"
  surface-2: "#eeeff1"
  ink: "#17181f"
  ink-2: "#5a5d6b"
  ink-3: "#686b78"
  line: "#e2e3e7"
  line-2: "#cfd1d8"
  accent: "#4b5ce4"
  accent-hover: "#3b4bcf"
  accent-text: "#3f50d6"
  bad: "#b5452f"
  deep: "#15161d"
  deep-card: "#23252f"
  deep-ink: "#ececf2"
  deep-ink-2: "#a2a5b5"
  deep-line: "#2f313c"
  app-bg: "#ffffff"
  app-ink: "#313131"
  canvas-dark: "#101117"
  surface-dark: "#181920"
  surface-2-dark: "#20212a"
  ink-dark: "#ececf2"
  ink-2-dark: "#a3a6b4"
  ink-3-dark: "#8a8d9b"
  line-dark: "#262832"
  line-2-dark: "#363844"
  accent-dark: "#5464e6"
  accent-hover-dark: "#4555d6"
  accent-text-dark: "#9aa4ff"
  bad-dark: "#f0846c"
  deep-dark: "#0b0c10"
  app-bg-dark: "#101013"
  app-ink-dark: "#f2f2f4"
typography:
  display:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 1.5rem + 3.3vw, 4.5rem)"
    fontWeight: 480
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.25rem + 1.8vw, 3rem)"
    fontWeight: 480
    lineHeight: 1.1
    letterSpacing: "-0.018em"
  step:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.3vw, 2.5rem)"
    fontWeight: 480
    lineHeight: 1.1
  verdict:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.6rem + 2vw, 3.5rem)"
    fontWeight: 460
    lineHeight: 1
  title:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.125rem, 1.05rem + 0.2vw, 1.25rem)"
    fontWeight: 520
    lineHeight: 1.3
  lede:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.125rem, 1rem + 0.4vw, 1.375rem)"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 520
    lineHeight: 1.45
  caption:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, monospace"
    fontSize: "0.92em"
    fontWeight: 400
rounded:
  mark: "4px"
  control: "12px"
  card-small: "14px"
  card: "18px"
  panel: "22px"
  stage: "24px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 4vw, 48px)"
  wrap: "min(1200px, 100% - 2 * gutter); 1320px from 1680px wide"
  section: "clamp(88px, 11vw, 168px)"
  head-gap: "clamp(36px, 5vw, 64px)"
components:
  pill-accent:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 24px"
  pill-glass:
    backgroundColor: "rgb(255 255 255 / 0.55)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "28px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  band:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.deep-ink}"
  phone:
    width: "clamp(250px, (100svh - 160px) * 0.44, 380px)"
---

# Design System: Keryx site

## Overview

**Creative North Star: "Proof on the device"**

The page is calm, quiet and expensive-looking, in the language of mercury.com: a soft photographic landscape behind a centred headline, generous whitespace, a refined sans at light weights, a muted palette with one restrained indigo, and soft frosted 3D objects on a dark band for the security ideas. Inside that calm sits one real product object: a phone running the actual Keryx app. It stays on screen while the page scrolls through four states (scan, confirm the domain, a signed post arrives, a forgery never shows), with one sentence beside each, like the sticky device on trezor.io.

Everything persuasive is real or labelled: app captures from the real subscriber app paired with a locally signed Scuffwell repo, the real keryx-kit console editor, and a signature check that runs in the visitor's browser. The recreations (the greyed-out forgery and the small feed beside the signature check) are captioned as such.

## Colors

A cool off-white canvas, white surfaces, a near-black ink with two quieter greys, and one indigo accent close to the Keryx app's own blue. A dark navy band carries the security section in both themes.

- **Accent** (`#4b5ce4`, dark `#5464e6`): the primary pill, the verified state, the signature check's "Shown". Nothing else.
- **Bad** (`#b5452f`, dark `#f0846c`): only look-alike characters, edited characters, "not shown" verdicts and form errors.
- **Deep** (`#15161d`, dark `#0b0c10`) with **deep-card** `#23252f`: the security band and the object cards. The generated objects are rendered on exactly `#23252f`, so the cards and images meet without a seam.
- Text greys: ink-2 for body copy, ink-3 for captions, all at 4.5:1 or better on their surfaces.

### Named Rules

**One accent.** Indigo marks the action and the verified state, never decoration.

**The dark band is the only dark section** on a light page; the pilot section returns to the landscape photograph.

## Typography

Hanken Grotesk (variable, self-hosted) for everything, at Mercury-like light weights: 480 for display and headlines, 520 for small titles, 400 for body. Geist Mono only for domains, paths, key IDs and fingerprints. From 1680px wide the root grows to 112.5% so the page presents well on a 1920×1080 screen.

### Hierarchy

Display (hero only) → headline (one per section) → step (scroll story) → title (cards and lists) → lede (the one sentence under a headline) → body → caption.

### Named Rules

**Headline plus one sentence.** Every section opens with a plain sentence as the headline and at most one sentence under it. No kickers, eyebrows or section numbers.

## Layout

Centred hero over the photograph; afterwards, left-aligned section heads on a 1200px wrap (1320px on large screens) with generous section spacing. The scroll story is a three-column grid (copy, phone, copy) whose steps alternate sides and are each one viewport tall; the phone is sticky in the middle column. Under 900px the story stacks: each step shows its own phone image under its copy.

## Elevation & Depth

Soft, offset, neutral shadows only: the phone (a long diffuse drop), floating UI fragments (the verified note, the "Sign and publish" card), the form panel. No coloured glows.

## Shapes

Pills for buttons, 12px controls, 14 to 24px cards and panels, a drawn phone frame with a dynamic island and a status bar.

## Components

### Phone
A CSS-drawn frame around real 390×797 app captures under a 47px status bar (9:41, signal, Wi-Fi, battery). Light and dark captures switch with `prefers-color-scheme` through `<picture>`. In the story, the screens crossfade (420ms) and the verified note slides in beside the feed state.

### Signature check showcase
A Scuffwell post signed with a local demo author key, a verdict panel and a small recreated phone feed, side by side in one card (stacked under 900px). A drawn pointer selects "20%" in the title and types "70%"; every keystroke goes through the real Ed25519 check (`@keryx-kit/domain`), and its result alone switches the verdict between "Shown" and "Not shown" and drops the post from the phone's feed. Nothing is editable by the visitor. The stage is `aria-hidden`; a visually hidden sentence states the real results.

### Product shot
The real console editor in a browser frame on the landscape photograph, with the real "Sign and publish" card floating over its lower left.

### Key cards
Three 4:5 cards on the dark band, each a generated frosted object (hardware device, fingerprint disc, wax seal) above a title and one sentence. On short screens the images crop to squares.

## Imagery

- **Landscape**: misty layered hills, a pale dawn version for light and a blue-hour version for dark, generated, used behind the hero, the product shot and the pilot form.
- **Objects**: soft frosted white objects with fine grain on `#23252f`, generated, no logos or text.
- **Screens**: real captures only, except the captioned illustration of the rejected forgery and the small feed recreation beside the signature check.

## Motion

Two authored moments. The story: the phone's screen change and the step copy fading in as each step reaches the middle of the viewport. The signature check: a calm loop (about 10 seconds) of pointer, selection, typing, verdict flip, the post fading and collapsing out of the feed, a pause, and a reset in which the title, verdict and feed fade out and return together; it plays only while the card is at least half on screen and the tab is visible, and starts over from the signed state. Under `prefers-reduced-motion: reduce` there are no transitions and no smooth scrolling, and the signature check shows a static pair instead: the signed post ("Shown") above the edited one ("Not shown"). Without JavaScript all step copy is visible and the phone shows the first state.

## Do's and Don'ts

### Do:
- **Do** keep the phone the hero: the largest, sharpest object on the first screens.
- **Do** keep copy to a headline and one sentence per section.
- **Do** label anything recreated or demo-signed, in a caption at caption size.
- **Do** state the hosted-JavaScript caveat beside the key custody claims.

### Don't:
- **Don't** invent customers, logos, testimonials, statistics or certifications.
- **Don't** add eyebrows, numbered labels, gradient text, coloured glows or decorative icons.
- **Don't** use red for anything but look-alike, rejected or error states.
- **Don't** show the Trezor logo or brand shapes; the hardware object stays generic.
