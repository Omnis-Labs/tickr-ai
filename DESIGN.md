---
name: Hunch It
version: alpha
description: AI trading signals with one-tap execution for tokenized stocks & crypto on Solana. A warm, rounded, mobile-first design system built on an ivory canvas with electric chartreuse accents, soft pastel data colors, pill-shaped controls, and floating circular navigation.
colors:
  background: '#F2EFE8'
  on-background: '#1A1C1E'
  surface: '#FFFFFA'
  surface-dim: '#EEE9DF'
  surface-bright: '#FFFFFA'
  surface-container-lowest: '#FFFFFF'
  surface-container-low: '#F8F6EF'
  surface-container: '#F2EFE8'
  surface-container-high: '#ECE9E2'
  surface-container-highest: '#E6E3DC'
  on-surface: '#1A1C1E'
  on-surface-variant: '#6B6C64'
  inverse-surface: '#1A1C1E'
  inverse-on-surface: '#FFFFFA'
  outline: '#D0CDC5'
  outline-variant: '#E6E3DC'
  primary: '#1A1C1E'
  on-primary: '#FFFFFA'
  primary-container: '#2B2C2E'
  on-primary-container: '#FFFFFA'
  inverse-primary: '#FFFFFA'
  accent: '#D0E906'
  accent-bright: '#D7F20A'
  accent-soft: '#E8F780'
  on-accent: '#1A1C1E'
  accent-container: '#F0FBC0'
  on-accent-container: '#1A1C1E'
  secondary: '#BDEDF4'
  on-secondary: '#1A1C1E'
  secondary-container: '#D8F6FA'
  on-secondary-container: '#25464B'
  secondary-bar: '#A3D9F5'
  tertiary: '#F5C896'
  on-tertiary: '#1A1C1E'
  tertiary-container: '#FCEACC'
  on-tertiary-container: '#422B00'
  positive: '#20BFC6'
  on-positive: '#FFFFFF'
  positive-container: '#CBF5F7'
  negative: '#FF745D'
  on-negative: '#FFFFFF'
  negative-container: '#FFE0DA'
  error: '#BA1A1A'
  on-error: '#FFFFFF'
  error-container: '#FFDAD6'
  on-error-container: '#93000A'
  chart-hatched: '#D8D5CC'
  chart-selected: '#1A1C1E'
  neutral-badge: '#1A1C1E'
  on-neutral-badge: '#FFFFFA'
  icon-muted: '#9A978D'
  divider: '#ECE9E2'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: 700
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: 700
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: 700
    lineHeight: 30px
    letterSpacing: -0.01em
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: 600
    lineHeight: 26px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: 500
    lineHeight: 14px
    letterSpacing: 0.02em
  number-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: 700
    lineHeight: 44px
    letterSpacing: -0.04em
  number-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: -0.03em
  number-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: 700
    lineHeight: 26px
    letterSpacing: -0.02em
rounded:
  xs: 4px
  sm: 8px
  DEFAULT: 12px
  md: 16px
  lg: 20px
  xl: 24px
  2xl: 32px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  DEFAULT: 16px
  lg: 20px
  xl: 24px
  2xl: 32px
  3xl: 40px
  section: 48px
  screen-x: 20px
  screen-top: 16px
  screen-bottom: 24px
  card-padding: 20px
  card-padding-compact: 16px
  card-gap: 14px
  section-gap: 18px
  chart-padding: 20px
  touch-target: 48px
  nav-height: 64px
shadows:
  none: none
  hairline: 0px 1px 0px 0px rgba(26, 28, 30, 0.04)
  micro: 0px 2px 8px 0px rgba(26, 28, 30, 0.06)
  soft: 0px 8px 24px 0px rgba(26, 28, 30, 0.08)
  card: 0px 12px 32px 0px rgba(26, 28, 30, 0.10)
  floating: 0px 16px 40px 0px rgba(26, 28, 30, 0.14)
borders:
  hairline: 1px
  focus: 2px
  color-soft: rgba(26, 28, 30, 0.08)
  color-medium: rgba(26, 28, 30, 0.14)
  color-inverse: rgba(255, 255, 250, 0.24)
motion:
  duration-instant: 80ms
  duration-fast: 150ms
  duration-base: 220ms
  duration-slow: 320ms
  easing-standard: cubic-bezier(0.2, 0, 0, 1)
  easing-soft: cubic-bezier(0.22, 1, 0.36, 1)
  easing-springy: cubic-bezier(0.34, 1.56, 0.64, 1)
  pressed-scale: 0.97
opacity:
  disabled: 0.38
  muted: 0.62
  overlay: 0.72
patterns:
  hatch-angle: -45deg
  hatch-stroke: 2px
  hatch-gap: 6px
  hatch-opacity: 0.18
components:
  card-data:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.lg}'
    padding: '{spacing.card-padding}'
  card-data-compact:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.md}'
    padding: '{spacing.card-padding-compact}'
  card-chart-accent:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.lg}'
    padding: '{spacing.chart-padding}'
  card-chart-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.on-secondary}'
    rounded: '{rounded.lg}'
    padding: '{spacing.chart-padding}'
  segmented-control:
    backgroundColor: '{colors.surface-container-low}'
    rounded: '{rounded.full}'
    height: 44px
    padding: 4px
  segmented-item-active:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.full}'
    height: 36px
    padding: 0 16px
  segmented-item-inactive:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.full}'
    height: 36px
    padding: 0 16px
  icon-button-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.primary}'
    rounded: '{rounded.full}'
    size: 44px
  icon-button-accent:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.full}'
    size: 44px
  icon-button-muted:
    backgroundColor: '{colors.surface-container}'
    textColor: '{colors.primary}'
    rounded: '{rounded.full}'
    size: 44px
  bottom-nav-rail:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.full}'
    height: '{spacing.nav-height}'
    padding: 8px
  bottom-nav-item-active:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.full}'
    size: 48px
  bottom-nav-item-inactive:
    backgroundColor: transparent
    textColor: '{colors.primary}'
    rounded: '{rounded.full}'
    size: 48px
  stat-number:
    textColor: '{colors.on-surface}'
    typography: '{typography.number-xl}'
  stat-label:
    textColor: '{colors.on-surface-variant}'
    typography: '{typography.body-md}'
  chart-bar-accent:
    backgroundColor: '{colors.accent-bright}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.full}'
    width: 28px
  chart-bar-secondary:
    backgroundColor: '{colors.secondary-bar}'
    textColor: '{colors.on-secondary}'
    rounded: '{rounded.full}'
    width: 28px
  chart-bar-tertiary:
    backgroundColor: '{colors.tertiary}'
    textColor: '{colors.on-tertiary}'
    rounded: '{rounded.full}'
    width: 28px
  chart-bar-hatched:
    backgroundColor: '{colors.chart-hatched}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.full}'
    width: 28px
  chart-bar-selected:
    backgroundColor: '{colors.chart-selected}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.full}'
    width: 28px
  chart-tooltip:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label-md}'
    rounded: '{rounded.full}'
    height: 28px
    padding: 0 12px
  badge-positive:
    backgroundColor: '{colors.positive}'
    textColor: '{colors.on-positive}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-negative:
    backgroundColor: '{colors.negative}'
    textColor: '{colors.on-negative}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-neutral:
    backgroundColor: '{colors.neutral-badge}'
    textColor: '{colors.on-neutral-badge}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    padding: 4px 8px
  badge-accent:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    typography: '{typography.label-md}'
    rounded: '{rounded.full}'
    size: 28px
  modal-success:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.xl}'
    padding: 40px 28px
  close-button:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.primary}'
    rounded: '{rounded.full}'
    size: 44px
  section-header-icon:
    backgroundColor: transparent
    textColor: '{colors.on-surface}'
    rounded: '{rounded.full}'
    size: 36px
  legend-swatch-accent:
    backgroundColor: '{colors.accent}'
    rounded: '{rounded.xs}'
    width: 12px
    height: 12px
  legend-swatch-secondary:
    backgroundColor: '{colors.secondary-bar}'
    rounded: '{rounded.xs}'
    width: 12px
    height: 12px
  legend-swatch-hatched:
    backgroundColor: '{colors.chart-hatched}'
    rounded: '{rounded.xs}'
    width: 12px
    height: 12px
---

## Brand & Style

Hunch It is an AI trading signals platform with one-tap execution for tokenized stocks & crypto on Solana. The design language communicates **confidence, clarity, and accessibility** — essential qualities for an app that asks users to act on financial signals in real time.

The visual identity is built on a deliberate tension between a warm, calming canvas and moments of high-energy electric chartreuse. The overall style is **organic-modern**: soft rounded forms, generous whitespace, and a restrained neutral palette that lets data visualizations and action surfaces become the focal points. The personality is optimistic and approachable — closer to a well-crafted consumer app than a traditional trading terminal.

Where most trading interfaces lean into dark themes, dense data tables, and sharp geometry, Hunch It opts for a warm parchment-like ivory background and bubbly rounded shapes. The intent is to make signal-based trading feel calm, intuitive, and rewarding rather than intimidating. The interface should feel like a trusted companion whispering "here's your move," not a wall of blinking numbers.

The design system treats every screen as a vertical stack of rounded card modules floating on a warm canvas. The most important insight on any screen lives inside a bright chartreuse card or as a hero number in a white stat card. The UI avoids dense tables, thin dividers, and clinical dashboards.

## Colors

The palette splits into two layers: a **neutral system** that forms the canvas and structural surfaces, and an **accent system** that brings data and actions to life.

- **Canvas**: A warm ivory/beige (`#F2EFE8`) with a slight parchment undertone. This is the brand signature — it is never pure white, never cool gray, and never green-tinted. Every screen starts from this warmth.
- **Surface Hierarchy**: Cards and containers step through a warm tonal scale from pure white (`#FFFFFF`) for elevated cards down to `#ECE9E2` for recessed containers. The subtle warm shift between canvas and cards creates lift without requiring heavy shadows.
- **Primary Charcoal** (`#1A1C1E`): The sole "heavy" color. Used for active tab fills, selected nav items, chart tooltips, selected chart bars, and primary text. It reads as soft ink rather than harsh black.
- **Electric Chartreuse** (`#D0E906`): The defining accent. Reserved for chart card backgrounds, circular action/arrow buttons, active date indicators, and success badges. It communicates energy, momentum, and opportunity. Paired exclusively with charcoal text and icons — never with white text at small sizes.
- **Pale Cyan** (`#BDEDF4` for card backgrounds, `#A3D9F5` for chart bars): The secondary accent. Used for category overview cards and the second data series in charts. Soft and trustworthy.
- **Warm Peach** (`#F5C896`): The tertiary accent for the third chart bar series. Warm and approachable, not pale gold.
- **Teal** (`#20BFC6`): Used for positive percentage badges on charts (e.g., "+6%", "+9%").
- **Coral** (`#FF745D`): Used for negative/attention percentage badges (e.g., "+8%" caution indicators).

Avoid introducing additional hues. The restraint of four accent colors keeps the interface calm even when displaying dense trading data.

## Typography

The typeface is **Plus Jakarta Sans**, a geometric sans-serif with softened, rounded terminals that harmonizes with the app's bubbly shape language. Its wide x-height ensures legibility at small sizes on mobile.

- **Headlines**: Bold weight (700) with tight negative letter-spacing for page titles ("Report & Analytics", "Expense Tracking"). Headlines are always charcoal on the warm background — never colored, never light-weight. They should feel authoritative and immediately scannable.
- **Numbers**: Financial figures and key metrics use dedicated number typography at bold weight with extra-tight tracking. The hero number on each screen (e.g., "$120.00", "$54.00") must be the single most prominent element — larger than any headline on the same screen.
- **Body & Labels**: Regular weight (400) for descriptive text beneath metrics. Semi-bold (600) for interactive labels inside chips, segmented controls, and section headers.
- **Small Labels**: Chart axis labels, category names, and metadata use smaller body sizes at regular weight to stay secondary to the numbers they annotate.

No italic styles appear in the design. Emphasis is achieved solely through weight and size contrast. Avoid uppercase-heavy UI; prefer sentence case or title case for all interactive elements.

## Layout & Spacing

The layout follows a **single-column card stack** optimized for mobile-first, one-handed use.

- **Screen Padding**: 20px horizontal padding from screen edges on all screens.
- **Grid Rhythm**: A 4px base unit governs all dimensions. The most common increments are 8px (tight element gaps), 12px (within-card spacing), 16px (card internal padding), and 20px (card padding and section separation).
- **Card Stacking**: Screens are composed of vertically stacked rounded card modules — each self-contained around a single data insight (signal overview, category breakdown, performance chart, financial goals). Cards are separated by 14px vertical gaps.
- **Stat Pairs**: Key metrics appear in two-column layouts within white stat cards — e.g., "$54.00 / Total Budget" alongside "12 / Total Goal" — giving equal visual weight to complementary data points. A circular chartreuse arrow button sits at the far right as a detail-navigation affordance.
- **Segmented Controls**: Filter pills ("Weekly / Monthly / Yearly", "All Categories / Automated / Manual") are laid out in horizontal rows within a pill-shaped container using equal distribution.
- **Bottom Navigation**: A floating pill-shaped rail at the bottom of the viewport, containing 5 circular icon items. It overlaps page content as a soft, hovering object anchored to the safe area.

Avoid dense tables, thin dividers, or multi-column data grids. Group related data inside cards and use whitespace and card color for separation.

## Elevation & Depth

Elevation is communicated through **tonal layering and soft color contrast** rather than heavy drop shadows. The overall aesthetic is flat-but-dimensional.

- **Level 0 (Canvas)**: The warm ivory background (`#F2EFE8`).
- **Level 1 (Standard Cards)**: White (`#FFFFFA`) cards sit on the canvas. The warm-to-white tonal shift creates clear lift without shadows.
- **Level 2 (Colored Cards)**: Chartreuse chart cards and cyan category cards occupy the same geometric plane as white cards but use color saturation to become the visual foreground.
- **Level 3 (Modals & Overlays)**: The success modal sits above all content on a light-cyan-tinted overlay. The modal itself uses a white card with extra-large corner radius.
- **Floating (Navigation)**: The bottom tab bar and circular icon buttons cast the softest shadow in the system (`floating` shadow token), reinforcing their "hovering island" feel.

Shadows are always warm-tinted (use `#1A1C1E` as the shadow color source, never cool gray), highly diffused, and low-opacity. Prefer surface-color contrast over borders for separation. Use `outline-variant` only for very subtle definition where a white element sits on another white element.

## Shapes

The shape language is **uniformly rounded, bubbly, and tactile** — mirroring a friendly, consumer-first personality.

- **Cards**: 20px (`rounded-lg`) corner radius for standard data cards. All cards — whether white stat cards, chartreuse chart cards, or cyan category cards — share this radius for visual consistency. Modal cards use a larger 24px radius.
- **Segmented Controls & Chips**: Fully pill-shaped (`rounded-full`). Active segments use charcoal fill with white text; inactive segments use white fill with charcoal text. The container itself is also pill-shaped, creating a "pill-in-a-pill" nesting effect.
- **Action Buttons**: Fully circular (`rounded-full`). The chartreuse arrow buttons and all icon buttons are perfect circles.
- **Chart Bars**: Fully rounded capsules (`rounded-full`) on both ends. Bars are approximately 28px wide with 12px gaps between them, giving charts a soft, illustration-like quality.
- **Tooltips**: Pill-shaped dark capsules that hover above selected chart bars, connected by a small dot anchor.
- **Bottom Tab Bar**: Pill-shaped outer container (`rounded-full`) with circular item targets inside. The active item is a filled dark circle; inactive items are transparent circles with charcoal icons.
- **Date Pagination Chips**: Fully circular 28px indicators with the active date getting a chartreuse fill and charcoal text.
- **Success Badge**: A starburst/rosette shape with chartreuse fill and a charcoal checkmark — the only non-geometric shape in the system, used to celebrate completed actions.

No sharp corners exist anywhere in the UI. The minimum radius is 4px; most interactive elements use `rounded-full`.

## Components

### Data Cards

The primary organizational unit. Each card encapsulates a single data module (signal overview, category breakdown, performance stats, financial goals). White background on the warm canvas, 20px corner radius, 20px internal padding. Every data card includes a section icon (outlined, in a circular container), a bold title, and optional action icons (calendar, arrow) right-aligned in the header row.

### Chart Cards (Chartreuse)

The most visually distinctive element. Chart cards use the full-saturation electric chartreuse (`#D0E906`) as their background, with charcoal text and chart elements drawn on top. Bar charts within use **diagonal hatching patterns** (45-degree angle, 2px stroke, 6px gap) as a secondary fill texture on incomplete/inactive data, adding visual richness without introducing additional colors. The selected bar state is a tall charcoal capsule with a white category label rotated vertically inside it, with a dark pill tooltip showing the value positioned above, connected by a small dot.

### Category Cards (Cyan)

Used for "Top Categories" or secondary data groupings. Pale cyan (`#BDEDF4`) background with charcoal text. Contains category rows with names, values, and circular percentage indicators. Uses the same 20px card radius and padding as all other cards.

### Segmented Controls

Horizontal groups of pill-shaped toggle buttons acting as view filters. The entire control sits inside a subtle pill-shaped container (4px padding). Active item: charcoal fill, white text, 36px height. Inactive items: white fill, charcoal text, same height. Transitions use the `duration-fast` (150ms) timing with `easing-soft`.

### Summary Stat Cards

White rounded cards containing one or two hero numbers in `number-xl` or `number-lg` typography, with muted descriptor labels beneath each number in `body-md`. When metrics appear side-by-side (e.g., "$54.00 Total Budget" | "12 Total Goal"), they share a single card. A circular chartreuse arrow button at the far right links to detail views.

### Chart Bars & Data Visualization

Bars are rounded capsules (28px wide, `rounded-full`). Four data colors: chartreuse (primary series), sky blue (secondary), warm peach (tertiary), and hatched gray (incomplete/inactive). The selected bar becomes a tall charcoal capsule with white vertically-rotated text. Percentage change badges (teal for positive, coral for negative) float around bar tops as small pills.

### Bottom Navigation

A floating white pill container with 5 equally-spaced circular icon targets. Active icon: filled charcoal circle with white icon. Inactive icons: transparent background with charcoal outlined icons. The rail uses `floating` shadow and sits above the home indicator area. Icons are monoline outlined style at 22px with 2px stroke width and rounded caps.

### Success Modal

A centered white card (24px radius) on a light-cyan-tinted overlay. Contains a circular close button (X) at top, a starburst-shaped badge with chartreuse fill and charcoal checkmark, a bold "Successful" headline, and a single line of body text. Sparse and celebratory.

### Percentage Badges

Small pill-shaped tags that float near chart bars showing relative change values. Teal (`#20BFC6`) for positive signals, coral (`#FF745D`) for attention/caution signals, and charcoal for neutral/selected states. Tiny typography (`label-sm`) ensures they remain compact.

### Icon Buttons

Three variants: surface (white background, charcoal icon), accent (chartreuse background, charcoal icon), and muted (warm gray background, charcoal icon). All are perfectly circular, 44px default size (36px small, 52px large). Used for notifications, overflow menus, navigation arrows, and calendar actions.

## Do's and Don'ts

### Do

- Use the warm ivory canvas (`#F2EFE8`) as the default background on every screen — it is the brand signature
- Keep hero numbers as the single largest typographic element on any screen
- Use electric chartreuse exclusively for chart surfaces, action buttons, and positive-moment badges
- Maintain 20px corner radii on all standard cards regardless of content
- Use color-coded cards (chartreuse, cyan) to create visual landmarks in scrollable content
- Apply diagonal hatching inside chart bars for incomplete or inactive data series
- Use fully circular shapes for all action buttons, nav items, and interactive controls
- Make the bottom nav feel like a floating island of circular bubbles inside a pill
- Keep shadows extremely soft, warm-tinted, and minimal

### Don'ts

- Don't use pure white (`#FFFFFF`) or cool gray as the page background — the warm ivory tint is intentional and brand-defining
- Don't introduce accent colors beyond chartreuse, cyan, peach, teal, and coral
- Don't use drop shadows as the primary depth mechanism — rely on warm tonal surface contrast
- Don't apply sharp corners to any element; the minimum radius is 4px and most elements use `rounded-full`
- Don't set hero numbers in anything lighter than bold (700) weight
- Don't use chartreuse as a text color or for non-data-related backgrounds
- Don't crowd cards together — maintain at least 14px vertical gap between stacked cards
- Don't put white text on chartreuse at small sizes — always use charcoal on chartreuse
- Don't make the UI look like a trading terminal or banking admin console — it should feel consumer, friendly, and lightweight
