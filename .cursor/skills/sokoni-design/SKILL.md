---
name: sokoni-design
description: Sokoni website design system — human WhatsApp marketplace voice, tokens, components, and quality gates. Use when editing any file under website/.
---

# Sokoni Design Skill

## Mission

You maintain the Sokoni storefront (`website/`) so it feels like **texting a trusted local shop assistant** — warm, direct, honest — for shoppers **countrywide across Kenya**. Read `website/DESIGN.md` before any visual or copy change.

## Brand voice

- Conversational, not corporate. Short sentences. Real examples (SK-xxxx, M-Pesa Till, pickup partners).
- English, Kiswahili, and Sheng are welcome where natural.
- **Never** anchor marketing to a single city or region — Sokoni serves Kenya broadly (home delivery + pickup points).
- **Never** use hollow adjectives: seamless, leverage, ecosystem, world-class, cutting-edge.

## Style foundations

| Token | Value | Rule |
|-------|-------|------|
| Primary | `#25D366` | Actions only — buttons, chat CTAs, badges |
| Surface | `#FFF8F0` | Page background (cream) |
| On-surface | `#1B1035` | Headings and body |
| Display font | Fraunces | h1, major h2 |
| Body font | DM Sans | UI, paragraphs, forms |

Spacing: 8px base grid. Section gaps 64px. Product cards use `card-product` pattern from DESIGN.md.

## Component families

1. **button-whatsapp** — pill, green, dark text. Verbs: "Start on WhatsApp", "Order — pay on delivery".
2. **button-secondary** — outline/ghost; never outshine primary CTA on same row.
3. **card-product** — COD badge, image, title, KES price, order + ask links.
4. **input-search** — large, plain-language placeholder, green focus ring.
5. **chat-preview** — WhatsApp colours from DESIGN.md tokens only.

After injecting HTML via JS, call `SokoniComponents.upgradeIn(container)` so product cards get consistent behaviour.

## Accessibility (WCAG 2.2 AA)

- Contrast: purple on cream and dark text on green buttons must pass AA.
- Focus-visible rings on all interactive elements.
- Touch targets ≥ 44px on mobile.
- `prefers-reduced-motion`: disable hover scale animations.
- Form inputs: associated `<label>` or `sr-only` label.

## Writing tone

- concise, confident, helpful
- Prefer "pay when it arrives" over "cashless seamless checkout"
- Mention pay on delivery, M-Pesa Till 4475847, and pickup where payment is discussed

## Rules: Do

- Read `website/DESIGN.md` first
- Use CSS variables from `website/assets/css/design-tokens.css`
- Keep `wa.me` links and `bot.sokonimall.com` API URLs working
- Run `npm run design:lint` after editing DESIGN.md
- One section at a time when refactoring pages

## Rules: Don't

- Don't change `whatsapp-bot/` when doing website design work
- Don't replace Tailwind CDN with a build pipeline unless explicitly requested
- Don't clone Stripe/Apple/Shopify DESIGN.md files wholesale
- Don't remove dark mode or theme toggle behaviour
- Don't break product search, reviews API, or category filters in `app.js`

## Quality gates

- [ ] Copy sounds like a person, not a landing-page template
- [ ] Green used only for actions
- [ ] No single-city geographic focus in user-facing text
- [ ] Fonts: Fraunces (display) + DM Sans (body)
- [ ] WhatsApp CTA visible above fold on mobile
- [ ] `design:lint` passes if DESIGN.md changed

## Workflow

1. Restate design intent in one sentence.
2. Check DESIGN.md tokens and Do/Don'ts.
3. Implement HTML/CSS/JS change minimal to scope.
4. If JS adds DOM nodes with `.product-card`, call `SokoniComponents.upgradeIn(parent)`.
5. Verify links: WhatsApp, search, reviews form.

## Reference slices (adapt, don't copy)

- **Intercom** — conversational blocks, chat-first hierarchy
- **Wise** — payment trust, clear amounts, friendly discipline with green

Fetch via getdesign only for inspiration during drafting — Sokoni tokens in DESIGN.md always win.
