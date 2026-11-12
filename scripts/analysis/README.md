# Local pack / scrape / analyze (no API tokens)

These commands run entirely on your machine. Large dumps land in `docs/analysis/raw/` (gitignored).

## Install (once)

```bash
# Python CLIs
pip install --user gitingest crawl4ai semgrep
crawl4ai-setup   # Playwright Chromium for Crawl4AI

# Node CLIs (user prefix if global /usr is locked)
npm install -g @ast-grep/cli
# Repomix is invoked via npx — no global install required
```

Ollama + a local Cursor model is a **desktop** step (Settings → Models → override OpenAI base URL to `http://localhost:11434/v1`). It is not required to produce this audit, and 14B models are too large for the Cloud Agent VM.

## Pack the repo

```bash
npx --yes repomix --output docs/analysis/raw/repomix-output.xml --output-show-line-numbers --top-files-len 40
gitingest . -o docs/analysis/raw/repo_summary.txt \
  -e "node_modules/*" -e "*.lock" -e "docs/analysis/raw/*" \
  -e "*.png" -e "*.jpg" -e "*.webp" -e "*.mp4"
```

## Scrape the live site

```bash
python3 scripts/analysis/scrape-site.py
```

Public pages only. The homepage hard-gate JS-redirects anonymous browsers to `/login`. Use `?gate=off` if you need the catalog DOM (dev bypass; persists in `localStorage`).

## Static analysis

```bash
ast-grep -p 'fetch($URL)' -l js
ast-grep -p '$X.innerHTML = $Y' -l js
semgrep scan --metrics=off --config p/javascript --config p/owasp-top-ten \
  whatsapp-bot/src website/assets/js
```
