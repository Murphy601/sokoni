---
name: Sokoni
description: Kenya's WhatsApp marketplace — warm, direct, pay on delivery.
colors:
  primary: "#25D366"
  on-primary: "#1B1035"
  secondary: "#1B1035"
  on-secondary: "#FFF8F0"
  surface: "#FFF8F0"
  on-surface: "#1B1035"
  surface-elevated: "#FFFFFF"
  muted: "#5c5470"
  accent-soft: "#2E1B57"
  whatsapp-header: "#075E54"
  whatsapp-bubble-in: "#FFFFFF"
  whatsapp-bubble-out: "#DCF8C6"
  whatsapp-chat-bg: "#ECE5DD"
typography:
  display:
    fontFamily: Fraunces
    fontSize: 3.5rem
    fontWeight: "700"
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline:
    fontFamily: Fraunces
    fontSize: 2rem
    fontWeight: "700"
    lineHeight: 1.2
  body-lg:
    fontFamily: "DM Sans"
    fontSize: 1.125rem
    fontWeight: "400"
    lineHeight: 1.65
  body-md:
    fontFamily: "DM Sans"
    fontSize: 1rem
    fontWeight: "400"
    lineHeight: 1.6
  label:
    fontFamily: "DM Sans"
    fontSize: 0.875rem
    fontWeight: "600"
    lineHeight: 1.4
  caption:
    fontFamily: "DM Sans"
    fontSize: 0.75rem
    fontWeight: "500"
    lineHeight: 1.45
rounded:
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  section: 64px
components:
  button-whatsapp:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 12px 24px
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.pill}"
    padding: 12px 24px
  chat-preview:
    backgroundColor: "{colors.whatsapp-chat-bg}"
    headerColor: "{colors.whatsapp-header}"
    bubbleIn: "{colors.whatsapp-bubble-in}"
    bubbleOut: "{colors.whatsapp-bubble-out}"
  card-product:
    backgroundColor: "{colors.surface-elevated}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  input-search:
    backgroundColor: "{colors.surface-elevated}"
    rounded: "{rounded.xl}"
    padding: 16px 20px
  badge-cod:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
---

## Overview

Sokoni should feel like **texting a trusted local shop assistant** — not browsing a corporate mall app or a generic SaaS landing page.

The reference is a **countrywide Kenyan market on WhatsApp**: direct, warm, honest about delivery and payment, comfortable in English, Kiswahili, and Sheng. Shoppers anywhere in Kenya — major towns, smaller centres, pickup partners — should feel the site was written for them, not for one city.

**Atmosphere:** approachable, conversational, lightly energetic. Cream backgrounds like morning market light. Purple ink for trust and readability. WhatsApp green reserved for **actions only** (order, chat, pay).

**Density:** generous whitespace on marketing sections; compact but legible inside product cards. Mobile-first — most visitors arrive on phone and leave via WhatsApp.

## Colors

- **Primary ({colors.primary}):** WhatsApp green. CTAs, order buttons, chat links, success states. Never use as large background fills.
- **On-primary ({colors.on-primary}):** Dark purple text on green buttons — high contrast, readable outdoors.
- **Surface ({colors.surface}):** Warm cream page background. Softer than pure white; feels human, not clinical.
- **On-surface ({colors.on-surface}):** Deep purple for headings and body. Warmer than pure black.
- **Surface elevated ({colors.surface-elevated}):** White cards that lift off cream — product tiles, forms.
- **Muted ({colors.muted}):** Secondary copy, metadata, captions.
- **Accent soft ({colors.accent-soft}):** Feature bands, footer, dark-mode elevated surfaces.
- **WhatsApp chat tokens:** Header `{colors.whatsapp-header}`, bubbles and `{colors.whatsapp-chat-bg}` — use only in chat mockups and tracking previews so the hero feels familiar, not decorative.

## Typography

**Fraunces** carries display headlines — friendly serif warmth without feeling old-fashioned. **DM Sans** carries UI and body — rounded, readable on small screens.

| Role | Font | Use |
|------|------|-----|
| Display | Fraunces 700 | Hero h1, major section titles |
| Headline | Fraunces 700 | h2, card titles in features |
| Body | DM Sans 400 | Paragraphs, descriptions |
| Label | DM Sans 600 | Buttons, nav, form labels |
| Caption | DM Sans 500 | Badges, footnotes, legal hints |

- Headlines: short, spoken phrases — not slogan stacks of adjectives.
- Body: line-height ≥ 1.6; never wall-of-text feature grids.
- Avoid ALL-CAPS except tiny badges (e.g. PAY ON DELIVERY).

## Layout

- Max content width **80rem** (`max-w-7xl`), centred, **16–24px** horizontal padding on mobile.
- Section vertical rhythm: **64px** (`py-16`–`py-20`) between major bands.
- Product grids: 2 columns mobile, 4 desktop; cards equal height with CTA pinned bottom.
- Chat mockup: single column hero companion — authentic WhatsApp proportions, not a floating phone gimmick with fake stats.

## Elevation & Depth

- Cards: light border `black/5`, soft shadow on hover (`translateY(-4px)`), green-tinted shadow in dark mode.
- No glassmorphism, no heavy gradients behind text, no neon glow except subtle green on primary CTAs.
- Feature section on purple: `white/5` panels with `white/10` borders — layered, not flat.

## Shapes

- **Pills** (`rounded-full`): all primary and secondary buttons, COD badges.
- **xl rounded** (`rounded-2xl` / `1.5rem`): product cards, review form, search input.
- **Chat bubbles:** `rounded-2xl` with one square corner (WhatsApp convention).

## Components

### button-whatsapp
Green fill, dark purple label, pill shape. Labels are verbs people say: "Start on WhatsApp", "Order — pay on delivery", "Ask Sokoni". Icon 💬 optional, not required on every instance.

### button-secondary
Outline or ghost on cream/purple bands. Never competes visually with WhatsApp CTA on the same row.

### card-product
White card, COD badge top-left, image, title (2-line clamp), price in bold KES, rating line, primary order link + secondary "Ask about it" text link.

### input-search
Large touch target, placeholder examples in plain language ("camera phone chini ya 15k"). Focus ring green.

### badge-cod
Small pill: "Pay on delivery" — always visible on store items.

### Chat preview blocks
Use exact WhatsApp background and bubble colours from tokens. Copy must sound like real messages (Sheng/English mix OK).

## Do's and Don'ts

**Do**
- Write like a helpful person texting back — "Sawa", "Karibu", "pay when it arrives".
- Mention **countrywide** delivery and **pickup partners** where relevant — not one city.
- Keep M-Pesa Till details factual (4475847, DAVID MUIRURI) when discussing payment.
- Show real order IDs (SK-xxxx) and tracking timelines in examples.
- Prefer short paragraphs and one idea per feature card.

**Don't**
- Don't say "seamless", "leverage", "ecosystem", or "world-class".
- Don't use stock SaaS hero patterns (fake metrics, gradient orbs as the main story).
- Don't plaster green on backgrounds — green is for action.
- Don't promise instant delivery everywhere — be honest about timelines and pickup.
- Don't use location-specific strategy (no single-city focus in marketing copy).
- Don't break WhatsApp deep links or bot API URLs when restyling.

## Responsive Behavior

- Nav collapses to essentials on mobile; WhatsApp CTA always visible in header.
- Touch targets ≥ **44px** height on buttons and category chips.
- Hero: single column on mobile (copy first, chat mock second).
- Product grid: 2-up on `sm`, 4-up on `lg`.
- Dark mode: respect `prefers-color-scheme` and manual toggle; cream → charcoal, cards elevated.

## Agent Prompt Guide

Before generating or editing any file under `website/`:

1. Read this `DESIGN.md` and `.cursor/skills/sokoni-design/SKILL.md`.
2. Run `npm run design:lint` after token changes.
3. Prefer semantic classes backed by `design-tokens.css` variables.
4. Pilot changes on `index.html`, then roll to subpages.

**Prompts that work:**
- "Add a pickup-points callout following Sokoni DESIGN.md — conversational, countrywide."
- "Restyle the review form per card-product and input-search tokens."
- "Rewrite hero copy: trusted shop assistant voice, no corporate adjectives."

**Reference brands (slices only, never clone):** Intercom → conversational layout; Wise → payment clarity and friendly green discipline.
