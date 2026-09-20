# Purging the leaked key and the dispute photos from git history

Two things are still reachable in this repository's history. Removing them from
`HEAD` did not remove them from the commits that introduced them.

| What | Introduced | Status |
|------|-----------|--------|
| Google API key `AQ.Ab8RN6JK…` in `scripts/deploy-bot.sh` | `b1393fb`, 2026-07-30 | gone from HEAD, **still in history** |
| 3 × `dispute_ev_SKN-1014_*.jpg` buyer photos | VM auto-commit `9040f74` | gone from HEAD, **still in history** |

This repo is public. Anyone who has cloned it already has both.

---

## Step 1 — rotate the key. Do this first, on its own.

History rewriting is optional. **Rotation is not.** A key that is still valid is
a live credential no matter what the git history looks like.

1. Google Cloud Console → APIs & Services → Credentials
2. Find the key, **Delete** it (not just restrict — it has been public for weeks)
3. Create a replacement, restrict it to the Generative Language API
4. Put the new value on the VM only:

```bash
cd ~/sokoni/whatsapp-bot && nano .env      # GEMINI_API_KEY=<new>
```

5. Or set it as the `GEMINI_API_KEY` Actions secret so `deploy-bot.sh` seeds it
   via `SOKONI_GEMINI_API_KEY`. Never commit it.
6. Redeploy: `SKIP_CATALOG_PUBLISH=1 SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh`
7. Confirm: `/health` should report `geminiConfigured` behaviour unchanged.

Gemini is only the last-resort vision fallback (OpenRouter free → NVIDIA NIM →
Gemini), so listings keep working even if you rotate and pause before step 8.

After rotation the leaked value is worthless, and everything below becomes
hygiene rather than incident response.

---

## Step 2 — rewrite history (optional, destructive, needs a quiet window)

This rewrites **every commit SHA in the repository**. Read all of it first.

### What it breaks

- Every existing clone must re-clone. `git pull` will not reconcile.
- Every open PR must be closed and reopened — their base SHAs stop existing.
- The VM's `~/sokoni` clone must be re-cloned; `deploy-bot.sh` does
  `git reset --hard origin/main`, which cannot cross a rewritten history.
- Any external link to a commit SHA breaks.

### Before you start

- Merge or close every open PR. At the time of writing #372 is merged and the
  14 stale ones are closed, so the tree is clean — keep it that way.
- Announce a freeze. No pushes during the rewrite.
- Take a full mirror backup:

```bash
git clone --mirror git@github.com:Murphy601/sokoni.git sokoni-backup.git
```

Keep that until you are certain the rewrite is good. It is the only undo.

### The rewrite

`git-filter-repo` is the supported tool (BFG also works; `filter-branch` is
deprecated and slow).

```bash
pip install git-filter-repo
```

```bash
git clone git@github.com:Murphy601/sokoni.git sokoni-rewrite && cd sokoni-rewrite
```

Replace the key everywhere it appears:

```bash
printf 'AQ.Ab8RN6JKsaorEvw8bvKc277LHDh3lL3HMWNbPhrz_LJxDKkhKQ==>REDACTED_ROTATED_KEY\n' > /tmp/secrets.txt
git filter-repo --replace-text /tmp/secrets.txt
```

Drop the buyer photos from every commit:

```bash
git filter-repo --invert-paths --path-glob 'website/assets/images/products/dispute_ev_*'
```

Verify nothing survives:

```bash
git log --all -S 'AQ.Ab8RN6JK' --oneline        # expect no output
git log --all --oneline -- 'website/assets/images/products/dispute_ev_*'   # expect no output
```

### Push

```bash
git remote add origin git@github.com:Murphy601/sokoni.git
git push --force --all && git push --force --tags
```

### Afterwards

Re-clone the VM, because its history no longer matches:

```bash
cd ~ && mv sokoni sokoni-old
git clone git@github.com:Murphy601/sokoni.git sokoni
cp -a sokoni-old/whatsapp-bot/data sokoni/whatsapp-bot/data     # gitignored state
cp -a sokoni-old/whatsapp-bot/.env sokoni/whatsapp-bot/.env
cd sokoni && SKIP_CATALOG_PUBLISH=1 SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
```

That `cp -a` of `data/` is the whole ballgame — it carries `orders.json`,
`settlements.json` and `withdrawals.json`. Verify the snapshot exists before
you move anything:

```bash
bash scripts/backup-bot-data.sh && ls -l ~/sokoni-backups | tail -3
```

Then ask GitHub Support to garbage-collect the unreferenced objects; until they
do, the old SHAs stay reachable by direct URL even after a force push.

---

## If you only do one thing

Step 1. A rotated key makes the history exposure historical rather than live.
The rewrite is worth doing, but not worth doing carelessly on a live
marketplace — schedule it, do not squeeze it in.
