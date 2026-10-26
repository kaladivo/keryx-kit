---
name: Keryx site
description: The keryx-kit public site. White paper, near-black ink, one saturated blue, real screens and real signed files as the proof.
colors:
  paper: "#ffffff"
  paper-2: "#f2f2f7"
  ink: "#0e0e1a"
  ink-2: "#4b4b5f"
  rule: "#d5d5e0"
  rule-strong: "#0e0e1a"
  blue: "#0000e0"
  field: "#0000e0"
  on-field: "#ffffff"
  on-field-2: "#d6d8ff"
  bad: "#c3102e"
  bad-wash: "#fde8eb"
  paper-dark: "#0b0b12"
  paper-2-dark: "#16161f"
  ink-dark: "#ececf3"
  ink-2-dark: "#a9a9bc"
  rule-dark: "#2d2d3c"
  blue-dark: "#9ea1ff"
  link-dark: "#a9acff"
  field-dark: "#1414b4"
  on-field-2-dark: "#d2d4ff"
  bad-dark: "#ff7186"
  bad-wash-dark: "#3a1219"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 0.8rem + 3.9vw, 4.75rem)"
    fontWeight: 750
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  verdict:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 2.4vw, 3.75rem)"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.25rem + 2.4vw, 3.5rem)"
    fontWeight: 750
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "clamp(1.1875rem, 1.05rem + 0.35vw, 1.375rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "clamp(1.1875rem, 1rem + 0.55vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.45
  mono:
    fontFamily: "Atkinson Hyperlegible Mono Variable, Atkinson Hyperlegible Mono, ui-monospace, monospace"
    fontSize: "0.92em"
    fontWeight: 400
rounded:
  none: "0px"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  column-gap: "clamp(16px, 2vw, 32px)"
  section: "clamp(72px, 9vw, 136px)"
  row: "12px"
  stack: "16px"
  block: "20px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-on-field:
    backgroundColor: "{colors.on-field}"
    textColor: "{colors.field}"
    rounded: "{rounded.none}"
    padding: "0 22px"
    height: "48px"
  button-on-field-hover:
    backgroundColor: "{colors.on-field-2}"
    textColor: "{colors.field}"
  button-small:
    typography: "{typography.label}"
    padding: "0 16px"
    height: "40px"
  text-link:
    textColor: "{colors.blue}"
    typography: "{typography.body}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
    height: "48px"
  step-marker:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    size: "34px"
  specimen:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "clamp(20px, 3vw, 40px)"
  band:
    backgroundColor: "{colors.paper-2}"
    padding: "clamp(72px, 9vw, 136px) 0"
  form-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "clamp(20px, 3vw, 40px)"
---

# Design System: Keryx site

## Overview

**Creative North Star: "The Proof Sheet"**

The site reads like a Swiss identity-program page that has been turned into a test report. White paper, near-black ink and one saturated blue do all the work. The argument is carried by real things: a screenshot of the actual app, the actual signed JSON file, a signature check that runs in the visitor's browser, the join kit file list, the key custody table. Prose describes them in short sentences and states the limits in the same breath.

Type size and weight make the hierarchy. Headings are plain labels or plain sentences in a heavy grotesk, set flush left on a 12-column grid. There is nothing above a heading: no kicker, no section number, no badge, no icon. Rules are hairlines; corners are square; the page is flat. Colour changes only where it means something: blue for the opening and the close and for things that check out, red for things that fail or deceive.

This system replaces an earlier round the owner rejected as generic: italic serif display lines, kicker labels, numbered section labels, a beige and terracotta palette, and decorative herald illustration. None of that comes back.

**Key Characteristics:**
- White paper, blue-black ink, one saturated blue; red reserved for failure.
- Two blue fields only: the opening (masthead and hero) and the close (pilot request).
- One grey band directly under the hero: the live signature specimen.
- Atkinson Hyperlegible Next for everything; Atkinson Hyperlegible Mono only for real data.
- Real app screenshots, never illustrations or device mockups.
- Limits sit beside the claims they qualify, at body size.
- Square corners, 1px hairlines, 3px strong rules. One motion moment.

## Colors

A cool, almost colourless neutral set with one fully saturated blue and one red that only appears when something is rejected.

### Primary
- **Signal Blue** (`blue`, also `field`): the primary action colour, link colour, focus ring, the step chain and step markers, the "Valid" and "Shown" states, and the full-bleed field behind the opening and the close. In dark mode it splits: the field deepens to **Night Field Blue** (`field-dark`) so white text keeps its contrast, while actions and links lift to **Lifted Blue** (`blue-dark`) and **Lifted Link Blue** (`link-dark`) so they read on near-black paper.
- **Field White** (`on-field`): text and the primary button fill on the blue field.
- **Pale Field Blue** (`on-field-2`, `on-field-2-dark`): ledes, captions, fine print and the on-field button hover. Secondary text on the field is this tint, never a grey.

### Tertiary
- **Reject Red** (`bad`, `bad-dark`): a failed author signature, the "Not shown" verdict, the substituted characters in a look-alike domain, form field errors and error status lines.
- **Reject Wash** (`bad-wash`, `bad-wash-dark`): the background of the signature panel once the verdict is "Not shown", and the highlight behind look-alike characters.

### Neutral
- **White Paper** (`paper`, `paper-dark`): the page background, the specimen and the pilot form panel.
- **Specimen Grey** (`paper-2`, `paper-2-dark`): the one full-width band, behind the live signature check.
- **Blue-Black Ink** (`ink`, `ink-dark`): body text and headings; also the hover fill of the primary button.
- **Slate Ink** (`ink-2`, `ink-2-dark`): intros, asides, captions, hints, the losing column of the email comparison, and input borders.
- **Hairline Grey** (`rule`, `rule-dark`): 1px row dividers in tables, lists and ledgers, and the hairline between sections.
- **Strong Rule** (`rule-strong`): equals ink in both themes. Used for table head underlines (2px), the 3px top rule on role columns, install options, the caveat and ledger columns, and the specimen frame (1px).

### Named Rules
**The Two Fields Rule.** The blue field appears twice per page: behind the masthead and hero, and behind the closing pilot request. Everything between sits on paper. Never use the blue field for a mid-page section, a card or a callout.

**The Red Means Rejected Rule.** Red appears only for a rejected or deceptive state: a failed signature, a hidden message, a look-alike character, an invalid field. It is never emphasis, decoration or a brand accent.

**The Blue Means Valid Rule.** Inside the specimen, blue is the colour of a signature that checks out and a message that is shown. Do not use green for success.

## Typography

**Display Font:** Atkinson Hyperlegible Next (variable, self-hosted via `@fontsource-variable/atkinson-hyperlegible-next`, falling back to system-ui)
**Body Font:** Atkinson Hyperlegible Next
**Label/Mono Font:** Atkinson Hyperlegible Mono (variable, self-hosted via `@fontsource-variable/atkinson-hyperlegible-mono`, falling back to ui-monospace)

**Character:** One legibility-first grotesk at every size, pushed to weight 750 and tight tracking for headlines so it reads as poster type, with its mono sibling for identifiers. Both are bundled; there are no runtime font requests.

### Hierarchy
- **Display** (750, `display`): the hero headline on both pages, two to three lines at poster scale on the blue field.
- **Verdict** (750, `verdict`): the "Shown" / "Not shown" word in the signature specimen. The only display-scale text outside the hero.
- **Headline** (750, `headline`): section headings. The closing "Request a pilot" heading is 1.15 times this size with 0.98 line height.
- **Title** (700, `title`): step, role, caveat and ledger column headings.
- **Lede** (400, `lede`): hero lede (max 34em), section intros (max 40em), and the cells of the email comparison.
- **Body** (400, `body`): running text. Paragraphs cap between 26em and 38em.
- **Label** (600 to 700, `label`): navigation, table column heads, captions, field errors, the footer. Sentence case, no letter-spacing, never uppercase.
- **Mono** (400, `mono`, relative to its context; key IDs drop to 0.8125rem): domains, URLs, file paths, file names, key IDs, certificate fingerprints, device strings.

The wordmark is "Keryx" in the body face at 1.5rem, weight 800, tracking -0.02em. It is text, not a logo image.

### Named Rules
**The Real Data Rule.** Monospace is reserved for strings a person might copy or compare: `example.com`, `/.well-known/keryx/root.json`, `key 11a71290…a95e7a`, a SHA-256 fingerprint. Never set headings, labels, numbers-for-effect or decorative "code" in mono.

**The Plain Label Rule.** A heading is a plain label ("Install the app") or a plain sentence ("Email can't prove who sent it."). Nothing sits above it: no kicker, no eyebrow, no section number. Hierarchy comes from size and weight alone.

**The Limits at Claim Size Rule.** A limit sits next to the claim it qualifies, in the same type size. The "What this does not cover" caveat stands beside the key table at body size; "Can't protect" is a full column beside "Protects", with identical type. Never move limits to a footnote or shrink them.

## Layout

A 12-column grid inside a 1360px container, with fluid side gutters (`gutter`) and a fluid column gap (`column-gap`). Sections are separated by generous vertical space (`section`) and a 1px hairline inset to the gutters. Content is flush left; nothing is centred.

The opening field puts the copy in columns 1 to 7 and the app screenshot in columns 9 to 12. Paired content uses the same split: the key table (columns 1 to 7) beside the caveat (9 to 12); pilot copy (1 to 5) beside the form panel (7 to 12); join steps (1 to 6) beside the confirm screen (7 to 12); two equal install options; two equal ledger columns. Three-up rows (steps, roles) use equal thirds and do not wrap on wide screens.

Directly under the hero sits the page's one full-width band, in Specimen Grey: the live signature specimen. The section after it drops its top hairline.

Responsive behaviour, by observed breakpoint:
- **1100px:** the hero copy widens to 8 columns; the key table and the caveat stack full width (caveat capped at 44em).
- **860px:** optional nav links hide, leaving the essential links, the theme toggle and the primary button. Every split stacks to one column. The hero screenshot caps at 320px under the copy. Three-up rows become one column, and the horizontal step chain becomes a vertical spine on the left. The specimen stacks its message above its signature panel.
- **640px:** comparison and key tables turn into stacked rows, each value prefixed by its column label in small Slate Ink.

### Named Rules
**The One Band Rule.** Between the two blue fields, the only full-width change of tone is the Specimen Grey band holding the live check. Do not add more banded sections.

**The Chain Rule.** Sequential steps hang from one 3px Signal Blue line: across the top of the row on wide screens, down the left as a spine under 860px. Each step number is a small filled blue square sitting on that line.

## Elevation & Depth

The system is flat. Depth comes from tone (paper, Specimen Grey band, blue field) and from rules, not from shadows. There is one shadow: the app screenshot standing on the blue field gets a soft drop shadow so the white screen separates from the blue. On paper, screenshots get a 1px hairline frame instead.

### Shadow Vocabulary
- **Screen on field** (`box-shadow: 0 24px 48px -24px rgb(0 0 40 / 0.55)`): only under an app screenshot placed on the blue field.
- **Invalid field** (`box-shadow: inset 0 0 0 1px var(--bad)`): thickens an invalid input's red border to 2px. A border treatment, not elevation.

### Named Rules
**The Flat Paper Rule.** Nothing on paper casts a shadow: no cards, no lifted panels, no hover lift. The only shadow in the system is the screen-on-field shadow.

## Shapes

Every corner is square (`rounded.none`): buttons, inputs, the specimen, the form panel, step markers, screenshots. Lines come in three weights: a 1px hairline (`rule`) between rows and sections, a 2px strong rule under table heads, and a 3px strong rule (ink, or blue for step chains) across the top of a column to open a group. There are no cards; grouping is done with these top rules and whitespace.

### Named Rules
**The Square Corner Rule.** Border radius is 0 everywhere, including form controls (set explicitly to override browser defaults).

**The Top Rule Rule.** A group of content opens with a rule across its top, never with a box around it or a stripe down its side.

## Components

### Buttons
Solid, square and heavy-weighted; one primary action per area.
- **Shape:** square corners, minimum height 48px (40px for the small masthead button).
- **Primary:** Signal Blue fill, White Paper text, weight 700, 22px side padding.
- **On the blue field:** inverted to a white fill with blue text; hover tints to Pale Field Blue.
- **Hover / Focus:** primary hover fills with Blue-Black Ink over 160ms. Focus is a 3px outline offset 3px, in Signal Blue on paper and white on the field. Disabled ("Sending…") fills with Slate Ink.
- **Text link (secondary action):** a weight-600 link with a 1px underline offset 0.25em that thickens to 2px on hover. Used for the secondary hero action, "Restore the original title" and similar.

### Inputs / Fields
- **Style:** 1px Slate Ink border, square, White Paper fill, 48px minimum height, 10px 12px padding, inherited body type. Labels sit above in weight 700; optional fields carry a plain "(optional)" hint in Slate Ink.
- **Focus:** the global 3px Signal Blue outline.
- **Error:** border and an inset 1px shadow in Reject Red, with a weight-600 small red message below.

### Navigation
- **Style:** a masthead on the blue field. Wordmark left; links right in label size, weight 600, no underline until hover. The theme toggle (a 20px half-filled circle, the only drawn mark on the site) sits before the small primary button "Request a pilot".
- **Mobile:** links marked optional hide under 860px; essential links, the toggle and the button stay.

### Tables and ledgers
Data is shown as real tables with hairline rows: the email versus Keryx comparison (the email column in Slate Ink, the Keryx column in weight 700, both at lede size) and the key custody table. Definition-list ledgers (Protects / Can't protect) open each column with a 3px strong rule under its title.

### Signature specimen (signature component)
A 1px ink-framed panel on White Paper inside the grey band. A file bar names the real JSON file in mono and states its provenance. The left part (7 of 12) is an editable title textarea in 700 weight with square 1px border; the right part (5 of 12), divided by a 1px ink rule, lists each author with its key ID in mono and a state ("Valid" in blue, "Fails" in red), then the verdict word at `verdict` size. When the verdict flips to "Not shown", the right panel fills with Reject Wash.

### Look-alike domain list
Domains in mono at 1.375rem, weight 700. The real address is plain; in each look-alike, only the substituted characters are marked with Reject Wash, red text and a 2px underline. A small Slate Ink line underneath explains the trick.

### App screenshots
Real captures of the Keryx app, swapped for light and dark versions with the theme, each with a caption in small type that says it is a real screen and what it is paired with. No device frame.

### Named Rules
**The Real Screen Rule.** Imagery is real app screenshots in a figure with a caption saying so. No illustrations, no device mockups, no stock or generated art.

**The One Motion Rule.** The only motion is the verdict wipe: when the verdict changes, the word is revealed left to right with a clip-path over 420ms on `cubic-bezier(0.16, 1, 0.3, 1)`. Button colour transitions are 160ms. Under `prefers-reduced-motion: reduce`, both are off and smooth scrolling is disabled.

## Do's and Don'ts

### Do:
- **Do** keep the blue field to the opening and the close, with white type and Pale Field Blue secondary text on it.
- **Do** put the real thing first: the real screen, the real signed file, the live check, the actual file names.
- **Do** set domains, paths, key IDs and fingerprints in Atkinson Hyperlegible Mono, and nothing else.
- **Do** write headings as plain labels or plain sentences, flush left, weight 750.
- **Do** state each limit beside the claim it qualifies, at the same type size.
- **Do** open a group with a top rule (3px ink, or 3px blue for a step chain) and divide rows with 1px hairlines.
- **Do** keep corners square, including inputs and textareas.
- **Do** provide both light and dark values for every colour, honouring `prefers-color-scheme` and the `data-theme` toggle.

### Don't:
- **Don't** reintroduce the rejected look: italic serif display lines, kicker or eyebrow labels, numbered section labels, beige or terracotta, decorative illustration.
- **Don't** use red for anything but rejected, failed or look-alike states.
- **Don't** add icons, badges or glyph decorations; the theme toggle is the only drawn mark.
- **Don't** use cards, rounded corners, side-stripe borders, hard offset shadows or gradient text.
- **Don't** show device mockups or illustrations in place of real screenshots.
- **Don't** add a second motion moment, scroll-triggered reveals or hover lift.
- **Don't** add a second grey band or a mid-page blue section.
- **Don't** shrink a limit into a footnote or fine print.
