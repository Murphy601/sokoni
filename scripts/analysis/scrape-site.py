#!/usr/bin/env python3
"""Scrape Sokoni public pages into Markdown for offline analysis."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from crawl4ai import AsyncWebCrawler, CrawlerRunConfig

OUT_DIR = Path(__file__).resolve().parents[2] / "docs" / "analysis" / "raw"
PAGES = [
    "https://sokonimall.com/login?next=index.html",
    "https://sokonimall.com/",
    "https://sokonimall.com/index.html",
    "https://sokonimall.com/signup.html",
    "https://sokonimall.com/about.html",
    "https://sokonimall.com/shop.html",
    "https://sokonimall.com/ask.html",
    "https://sokonimall.com/trust-and-safety.html",
    "https://sokonimall.com/faq.html",
    "https://sokonimall.com/checkout.html",
    "https://sokonimall.com/track.html",
    "https://sokonimall.com/terms.html",
    "https://sokonimall.com/privacy.html",
    "https://sokonimall.com/boda/index.html",
    "https://sokonimall.com/suppliers/list.html",
]


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    config = CrawlerRunConfig(wait_until="domcontentloaded", page_timeout=45000)
    summaries = []
    combined = ["# Sokoni live site scrape", ""]

    async with AsyncWebCrawler() as crawler:
        for url in PAGES:
            print(f"crawling {url}", flush=True)
            result = await crawler.arun(url=url, config=config)
            slug = (
                url.replace("https://sokonimall.com/", "")
                .replace("?", "_")
                .replace("=", "-")
                .replace("/", "_")
                or "home"
            )
            markdown = result.markdown or ""
            (OUT_DIR / f"scrape_{slug}.md").write_text(markdown, encoding="utf-8")
            summaries.append(
                {
                    "url": url,
                    "success": bool(result.success),
                    "status_code": result.status_code,
                    "title": getattr(result, "metadata", {}).get("title")
                    if isinstance(getattr(result, "metadata", None), dict)
                    else None,
                    "markdown_chars": len(markdown),
                    "links": len(getattr(result, "links", {}) or {}),
                }
            )
            combined.append(f"## {url}")
            combined.append("")
            combined.append(markdown or "_(empty)_")
            combined.append("")

    (OUT_DIR / "scraped_site.md").write_text("\n".join(combined), encoding="utf-8")
    (OUT_DIR / "scrape_index.json").write_text(
        json.dumps(summaries, indent=2), encoding="utf-8"
    )
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
