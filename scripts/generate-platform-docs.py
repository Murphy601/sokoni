#!/usr/bin/env python3
"""Render the Sokoni Mall platform handbook PDF from handbook_content.py."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from handbook_content import build_blocks

PURPLE = colors.HexColor("#1B1035")
PURPLE_MID = colors.HexColor("#2E1B57")
CREAM = colors.HexColor("#FFF8F0")
INK = colors.HexColor("#1B1035")
MUTED = colors.HexColor("#5C5470")
GREEN = colors.HexColor("#25D366")
LINE = colors.HexColor("#E4D9C8")
WHITE = colors.white
ROW_ALT = colors.HexColor("#F7F1E8")

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm

REPO_PDF = Path("/workspace/docs/Sokoni-Mall-Platform-Documentation.pdf")
ARTIFACT_PDF = Path("/opt/cursor/artifacts/Sokoni-Mall-Platform-Documentation.pdf")


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            textColor=GREEN,
            spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=28,
            leading=34,
            textColor=WHITE,
            spaceAfter=12,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12.5,
            leading=18,
            textColor=colors.HexColor("#D8D0EA"),
            spaceAfter=8,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#B7AEC9"),
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=15.5,
            leading=20,
            textColor=PURPLE,
            spaceBefore=10,
            spaceAfter=12,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=16,
            textColor=PURPLE_MID,
            spaceBefore=13,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=14,
            textColor=INK,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=19.2,
            textColor=INK,
            alignment=TA_JUSTIFY,
            spaceAfter=12,
        ),
        "body_left": ParagraphStyle(
            "body_left",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=19.2,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=10,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.5,
            textColor=INK,
            spaceAfter=0,
        ),
        "toc": ParagraphStyle(
            "toc",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=16.5,
            textColor=INK,
            spaceAfter=3,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.4,
            leading=11.6,
            textColor=INK,
        ),
        "cell_b": ParagraphStyle(
            "cell_b",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.4,
            leading=11.6,
            textColor=INK,
        ),
        "th": ParagraphStyle(
            "th",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.2,
            leading=11,
            textColor=WHITE,
        ),
    }


S = styles()


def P(text, style="body"):
    return Paragraph(str(text), S[style])


def callout(title, body):
    inner = [P(f"<b>{title}</b>", "callout"), Spacer(1, 4), P(body, "callout")]
    t = Table([[inner]], colWidths=[PAGE_W - 2 * MARGIN])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3EEF9")),
                ("BOX", (0, 0), (-1, -1), 0.5, PURPLE_MID),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return KeepTogether([t, Spacer(1, 11)])


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
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
    ]
    for i in range(1, len(data)):
        cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT if i % 2 == 0 else WHITE))
    t.setStyle(TableStyle(cmds))
    return KeepTogether([t, Spacer(1, 12)])


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.restoreState()
        return
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(PURPLE)
    canvas.rect(0, PAGE_H - 11 * mm, PAGE_W, 11 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 11.5 * mm, PAGE_W, 1.1, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(MARGIN, PAGE_H - 7 * mm, "SOKONI MALL")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 7 * mm, "Platform handbook")
    canvas.setFillColor(PURPLE)
    canvas.rect(0, 0, PAGE_W, 11 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.rect(0, 11 * mm, PAGE_W, 1.1, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(MARGIN, 4.6 * mm, "sokonimall.com  ·  SKN MALL KENYA")
    canvas.drawRightString(PAGE_W - MARGIN, 4.6 * mm, str(doc.page))
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


def build_story():
    story = []
    usable = PAGE_W - 2 * MARGIN
    story.append(Spacer(1, 50 * mm))
    story.append(P("SKN MALL KENYA  ·  BN-36SM2YW9", "cover_kicker"))
    story.append(P("Sokoni Mall", "cover_title"))
    story.append(
        P(
            "The complete platform handbook: how the website, WhatsApp bot, "
            "buyers, sellers, riders, pickup partners, escrow, AI, logistics, "
            "and hosting work together as one Kenyan marketplace.",
            "cover_sub",
        )
    )
    story.append(Spacer(1, 14))
    story.append(
        P(
            "Compiled from the live product on 15 October 2026.<br/>"
            "sokonimall.com  ·  bot.sokonimall.com  ·  WhatsApp +254 117 422 428",
            "cover_meta",
        )
    )
    story.append(Spacer(1, 78 * mm))
    story.append(
        P(
            "Support  support@sokonimall.com<br/>"
            "Human hours  07:30–21:00 East Africa Time<br/>"
            "Registered office  Murang'a Union Building, Thika–Kandara Road,<br/>"
            "P.O. Box 220, 01034 Kandara",
            "cover_meta",
        )
    )
    story.append(PageBreak())

    for kind, payload in build_blocks():
        if kind == "h1":
            story.append(P(payload, "h1"))
        elif kind == "h2":
            story.append(P(payload, "h2"))
        elif kind == "h3":
            story.append(P(payload, "h3"))
        elif kind == "p":
            story.append(P(payload, "body"))
        elif kind == "toc":
            story.append(P(payload, "toc"))
        elif kind == "callout":
            title, body = payload
            story.append(callout(title, body))
        elif kind == "table":
            headers, rows = payload[0], payload[1]
            widths = payload[2] if len(payload) > 2 else None
            if widths:
                widths = [w * mm if w < 50 else w for w in widths]
                if abs(sum(widths) - usable) > 2:
                    scale = usable / sum(widths)
                    widths = [w * scale for w in widths]
            story.append(table(headers, rows, widths))
        elif kind == "pagebreak":
            story.append(PageBreak())
        elif kind == "spacer":
            story.append(Spacer(1, payload))
    return story


def main():
    story = build_story()
    REPO_PDF.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(REPO_PDF),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title="Sokoni Mall — Platform Handbook",
        author="Sokoni Mall Enterprise",
        subject="How Sokoni Mall works: website, WhatsApp bot, people, money, AI, and hosting",
    )
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print(f"wrote {REPO_PDF} ({REPO_PDF.stat().st_size} bytes)")
    try:
        ARTIFACT_PDF.parent.mkdir(parents=True, exist_ok=True)
        ARTIFACT_PDF.write_bytes(REPO_PDF.read_bytes())
        print(f"copied {ARTIFACT_PDF} ({ARTIFACT_PDF.stat().st_size} bytes)")
    except OSError as exc:
        print(f"artifact copy skipped: {exc}")


if __name__ == "__main__":
    main()
