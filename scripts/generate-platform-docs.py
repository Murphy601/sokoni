#!/usr/bin/env python3
"""
Generate the public-safe Sokoni Mall platform documentation PDF.

Omits secrets, API keys, tokens, till numbers, SSH credentials,
database URLs, webhook secrets, and admin-token mechanics.
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    CondPageBreak,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

PURPLE = colors.HexColor("#1B1035")
PURPLE_MID = colors.HexColor("#2E1B57")
CREAM = colors.HexColor("#FFF8F0")
INK = colors.HexColor("#1B1035")
MUTED = colors.HexColor("#5C5470")
GREEN = colors.HexColor("#25D366")
GREEN_DARK = colors.HexColor("#128C4A")
LINE = colors.HexColor("#E4D9C8")
WHITE = colors.white
ROW_ALT = colors.HexColor("#F7F1E8")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

REPO_PDF = Path("/workspace/docs/Sokoni-Mall-Platform-Documentation.pdf")
ARTIFACT_PDF = Path("/opt/cursor/artifacts/Sokoni-Mall-Platform-Documentation.pdf")
OUT_PATHS = [REPO_PDF]


def styles():
    base = getSampleStyleSheet()
    s = {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=GREEN,
            tracking=1.4,
            spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=28,
            leading=34,
            textColor=WHITE,
            spaceAfter=10,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12,
            leading=17,
            textColor=colors.HexColor("#D8D0EA"),
            spaceAfter=6,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=colors.HexColor("#B7AEC9"),
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=PURPLE,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=16,
            textColor=PURPLE_MID,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=INK,
            spaceBefore=9,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.5,
            textColor=INK,
            alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        "body_left": ParagraphStyle(
            "body_left",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.5,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            textColor=MUTED,
            spaceAfter=6,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=INK,
            spaceAfter=0,
        ),
        "toc": ParagraphStyle(
            "toc",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=16,
            textColor=INK,
            spaceAfter=2,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=11.2,
            textColor=INK,
        ),
        "cell_b": ParagraphStyle(
            "cell_b",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.2,
            leading=11.2,
            textColor=INK,
        ),
        "th": ParagraphStyle(
            "th",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=WHITE,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.5,
            textColor=MUTED,
        ),
        "cmd": ParagraphStyle(
            "cmd",
            parent=base["Normal"],
            fontName="Courier",
            fontSize=8.5,
            leading=12,
            textColor=PURPLE,
        ),
    }
    return s


S = styles()


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items, style="body_left"):
    flow = []
    for item in items:
        flow.append(
            ListItem(Paragraph(item, S[style]), leftIndent=12, bulletColor=GREEN_DARK)
        )
    return ListFlowable(
        flow,
        bulletType="bullet",
        start="•",
        leftIndent=14,
        bulletFontName="Helvetica",
        bulletFontSize=9,
        bulletColor=GREEN_DARK,
        spaceAfter=8,
    )


def callout(title, body):
    inner = [
        P(f"<b>{title}</b>", "callout"),
        Spacer(1, 3),
        P(body, "callout"),
    ]
    t = Table([[inner]], colWidths=[PAGE_W - 2 * MARGIN])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3EEF9")),
                ("BOX", (0, 0), (-1, -1), 0.6, PURPLE_MID),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return KeepTogether([t, Spacer(1, 10)])


def table(headers, rows, col_widths=None):
    head = [P(h, "th") for h in headers]
    data = [head]
    for row in rows:
        data.append([P(c, "cell_b" if i == 0 else "cell") for i, c in enumerate(row)])
    usable = PAGE_W - 2 * MARGIN
    if not col_widths:
        w = usable / len(headers)
        col_widths = [w] * len(headers)
    t = Table(data, colWidths=col_widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), PURPLE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
        else:
            cmds.append(("BACKGROUND", (0, i), (-1, i), WHITE))
    t.setStyle(TableStyle(cmds))
    return KeepTogether([t, Spacer(1, 10)])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.restoreState()
        return
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(PURPLE)
    canvas.rect(0, PAGE_H - 12 * mm, PAGE_W, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 12.6 * mm, PAGE_W, 1.2, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(MARGIN, PAGE_H - 7.4 * mm, "SOKONI MALL")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(
        PAGE_W - MARGIN, PAGE_H - 7.4 * mm, "Platform documentation  ·  public-safe"
    )
    canvas.setFillColor(PURPLE)
    canvas.rect(0, 0, PAGE_W, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.rect(0, 12 * mm, PAGE_W, 1.2, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(
        MARGIN, 5 * mm, "sokonimall.com  ·  Secrets, keys, and till numbers omitted"
    )
    canvas.drawRightString(PAGE_W - MARGIN, 5 * mm, f"{doc.page}")
    canvas.restoreState()


def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PURPLE)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.rect(0, 0, 8 * mm, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(PURPLE_MID)
    canvas.rect(0, 42 * mm, PAGE_W, 0.4, fill=1, stroke=0)
    canvas.restoreState()
    header_footer(canvas, doc)


def build_story():
    story = []
    usable = PAGE_W - 2 * MARGIN

    # --- Cover (drawn as first flowables on purple page) ---
    story.append(Spacer(1, 48 * mm))
    story.append(P("SKN MALL KENYA  ·  BN-36SM2YW9", "cover_kicker"))
    story.append(P("Sokoni Mall", "cover_title"))
    story.append(
        P(
            "Full platform documentation: website, WhatsApp bot, buyers, sellers, "
            "riders, escrow, AI agents, tools, logistics, legal pages, and hosting.",
            "cover_sub",
        )
    )
    story.append(Spacer(1, 10))
    story.append(
        P(
            "Compiled from the live codebase and public storefront pages.<br/>"
            "15 October 2026  ·  Public-safe edition<br/>"
            "No API keys, tokens, till numbers, or private credentials included.",
            "cover_meta",
        )
    )
    story.append(Spacer(1, 70 * mm))
    story.append(
        P(
            "Website  sokonimall.com<br/>"
            "Bot API  bot.sokonimall.com<br/>"
            "WhatsApp  +254 117 422 428<br/>"
            "Support  support@sokonimall.com",
            "cover_meta",
        )
    )
    story.append(PageBreak())

    # --- Contents ---
    story.append(P("Contents", "h1"))
    toc = [
        "1. How to read this document",
        "2. What Sokoni is",
        "3. How the pieces connect",
        "4. The website",
        "5. The WhatsApp bot",
        "6. Buyers",
        "7. Sellers",
        "8. Riders (boda)",
        "9. Pickup points",
        "10. Escrow, payments, and refunds",
        "11. Logistics and delivery pricing",
        "12. AI agents, sub-agents, and tools",
        "13. Feature map",
        "14. Catalog, SKUs, and order IDs",
        "15. About, FAQ, trust, terms, and privacy",
        "16. Infrastructure and the production VM",
        "17. Command reference",
        "18. Official contacts and verification",
        "19. Glossary",
    ]
    for line in toc:
        story.append(P(line, "toc"))
    story.append(Spacer(1, 8))
    story.append(
        callout(
            "Scope",
            "This is a current-state picture of Sokoni as a prepaid Kenyan P2P marketplace. "
            "Older files such as CONCEPT.md still describe an affiliate-mall idea "
            "(Kilimall, Jumia, AliExpress, Temu, Amazon). That is not how live catalog "
            "orders work today. Live catalog orders are local Kenya inventory, prepaid "
            "M-Pesa STK, and Sokoni escrow.",
        )
    )

    # 1
    story.append(P("1. How to read this document", "h1"))
    story.append(
        P(
            "This document explains what Sokoni Mall is and how the public product "
            "handles buyers, sellers, riders, pickup partners, money, AI, and hosting. "
            "It is written for operators, partners, and anyone who needs a single "
            "source of truth without opening the repository."
        )
    )
    story.append(P("What this edition deliberately omits", "h2"))
    story.append(
        bullets(
            [
                "API keys, access tokens, HMAC secrets, admin tokens, and SSH credentials.",
                "M-Pesa till numbers, Paybill numbers, and payout account names.",
                "Database connection strings, private IP addresses, and VM login details.",
                "Webhook secrets and step-by-step payment-portal verification.",
                "Anything that would let a stranger operate admin desks or move money.",
            ]
        )
    )
    story.append(
        P(
            "Public contacts, BRS registration, storefront URLs, WhatsApp commands, "
            "escrow rules, and customer-facing fees are included because they already "
            "appear on sokonimall.com or in buyer/seller/rider knowledge."
        )
    )

    # 2
    story.append(P("2. What Sokoni is", "h1"))
    story.append(
        P(
            "<b>Sokoni Mall</b> is Kenya’s prepaid peer-to-peer marketplace for brand-new "
            "and pre-loved fashion and lifestyle goods. Shoppers browse a Depop-style "
            "storefront at sokonimall.com or chat with <b>Sokoni Plug</b> on WhatsApp. "
            "Every catalog order is paid up front by M-Pesa STK. Sokoni holds the money "
            "in escrow until delivery is confirmed. There is no cash on delivery."
        )
    )
    story.append(
        table(
            ["Pillar", "How it works today"],
            [
                [
                    "Legal name",
                    "SKN MALL KENYA — Business Registration Service number BN-36SM2YW9, "
                    "registered 4 September 2026 under Cap. 499.",
                ],
                [
                    "Trade name",
                    "Sokoni Mall / Sokoni Mall Enterprise. Countrywide Kenya — home delivery and pickup.",
                ],
                [
                    "Channels",
                    "Website (browse, shops, checkout, track) + WhatsApp (order, pay, track, support).",
                ],
                [
                    "Languages",
                    "English, Kiswahili, and Sheng.",
                ],
                [
                    "Inventory",
                    "Local Kenya sellers only. Sokoni does not route orders to AliExpress, Temu, or Amazon.",
                ],
                [
                    "Money",
                    "100% prepaid M-Pesa STK into escrow. Seller paid after confirmed delivery.",
                ],
                [
                    "Tracking",
                    "SKN-#### parent orders; cart lines SKN-####-n; older SK-#### still work.",
                ],
            ],
            [38 * mm, usable - 38 * mm],
        )
    )
    story.append(
        P(
            "Mission, from the About page: make trusted local commerce feel as easy as "
            "texting a friend. Match buyers to real listings across Kenya, and hold every "
            "payment until the parcel arrives as described."
        )
    )
    story.append(P("What Sokoni is not", "h2"))
    story.append(
        bullets(
            [
                "Not a cash-on-delivery courier marketplace.",
                "Not an overseas dropshipping storefront.",
                "Not a Next.js rewrite of the site — the storefront is static HTML plus vanilla JS.",
                "Not a place where riders or sellers collect payment at the door.",
            ]
        )
    )

    # 3
    story.append(P("3. How the pieces connect", "h1"))
    story.append(
        P(
            "Two public hosts, one product. The website is the discovery, trust, and "
            "account layer. The bot is the commerce engine: catalog, WhatsApp, escrow, "
            "orders, sellers, riders, disputes, and admin APIs."
        )
    )
    story.append(
        table(
            ["Layer", "Host / surface", "Job"],
            [
                [
                    "Storefront",
                    "sokonimall.com",
                    "Static HTML/CSS/JS on Cloudflare. Browse, shops, legal pages, seller hub, boda apply, checkout UI.",
                ],
                [
                    "Motion",
                    "website-motion → bundled JS",
                    "React + Framer Motion progressive enhancement. If it fails, the site still works.",
                ],
                [
                    "Bot / API",
                    "bot.sokonimall.com",
                    "Node/Express: WhatsApp webhook, catalog, checkout STK, tracking, social inbox, seller APIs.",
                ],
                [
                    "WhatsApp",
                    "WAHA on the production VM",
                    "Transport only. Numbered menus + free-text AI. WAHA admin is not public.",
                ],
                [
                    "Payments",
                    "M-Pesa STK via Paystack; Daraja as fallback",
                    "Collections into escrow; seller and rider payouts after confirmation.",
                ],
                [
                    "Data",
                    "File-backed orders plus optional Postgres",
                    "Orders, users, sellers, social, riders. Catalog can also live in products.json.",
                ],
            ],
            [28 * mm, 48 * mm, usable - 76 * mm],
        )
    )
    story.append(
        P(
            "Typical buyer path: sign in on the site → browse or search → open a product "
            "sheet → order on WhatsApp or prepaid checkout → M-Pesa STK into escrow → "
            "SKN tracking → delivery OTP or YES confirmation → review or HELP if something "
            "is wrong."
        )
    )

    # 4
    story.append(P("4. The website", "h1"))
    story.append(
        P(
            "The storefront lives under website/ and deploys as static assets (Cloudflare "
            "Wrangler assets.directory). Catalog, auth, WhatsApp deep links, and checkout "
            "talk to bot.sokonimall.com. Brand voice: a trusted local shop assistant — "
            "warm, direct, honest — for shoppers countrywide. Green (#25D366) is for "
            "actions only. Surfaces are cream; headings are deep purple. Fonts: Fraunces "
            "(display) and DM Sans (UI)."
        )
    )
    story.append(P("Account gate", "h2"))
    story.append(
        P(
            "Home (index.html) uses a hard account gate: browse requires a signed-in "
            "email account unless the gate is set to soft or off. Always-public pages "
            "include login, signup, password reset, track, labels, legal pages, seller "
            "hub, public shop profiles, pickup-point pages, and boda apply. Soft-protected "
            "pages (inbox, activity, disputes, checkout) ask for login in gated modes."
        )
    )
    story.append(P("Two login layers", "h2"))
    story.append(
        table(
            ["Layer", "How", "Used for"],
            [
                [
                    "Site account",
                    "Email and password via /api/account/auth",
                    "Browse gate, profile, purchases, inbox, activity.",
                ],
                [
                    "Buyer WhatsApp OTP",
                    "/api/buyer/auth send + verify code",
                    "Offers and pay flows tied to a Kenyan phone.",
                ],
            ],
            [36 * mm, 62 * mm, usable - 98 * mm],
        )
    )
    story.append(P("Public pages", "h2"))
    story.append(
        table(
            ["Page", "Purpose"],
            [
                ["index.html", "Catalog home: search, category rail, feed, new arrivals, how-it-works."],
                ["shop.html", "Public seller shop by handle — listings, follow, reviews. No login required."],
                ["ask.html", "Web chat with Sokoni Plug. Checkout still emphasized on WhatsApp."],
                ["login.html / signup.html", "Email account. Signup redirects to the login signup modal."],
                ["forgot-password.html / reset-password.html", "Password reset request and token form."],
                ["profile.html", "Account hub: profile, purchases, saved items."],
                ["checkout.html", "Prepaid checkout: order lookup, shipping, M-Pesa STK, accepted offers."],
                ["track.html", "Public SKN/SK tracking timeline; optional rider map."],
                ["inbox.html", "Buyer–seller messaging, offers, bundles, inspection actions."],
                ["activity.html", "Likes, follows, notification preferences."],
                ["disputes.html", "Buyer order-protection list."],
                ["label.html / qr.html", "Printable prepaid drop-off label and QR waybill."],
                ["suppliers/list.html", "Seller Hub: list, shop, KYC OTP, orders, ledger, withdraw, dispatch."],
                ["boda/index.html, apply.html, dashboard.html", "Rider pitch, registration, command reference."],
                ["rider/scan.html", "QR / pickup-code helper for riders."],
                ["pickup-points.html + apply.html", "Pickup partner programme and application."],
                [
                    "about, faq, trust-and-safety, terms, privacy",
                    "Company, help, legitimacy, contract, data protection.",
                ],
            ],
            [58 * mm, usable - 58 * mm],
        )
    )
    story.append(
        P(
            "Admin desks (admin-command, ops, support, finances, disputes, listings, "
            "shops, boda, riders) exist for staff. They are noindex and token-gated. "
            "This document does not describe how to authenticate to them."
        )
    )
    story.append(P("Public API families the site calls", "h2"))
    story.append(
        P(
            "Base URL: https://bot.sokonimall.com. Names and purpose only — no credentials."
        )
    )
    story.append(
        table(
            ["Prefix", "Purpose"],
            [
                ["/api/products", "Catalog list, detail helpers, likes."],
                ["/api/search", "Product search."],
                ["/api/reviews", "Sitewide reviews."],
                ["/api/feed", "Home feed and anonymous engagement events."],
                ["/api/checkout", "Order lookup, shipping, STK pay, labels."],
                ["/api/tracking", "Shipment timeline and rider location."],
                ["/api/disputes", "Buyer/seller disputes and inspection."],
                ["/api/account/auth", "Email signup, login, session, profile, purchases."],
                ["/api/buyer/auth", "WhatsApp OTP for buyers."],
                ["/api/social", "Shops, follow, chat, offers, bundles, activity."],
                ["/api/seller/listings", "Draft, AI studio, publish, bulk upload."],
                ["/api/seller/onboard", "Seller OTP, orders, ledger, withdraw, dispatch."],
                ["/api/agent", "Sokoni Plug web chat."],
                ["/api/pickup-points", "Programme info, directory, applications."],
                ["/api/riders/register", "Boda applications."],
                ["/api/trust/ticker", "Social-proof strip on home."],
                ["/catalog-images/", "Product images and video on the bot host."],
                ["/health", "Bot health for ops (no secrets in this document)."],
            ],
            [42 * mm, usable - 42 * mm],
        )
    )

    # 5
    story.append(P("5. The WhatsApp bot", "h1"))
    story.append(
        P(
            "The bot is a Node.js Express app in whatsapp-bot/. WhatsApp transport is "
            "<b>WAHA</b> (not Meta Cloud API). Shoppers use numbered text menus because "
            "interactive buttons are treated as unreliable. Free-text goes to Sokoni Plug "
            "after a command router that owns money, OTPs, and custody."
        )
    )
    story.append(P("Four-tier brain", "h2"))
    story.append(
        table(
            ["Tier", "What it does"],
            [
                [
                    "1. Command router",
                    "ACCEPT, PICKUP, CONFIRM, WAYBILL, PARTIAL_REFUND, pay, track, HELP, "
                    "and role menus run as code before any model.",
                ],
                [
                    "2. System prompt",
                    "Identity, safety, escrow and rider Stable Facts. The AI never enters OTPs or moves M-Pesa itself.",
                ],
                [
                    "3. Dynamic context",
                    "Each freeform turn gets the user’s role and recent SKN orders.",
                ],
                [
                    "4. Knowledge RAG",
                    "FAQs and SOPs from whatsapp-bot/knowledge/*.md (optional vector table).",
                ],
            ],
            [40 * mm, usable - 40 * mm],
        )
    )
    story.append(
        P(
            "Chat models are reached through a backend router (Groq, then OpenRouter, "
            "with optional Gemini). Shopper Plug tools run server-side with allowlists; "
            "the model is not given raw SQL or a free hand to release escrow."
        )
    )
    story.append(P("Knowledge files the AI is grounded on", "h2"))
    story.append(
        table(
            ["File", "Topics"],
            [
                ["escrow-policy.md", "Hold, inspection windows, refunds, AI prohibitions."],
                ["payments.md", "STK / till fallback, no COD, buyer-visible fees."],
                ["returns-policy.md", "Disputes, freeze, escalation."],
                ["buyer-trust.md", "PIN safety, SKN tracking, official contacts."],
                ["seller-onboarding.md", "SELL, Hub, pickup pin, shipping."],
                ["seller-payouts.md", "Wallet, withdraw, promos, stock alerts."],
                ["vendor-terms.md", "Accurate listings, no off-platform payment."],
                ["rider-onboarding.md", "RIDER APPLY, documents, Nairobi/Thika."],
                ["rider-delivery.md", "ACCEPT / PICKUP / CONFIRM, GPS, SOP."],
                ["rider-earnings.md", "Holds, sweeps, limits. No rider withdraw command."],
                ["delivery-pricing.md", "Metro rider formula vs upcountry seller rates."],
                ["shipping-sop.md", "Buyer/seller steps, WAYBILL, AI limits."],
                ["location-pins.md", "Seller, buyer, and rider map pins."],
                ["ai-architecture.md", "The four tiers above."],
            ],
            [48 * mm, usable - 48 * mm],
        )
    )

    # 6
    story.append(P("6. Buyers", "h1"))
    story.append(
        P(
            "Buyers can start on the website or by messaging WhatsApp. No extra shopping "
            "app is required. The product they pay for is local Kenya inventory from "
            "Sokoni sellers, not an overseas marketplace cart."
        )
    )
    story.append(P("Browse and decide", "h2"))
    story.append(
        bullets(
            [
                "Home catalog: category rail, search, Explore / Following feeds, filters (brand new vs pre-loved, aesthetics, price).",
                "Product cards show KES price, escrow/prepaid cues, and Order / Ask actions.",
                "Public shop pages by seller handle; follow, reviews, offers.",
                "Inbox for buyer–seller chat, offers, bundles, and media.",
                "Ask Sokoni Plug on WhatsApp or ask.html for catalog questions.",
            ]
        )
    )
    story.append(P("Order and pay", "h2"))
    story.append(
        bullets(
            [
                "Place an order on WhatsApp or web checkout. Provide name, phone, and delivery location (map pin when used).",
                "Receive an SKN-#### reference (cart lines SKN-####-n).",
                "Pay by M-Pesa STK prompt. Enter PIN only on the Safaricom prompt — Sokoni never asks for a PIN in chat.",
                "If STK fails, checkout may show a Buy Goods till. Reply paid with the M-Pesa code so Sokoni can verify.",
                "Never pay a rider, a personal number, or a till a stranger pastes in chat.",
                "Promo code SOKONI3: up to 3% off eligible prepaid orders during beta.",
            ]
        )
    )
    story.append(P("Receive and confirm", "h2"))
    story.append(
        bullets(
            [
                "Track on sokonimall.com/track.html or by typing the order id / track in WhatsApp.",
                "Local rider: inspect the parcel, then give the rider your 4-digit Delivery OTP. They send CONFIRM SKN-#### #### plus GPS within about 200 m of your pin.",
                "Upcountry courier: seller marks DISPATCH / WAYBILL; you reply YES SKN-#### after the parcel arrives.",
                "Inspect before you release. A photo of a problem during inspection freezes seller payout.",
                "Wrong, damaged, missing, or not as described: HELP SKN-#### or DISPUTE SKN-####. Claims up to 48 hours (Terms §7).",
                "After delivery you can RATE 1–5 (rider then seller when both apply).",
            ]
        )
    )
    story.append(
        callout(
            "Buyer money rule",
            "Payment sits with Sokoni, not the seller. If the seller has not dispatched "
            "within 12 hours of payment, you are refunded and the seller is not paid. "
            "If a parcel is marked delivered and you do not have it, reply HELP with the "
            "SKN number so escrow stays held."
        )
    )
    story.append(P("Multi-seller cart", "h2"))
    story.append(
        P(
            "The website bag can hold items from more than one seller. One parent SKN, "
            "one STK on the total, child lines SKN-####-n for fulfillment, commission, "
            "and escrow. Platform commission is per child line; the M-Pesa fee is charged "
            "once on the parent total. Sellers are notified only after payment succeeds. "
            "Track the parent or any child on the track page."
        )
    )

    # 7
    story.append(P("7. Sellers", "h1"))
    story.append(
        P(
            "Anyone in Kenya can list brand-new or pre-loved items. Zero listing fees "
            "during launch. Listings may go live instantly and are subject to post-publish "
            "moderation. Counterfeit, stolen, and prohibited goods are banned."
        )
    )
    story.append(P("Onboarding", "h2"))
    story.append(
        bullets(
            [
                "WhatsApp: reply SELL. Chat collects shop name, handle, payout number, and a required pickup map pin. Messaging from the number proves the phone.",
                "Web: sokonimall.com/suppliers/list.html — WhatsApp OTP, shop name, optional @handle, optional National ID.",
                "A shop cannot be created without a pickup pin. That pin is one end of every local delivery price.",
                "Payouts: Seller Hub → Settings → Payouts. Buyers must never pay the seller’s personal till.",
            ]
        )
    )
    story.append(P("Listing and shop", "h2"))
    story.append(
        bullets(
            [
                "Upload photos, title, price you receive, condition, stock or size/colour variants.",
                "Vision draft: a cover photo can be turned into a listing draft by catalog vision models, then you edit and publish.",
                "Media studio can clean backgrounds and attach a short product clip.",
                "Promos are per listing (percent off that item), not a shop-wide sale in automated messaging.",
                "Public shop page at shop.html by handle; optional TikTok URL on the profile.",
                "Acceptable-use check (check_aup) flags prohibited content before it should go live.",
            ]
        )
    )
    story.append(P("Orders, dispatch, payout", "h2"))
    story.append(
        bullets(
            [
                "View orders in Seller Hub or WhatsApp (vendor menu).",
                "Local metro: Sokoni pins a rider after prepaid payment. Hand over only when the rider presents the Pickup OTP (PICKUP SKN-#### ####).",
                "Upcountry: DISPATCH SKN-####, then WAYBILL SKN-#### Courier Tracking plus two pre-shipment photos (packed + waybill, item before sealing).",
                "Printable drop-off label: label.html / GET checkout label.",
                "Payout after confirmed delivery — typically 2–3 business days after delivery status (Terms §12). Wallet shows Ready; WITHDRAW on WhatsApp or Hub payouts.",
                "PARTIAL_REFUND SKN-#### amount is available to authorized sellers within rules. AI must not invent refund amounts.",
            ]
        )
    )
    story.append(P("Seller shipping rates", "h2"))
    story.append(
        P(
            "Sellers set county/zone rates for <b>upcountry</b> courier. They do not set "
            "Nairobi-metro rider fees — those are platform distance prices. A seller who "
            "says they charge KES 200 for Nairobi is describing a courier rate that does "
            "not apply to Sokoni boda jobs."
        )
    )

    # 8
    story.append(P("8. Riders (boda)", "h1"))
    story.append(
        P(
            "Sokoni boda riders handle local metro deliveries after prepaid escrow. "
            "They never collect cash or M-Pesa from buyers. Jobs are auto-offered — "
            "there is no public job board. Operating towns for applications today: "
            "Nairobi or Thika."
        )
    )
    story.append(P("Apply", "h2"))
    story.append(
        bullets(
            [
                "WhatsApp first: RIDER APPLY (also ride, rider, boda). Chat collects fields and photos.",
                "Web: sokonimall.com/boda/apply.html.",
                "Required: full name, Kenyan WhatsApp/M-Pesa phone, National ID, town, stage, bike plate, ID front photo, Class A licence, stage chairman letter.",
                "Optional (speeds vetting): ID back, logbook, Good Conduct, NTSA badge. Stage map pin is optional but helps nearby matching.",
                "Status PENDING → VERIFIED or REJECTED. Ops usually replies on WhatsApp within about 24 hours. Do not promise approval or earnings.",
            ]
        )
    )
    story.append(P("Live job commands (code, not the AI)", "h2"))
    story.append(
        table(
            ["Command", "Meaning"],
            [
                ["ACCEPT SKN-####", "Claim the offered job. Atomic lock — only the offered rider wins."],
                ["PICKUP SKN-#### ####", "Seller’s 4-digit Pickup OTP at the shop."],
                ["CONFIRM SKN-#### ####", "Buyer’s 4-digit Delivery OTP at the door, plus GPS within ~200 m of the buyer pin."],
                ["DECLINE / NO_SHOW / VERIFY_RETURN", "Ops paths for refused or returned jobs."],
                ["AVAILABLE / OFFLINE", "Duty status. Live Location on WhatsApp when online."],
            ],
            [52 * mm, usable - 52 * mm],
        )
    )
    story.append(
        P(
            "CONFIRM needs two proofs: the buyer OTP (the rider is with the buyer) and a "
            "fresh GPS pin (the rider is at the address). OTP alone can be read over the "
            "phone; GPS closes that hole. Distance is recorded for later disputes."
        )
    )
    story.append(P("Earnings", "h2"))
    story.append(
        bullets(
            [
                "Riders do not withdraw. After CONFIRM: 15-minute hold (buyer dispute window), then a sweep about every 30 minutes sends M-Pesa to the registered number.",
                "KES 200 minimum per payout (smaller amounts wait and batch). KES 5,000 per rider per day; overflow rolls to the next day.",
                "A single delivery fee above KES 1,500 is held for an ops check first.",
                "Under ~45 minutes since CONFIRM is normal. Under KES 200 owed is waiting for the floor.",
            ]
        )
    )

    # 9
    story.append(P("9. Pickup points", "h1"))
    story.append(
        P(
            "Registered shops can hold prepaid parcels for customer collection. Apply at "
            "sokonimall.com/pickup-points and pickup-points/apply.html, or use pickup menu "
            "on WhatsApp. Terms §13:"
        )
    )
    story.append(
        bullets(
            [
                "Physical shop with secure storage and regular hours.",
                "Hold parcels up to 5 days unless otherwise agreed.",
                "Commission per parcel (rate confirmed on approval); M-Pesa payouts on an agreed cycle.",
                "Release only after Sokoni confirms payment and sends a release notice.",
                "Customer name, phone, and order ID are confidential — use only to verify collection.",
                "Sokoni may approve, reject, suspend, or remove partners at its discretion.",
            ]
        )
    )

    # 10
    story.append(P("10. Escrow, payments, and refunds", "h1"))
    story.append(
        P(
            "Prepaid escrow is the core of Sokoni. It protects buyers from fake goods and "
            "sellers from prank COD orders. Cash at the door leaves no record and no reverse "
            "path, so it is not offered."
        )
    )
    story.append(P("Cycle", "h2"))
    story.append(
        table(
            ["Step", "What happens"],
            [
                ["1. Pay", "Buyer pays listed price + delivery (where applicable) + banded M-Pesa fee via STK (or till fallback)."],
                ["2. Hold", "Funds sit in Sokoni escrow. The seller is not paid at checkout."],
                ["3. Dispatch", "Seller packs. Local: pinned rider collects with Pickup OTP. Upcountry: courier + WAYBILL photos. 12-hour no-dispatch refund if nothing moves."],
                ["4. Inspect", "Buyer checks the parcel. Photo of a problem freezes payout."],
                ["5. Confirm", "Local: Delivery OTP via rider CONFIRM. Upcountry: YES SKN-####."],
                ["6. Release", "After confirmation, or after the inspection window with no dispute, funds can move to the seller (and rider fee to the rider)."],
            ],
            [28 * mm, usable - 28 * mm],
        )
    )
    story.append(P("Inspection windows", "h2"))
    story.append(
        bullets(
            [
                "Local rider delivery: 24 hours from delivery (order autoReleaseHours may be more specific).",
                "Upcountry courier: 48 hours from delivery.",
                "Local rider fees also sit in a 15-minute hold before the rider is paid.",
                "Terms §7: wrong / damaged / not-as-described claims for up to 48 hours either way. If escrow already auto-released, the claim is still valid and support settles it manually. Never tell a buyer they are too late.",
            ]
        )
    )
    story.append(P("Accepted and refused payment rails", "h2"))
    story.append(
        table(
            ["Accepted", "Not accepted"],
            [
                [
                    "M-Pesa STK push (default).<br/>M-Pesa Buy Goods till when STK fails, then reply paid with the code.",
                    "Cash on delivery.<br/>Paying a rider in cash or M-Pesa.<br/>Personal numbers or mystery tills in chat.",
                ]
            ],
            [usable / 2, usable / 2],
        )
    )
    story.append(P("Disputes", "h2"))
    story.append(
        P(
            "HELP SKN-#### / DISPUTE SKN-#### opens a ticket, freezes seller payout, and "
            "asks for evidence photos. Buyers and AI open tickets; admins resolve them. "
            "Sokoni Plug must never quote a refund amount, never release escrow, and never "
            "promise a payout date. Refunds go back to M-Pesa when the claim holds. "
            "Liability on a given order is capped at the prepaid escrow amount for that order."
        )
    )
    story.append(
        callout(
            "AI money rule",
            "The language model does not move money. Command router, Paystack/Daraja "
            "callbacks, and staff-approved admin paths do. Shadow multi-agent advisors "
            "never auto-release escrow or pin riders."
        )
    )

    # 11
    story.append(P("11. Logistics and delivery pricing", "h1"))
    story.append(P("Two different things are called delivery", "h2"))
    story.append(
        table(
            ["Mode", "Who carries it", "Who sets the price"],
            [
                [
                    "Local metro rider",
                    "Sokoni boda, auto-pinned after prepaid payment. Nairobi, Kiambu, and Machakos metro towns (Syokimau, Athi River, Kitengela, and similar).",
                    "Sokoni, by road distance between seller pickup pin and buyer pin.",
                ],
                [
                    "Upcountry courier",
                    "Seller’s courier or parcel sacco. WAYBILL + two photos. No Sokoni rider.",
                    "The seller’s Hub county/zone rates.",
                ],
            ],
            [36 * mm, usable * 0.38, usable * 0.38],
        )
    )
    story.append(P("Published metro rider formula", "h2"))
    story.append(
        bullets(
            [
                "KES 400 minimum covering the first 5 road km.",
                "KES 25 per road km after that.",
                "KES 1,500 ceiling, however far.",
                "Straight-line distance × 1.3 to approximate roads.",
                "If a pin is missing, the fee falls back to KES 400 rather than blocking checkout.",
                "Buyer pays the fee into escrow with the item. After CONFIRM, Sokoni takes a 10% platform cut, M-Pesa takes its B2C charge, remainder to the rider. On a KES 400 fee the rider nets KES 345.",
            ]
        )
    )
    story.append(
        P(
            "Never quote a specific-order delivery figure in conversation. Checkout shows "
            "the exact amount before anyone pays. Typical delivery estimates on Terms: "
            "1–5 days depending on location. Timeline on track: label → hub → in transit "
            "→ pickup or delivered."
        )
    )

    # 12
    story.append(P("12. AI agents, sub-agents, and tools", "h1"))
    story.append(
        P(
            "Sokoni is not a single chatbot. Shopper chat, specialist lanes, background "
            "platform agents, an ops agent, and a shadow multi-agent layer sit on top of "
            "deterministic commands. Money and OTPs stay in code."
        )
    )
    story.append(P("Sokoni Plug (shopper / seller assistant)", "h2"))
    story.append(
        P(
            "Used on WhatsApp and ask.html. After the command router, a specialist graph "
            "routes each turn into a lane with an allowlisted tool subset, then knowledge "
            "RAG, then a reply. Lanes: buyer, seller, dispute, logistics, general."
        )
    )
    story.append(
        table(
            ["Lane", "Typical tools"],
            [
                [
                    "Buyer",
                    "search_products, browse_products, browse_taxonomy, get_product, track_order, get_order_label, list_orders, store_info, open_return_case, create_checkout_link, verify_payment_code",
                ],
                [
                    "Seller",
                    "Onboarding, payout snapshot, listings, stock/price update, shipping rates, dispatch_with_rider, acceptable-use check, labels, track",
                ],
                [
                    "Dispute",
                    "Track, labels, open_return_case, propose_goodwill (capped voucher proposal only), verify_payment_code",
                ],
                [
                    "Logistics",
                    "Track, labels, shipping rates, dispatch_with_rider — no escrow release",
                ],
            ],
            [28 * mm, usable - 28 * mm],
        )
    )
    story.append(P("Plug tools (names and purpose)", "h2"))
    story.append(
        table(
            ["Tool", "Purpose"],
            [
                ["search_products / browse_products / browse_taxonomy / get_product", "Find and describe catalog items."],
                ["track_order / get_order_label / list_orders", "Status, printable label URL, buyer order list."],
                ["list_seller_orders / listings / lookup_order_seller", "Seller’s orders, SKUs, who sold an order."],
                ["store_info", "Policies, contacts, how-it-works facts."],
                ["open_return_case", "Start a return/dispute case (does not pay anyone)."],
                ["get_seller_onboarding / get_rider_onboarding", "Signup steps."],
                ["get_seller_payout / get_shipping_rates", "Wallet snapshot and rate matrix."],
                ["propose_goodwill", "Bounded goodwill voucher proposal. Cap enforced in code."],
                ["create_checkout_link", "Reserve + checkout/STK path."],
                ["update_inventory / dispatch_with_rider", "Authenticated seller stock/price and dispatch notify."],
                ["verify_payment_code", "Match an M-Pesa code to recorded webhooks."],
                ["check_aup", "Prohibited listing/content check."],
            ],
            [58 * mm, usable - 58 * mm],
        )
    )
    story.append(P("Ops agent (staff only)", "h2"))
    story.append(
        P(
            "A separate tool-calling agent for the command desk. It can read metrics, "
            "escrow status, disputes, catalog and policy search, and propose operational "
            "actions. The model still does not write SQL — every query is a named function "
            "with validated arguments. This document does not list staff authentication."
        )
    )
    story.append(P("Platform fabric (background sub-agents)", "h2"))
    story.append(
        P(
            "Event-driven listeners in whatsapp-bot/src/agents/. Level 1 only: rate-limited "
            "seller nudges (for example a close, eligible offer) and reports to a main "
            "agent. Level 2 money movement is not started from these listeners. A proposal "
            "must be approved on an admin route that already owns payout and checkout."
        )
    )
    story.append(
        bullets(
            [
                "Inspection-window watcher — auto-release timing after delivery.",
                "Review nudge — ask for RATE after a completed order.",
                "Chat control / flagged messages — safety and abuse signals.",
                "Agent-actions queue — ops desk can see proposed actions.",
                "Output guard / heap guard — keep replies and process health in bounds.",
            ]
        )
    )
    story.append(P("Executive operating system", "h2"))
    story.append(
        P(
            "Staff roles (super admin, dispute manager, logistics lead, support agent) "
            "receive briefings and dispute action cards on WhatsApp. Natural-language and "
            "prefixed staff commands are intercepted in code before shopper AI. Voice notes "
            "from staff can be transcribed into those commands. Shopper Plug cannot use "
            "this palette."
        )
    )
    story.append(P("MAS — multi-agent fallback (shadow)", "h2"))
    story.append(
        P(
            "An additive shadow layer for security heuristics, logistics advice, media "
            "last-resort, and optional chat/voice assist. Primaries stay Cloudinary / "
            "Remotion for clips and Groq/OpenRouter for chat. Transactional shadow never "
            "auto-releases escrow. Health endpoint reports whether MAS is in shadow."
        )
    )
    story.append(P("Media, TikTok, voice", "h2"))
    story.append(
        bullets(
            [
                "Listing vision: photo → draft copy (vision models with fallbacks).",
                "Media studio: background cleanup and short product clips. Remotion worker on the VM is a fallback clip renderer so Chromium work cannot crash the bot.",
                "TikTok: optional posting of in-stock store products; featured IDs on the site. Private messages are not posted.",
                "Inbound WhatsApp voice: speech-to-text, then the same router as text. Optional outbound TTS only when a voice reply is requested.",
            ]
        )
    )

    # 13
    story.append(P("13. Feature map", "h1"))
    story.append(
        table(
            ["Area", "What exists in the live product"],
            [
                ["Catalog", "API-driven grid, browse menu (women, men, beauty, electronics, supermarket, auto, food, and more), demand tags, likes."],
                ["Social", "Follow shops, inbox chat, offers, bundles, activity feed, shop reviews."],
                ["Search", "Site search + Plug natural language (English / Kiswahili / Sheng)."],
                ["Checkout", "Web prepaid checkout, WhatsApp order, STK, shipping calculator, landmarks."],
                ["Tracking", "Public track page, WhatsApp status, optional rider map."],
                ["Labels / QR", "Printable waybill, rider scan helper, hub scan lifecycle."],
                ["Reviews", "Sitewide + shop reviews; RATE after delivery."],
                ["Trust ticker", "Social proof on home."],
                ["Promo", "SOKONI3 3% cap; seller per-item percent promos."],
                ["TikTok", "Optional product posting; seller profile link."],
                ["Pickup points", "Apply, directory, hold-for-collection."],
                ["Boda", "Apply, auto-dispatch, OTP custody, earnings sweep."],
                ["Account", "Email account + WhatsApp OTP; forgot/reset password."],
                ["AI", "Plug on WhatsApp and ask.html; ops agent for staff."],
                ["Admin desks", "Escrow, finances, disputes, listings/KYC, shops, boda, support, live ops."],
            ],
            [32 * mm, usable - 32 * mm],
        )
    )

    # 14
    story.append(P("14. Catalog, SKUs, and order IDs", "h1"))
    story.append(
        table(
            ["Identifier", "What it is"],
            [
                [
                    "Catalog product id",
                    "Opaque listing id (example pattern pt-…-001). Not the tracking code.",
                ],
                [
                    "SKN-####",
                    "Parent order / tracking reference after checkout.",
                ],
                [
                    "SKN-####-n",
                    "Child line in a multi-seller cart (fulfillment + escrow per seller).",
                ],
                [
                    "SK-####",
                    "Legacy order ids. Still accepted on track and WhatsApp.",
                ],
            ],
            [40 * mm, usable - 40 * mm],
        )
    )
    story.append(
        P(
            "Master catalog is maintained on the bot (products.json and/or database). A "
            "build step publishes a public catalog to the website and strips private "
            "sourcing fields. Storefront listings use fulfillment store and payment prepaid. "
            "Paid orders consume stock. Daily affiliate-price sync still exists in the repo "
            "for older international catalog experiments; live FAQ states Sokoni does not "
            "sell AliExpress/Temu/Amazon orders."
        )
    )

    # 15
    story.append(P("15. About, FAQ, trust, terms, and privacy", "h1"))
    story.append(
        P(
            "These pages are the public contract. Summaries below; the live HTML is "
            "authoritative if copy changes."
        )
    )
    story.append(P("About (about.html)", "h2"))
    story.append(
        bullets(
            [
                "P2P marketplace for brand-new merchandise and pre-loved fashion. Web + WhatsApp.",
                "Prepaid STK, escrow until arrival, SKN tracking.",
                "Sellers list at /suppliers/list; hub drop-off; payout after confirmed delivery.",
                "Registered office on the BRS record is not a claim that Sokoni only serves one town.",
                "Verify: SMS BRS to 21546, registration BN-36SM2YW9.",
            ]
        )
    )
    story.append(P("FAQ (faq.html)", "h2"))
    story.append(
        bullets(
            [
                "No COD, by design.",
                "Pay via STK; reply paid only if a confirmation code needs verifying.",
                "Escrow 24 h local / 48 h upcountry; Terms §7 covers 48 h claims either way.",
                "Local Kenya inventory only — no international marketplace routing.",
                "Sell via Seller Hub; SOKONI3 up to 3% in beta.",
                "Human help 7:30 AM–9:00 PM EAT via Talk to a Human on WhatsApp. AI help anytime on WhatsApp or ask.html.",
            ]
        )
    )
    story.append(P("Trust and safety (trust-and-safety.html)", "h2"))
    story.append(
        bullets(
            [
                "Is it safe? STK into escrow; seller paid after delivery; inspect before sharing the delivery code.",
                "How is money protected? 12-hour no-dispatch refund; HELP holds escrow if a delivery is fake or missing.",
                "Is it a scam? No — SKN MALL KENYA, BN-36SM2YW9, BRS SMS verification, published phone and email.",
            ]
        )
    )
    story.append(P("Terms of Service (terms.html, last updated 27 July 2026)", "h2"))
    story.append(
        bullets(
            [
                "§1–2 Founder-led launch; 100% prepaid marketplace; no COD.",
                "§3 Full listed price up front; escrow; seller payout after delivery; no hidden registration fees; promo cap 3% unless written otherwise.",
                "§4 Services: website, Plug, seller listings, tracking, pickup programme, optional social posts.",
                "§5 Accurate buyer details; fraud may be refused; local inventory only.",
                "§6 Delivery estimates 1–5 days; risk passes on successful delivery or authorized pickup collection.",
                "§7 Returns: contact WhatsApp within 48 hours of delivery; refund/replace from escrow at Sokoni’s discretion on evidence.",
                "§8 Acceptable use: no prohibited goods, spam, impersonation, or admin-system abuse.",
                "§9 AI may be inaccurate; confirm price and condition before ordering.",
                "§10 Liability limited to the prepaid escrow amount for that order; third-party networks (couriers, M-Pesa, WhatsApp, sellers) can fail independently.",
                "§12 Seller listings: accurate photos, legal goods, hub label, post-publish moderation.",
                "§13 Pickup point programme as in section 9 of this document.",
            ]
        )
    )
    story.append(P("Privacy Policy (privacy.html, last updated 27 July 2026)", "h2"))
    story.append(
        P(
            "Applies to sokonimall.com, WhatsApp, seller listings, and pickup applications. "
            "Sokoni does not collect M-Pesa PINs, card numbers, or passwords through WhatsApp or the website."
        )
    )
    story.append(
        bullets(
            [
                "Collected: WhatsApp messages needed to fulfill; order and escrow status; M-Pesa STK callbacks (amount, receipt, phone); reviews; listing photos and details; anonymous feed events; pickup applications; localStorage preferences; technical logs.",
                "Used for: orders, escrow, payouts, moderation, Plug answers, feed ranking, public reviews (first name + comment), optional TikTok of products (not private chats), fraud prevention.",
                "AI: message text plus catalog/order context. Local listings only. Chat history and phone numbers are not sold to marketers.",
                "Processors named on the page: WhatsApp/WAHA, Paystack, Safaricom Daraja, Cloudflare, AI providers, optional TikTok. Meta’s WhatsApp policies also apply.",
                "Sharing: sellers and logistics only what they need to fulfill; authorities when required by law. Listing photos are public.",
                "Rights under Kenya Data Protection Act, 2019: access, correction, deletion via WhatsApp or support@sokonimall.com.",
                "Not directed at children under 13. Some processors may handle data outside Kenya where needed to run the service.",
            ]
        )
    )

    # 16
    story.append(P("16. Infrastructure and the production VM", "h1"))
    story.append(
        P(
            "This section describes roles, not logins. No hosts, SSH keys, or secret "
            "names that unlock the machine are included."
        )
    )
    story.append(P("Website hosting", "h2"))
    story.append(
        P(
            "sokonimall.com is a static site on Cloudflare (Workers/Pages). Root directory "
            "website/, empty build command, wrangler deploy of assets. Merges to main "
            "publish the storefront. There is no Next.js app router. website-motion is "
            "built separately into website/assets/js/sokoni-motion/."
        )
    )
    story.append(P("Bot VM (production)", "h2"))
    story.append(
        P(
            "The commerce API and WhatsApp session run on a single Linux VM (documented "
            "production path: GCP e2-micro Always Free; Oracle Always Free ARM is the "
            "documented alternative with more RAM). Render is an optional split (bot-only, "
            "with WAHA kept awake elsewhere) and is not the main layout. There is no "
            "render.yaml in the repository."
        )
    )
    story.append(
        table(
            ["Process on the VM", "Role"],
            [
                ["nginx + TLS", "Public HTTPS for bot.sokonimall.com. WAHA admin port is not exposed to the internet."],
                ["sokoni-bot (PM2)", "Node Express: webhooks, APIs, AI, escrow logic."],
                ["WAHA (Docker, NOWEB)", "WhatsApp session. Pairing stays on the VM or an SSH tunnel."],
                ["Postgres (optional Docker)", "Users, social, riders, additive schemas. File-backed orders still used for live cart/escrow."],
                ["sokoni-remotion (PM2)", "Loopback clip renderer fallback for listing videos."],
                ["Encrypted data backups", "Orders/settlements archives on a schedule; Postgres volumes and WhatsApp session are separate restore stories."],
            ],
            [42 * mm, usable - 42 * mm],
        )
    )
    story.append(
        P(
            "Deploy: GitHub Actions on whatsapp-bot (and related) changes SSHes to the VM "
            "and runs the bot deploy script (install, migrate, restart PM2). WAHA is usually "
            "left running so the linked WhatsApp session is not dropped. Health checks hit "
            "https://bot.sokonimall.com/health (session linked or not is a status flag, not a secret)."
        )
    )
    story.append(P("Security posture (public-safe)", "h2"))
    story.append(
        bullets(
            [
                "Browser JS has no payment or admin secrets. Session tokens appear only after the user authenticates.",
                "CORS allowlists the storefront origin.",
                "WhatsApp webhooks are authenticated; unsigned posts are rejected when that check is on.",
                "Public APIs are rate-limited. Per-user WhatsApp rate limit (~10 messages/minute) stops spam from burning the LLM.",
                "Admin UIs do not belong in search indexes.",
                "Catalog pause and maintenance flags exist so ops can stop selling without redeploying the site.",
            ]
        )
    )
    story.append(P("Data concepts (no connection strings)", "h2"))
    story.append(
        P(
            "Users (buyer / seller / staff), sellers (shop slug, verification), products "
            "(condition, stock, public images, prices — private cost fields not exposed), "
            "orders and order items (status pending → paid → … → delivered / cancelled / "
            "refunded), payments, shipments/riders, disputes, social (follows, likes, "
            "offers, messages, reviews), audit logs on custody transitions. Order status "
            "changes after pickup or in-transit cancel are rejected unless forced by "
            "admin/dispute/no-show paths."
        )
    )
    story.append(P("This documentation environment", "h2"))
    story.append(
        P(
            "This PDF was compiled by reading the Sokoni GitHub repository and public "
            "HTML pages. It does not include Cloud Agent, Cursor, or VM credentials from "
            "the machine that generated it."
        )
    )

    # 17
    story.append(P("17. Command reference", "h1"))
    story.append(P("Everyone", "h2"))
    story.append(
        table(
            ["Type or tap", "Result"],
            [
                ["menu / hi / start", "Main numbered menu; resets product browse."],
                ["1, 2, 3…", "Choose a menu line."],
                ["track / status / SKN-####", "Shipment timeline."],
                ["pay / retry / stk / lipa", "Retry STK on an unpaid order."],
                ["paid", "Ask Sokoni to verify a manual M-Pesa confirmation."],
            ],
            [48 * mm, usable - 48 * mm],
        )
    )
    story.append(P("Buyers", "h2"))
    story.append(
        table(
            ["Command", "Result"],
            [
                ["YES SKN-####", "Confirm receipt on non-rider / upcountry path."],
                ["HELP SKN-#### / DISPUTE SKN-####", "Freeze escrow, open support."],
                ["RATE 5 (or 1–5)", "Review after delivery."],
            ],
            [58 * mm, usable - 58 * mm],
        )
    )
    story.append(P("Sellers", "h2"))
    story.append(
        table(
            ["Command", "Result"],
            [
                ["SELL", "Start shop onboarding in chat."],
                ["vendor menu", "Seller hub menu."],
                ["balance / WITHDRAW", "Wallet and payout request."],
                ["DISPATCH SKN-####", "Mark dispatched (optional rider hint)."],
                ["WAYBILL SKN-#### Courier Tracking", "Upcountry tracking + photos."],
                ["PARTIAL_REFUND SKN-#### amount", "Seller-initiated partial refund within rules."],
            ],
            [62 * mm, usable - 62 * mm],
        )
    )
    story.append(P("Riders", "h2"))
    story.append(
        table(
            ["Command", "Result"],
            [
                ["RIDER APPLY", "Onboarding in chat."],
                ["ACCEPT / PICKUP / CONFIRM SKN-#### …", "Job custody. OTPs are 4 digits."],
                ["DECLINE / NO_SHOW / AVAILABLE / OFFLINE", "Duty and exception paths."],
            ],
            [62 * mm, usable - 62 * mm],
        )
    )
    story.append(P("Pickup partners", "h2"))
    story.append(P("pickup menu or pick up point opens the partner menu."))
    story.append(
        P(
            "Staff # commands and executive force-release / refund palettes exist on "
            "configured phones only. They are not listed here."
        )
    )

    # 18
    story.append(P("18. Official contacts and verification", "h1"))
    story.append(
        table(
            ["Channel", "Value"],
            [
                ["Website", "https://sokonimall.com"],
                ["Bot / API", "https://bot.sokonimall.com"],
                ["WhatsApp / calls", "+254 117 422 428  (wa.me/254117422428)"],
                ["Email", "support@sokonimall.com"],
                ["Human hours", "About 07:30–21:00 East Africa Time"],
                ["Registered name", "SKN MALL KENYA"],
                ["BRS number", "BN-36SM2YW9"],
                ["Verify", "SMS BRS to 21546, then the registration number"],
                ["Registered address (BRS)", "Murang'a Union Building, Thika–Kandara Road, P.O. Box 220, 01034 Kandara"],
                ["Governing act", "Registration of Business Names Act (Cap. 499, Sec. 14)"],
            ],
            [42 * mm, usable - 42 * mm],
        )
    )
    story.append(
        callout(
            "Do not invent contacts",
            "Buyer-trust knowledge forbids extra emails, phones, or a city-only “head office” "
            "story. Use the table above. Never publish a till number on the storefront."
        )
    )

    # 19
    story.append(P("19. Glossary", "h1"))
    story.append(
        table(
            ["Term", "Meaning"],
            [
                ["Sokoni Plug", "The WhatsApp / web shopping assistant."],
                ["Escrow", "Buyer payment held by Sokoni until delivery is confirmed or a dispute is resolved."],
                ["STK", "M-Pesa Sim Toolkit push — PIN entered on the phone, not in chat."],
                ["SKN", "Sokoni order tracking prefix."],
                ["Pickup OTP", "4-digit code the seller gives the rider at collection."],
                ["Delivery OTP", "4-digit code the buyer gives the rider at the door."],
                ["Hub", "Sokoni drop-off / scan point on the label timeline."],
                ["Seller Hub", "suppliers/list.html — listing, orders, payouts."],
                ["WAHA", "Self-hosted WhatsApp HTTP API running on the bot VM."],
                ["Path B", "Keep vanilla storefront; add motion as a fail-soft bundle."],
                ["MAS", "Shadow multi-agent fallback. Does not replace primaries; does not auto-pay."],
            ],
            [36 * mm, usable - 36 * mm],
        )
    )

    story.append(Spacer(1, 8))
    story.append(P("Document control", "h2"))
    story.append(
        P(
            "Edition: public-safe platform documentation, 15 October 2026. Source: Sokoni "
            "repository (website/, whatsapp-bot/, docs/) and live legal HTML. If the site "
            "or bot change, regenerate from source rather than editing this PDF by hand. "
            "Older CONCEPT.md / WHATSAPP_FLOWS.md affiliate-mall chapters are historical."
        )
    )
    return story


def first_page(canvas, doc):
    cover_page(canvas, doc)


def later_pages(canvas, doc):
    header_footer(canvas, doc)


def main():
    story = build_story()
    last_path = None
    for path in OUT_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = SimpleDocTemplate(
            str(path),
            pagesize=A4,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=20 * mm,
            bottomMargin=18 * mm,
            title="Sokoni Mall — Platform Documentation",
            author="Sokoni Mall Enterprise",
            subject="Public-safe documentation of the Sokoni website, WhatsApp bot, and hosting",
        )
        doc.build(story, onFirstPage=first_page, onLaterPages=later_pages)
        last_path = path
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    try:
        ARTIFACT_PDF.parent.mkdir(parents=True, exist_ok=True)
        ARTIFACT_PDF.write_bytes(REPO_PDF.read_bytes())
        print(f"copied {ARTIFACT_PDF} ({ARTIFACT_PDF.stat().st_size} bytes)")
    except OSError as exc:
        print(f"artifact copy skipped: {exc}")
    return last_path


if __name__ == "__main__":
    main()
