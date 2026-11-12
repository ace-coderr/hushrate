#!/usr/bin/env bash
# Commits the files the agent generated under data/ and pushes them, without ever rebasing or merging.
#
# Why: the workflow's data must always win. A plain "git pull --rebase" can stop on a conflict when
# someone pushed to the same data file while a run was in progress (this broke run #5).
#
# How: save the generated files, then on every attempt fetch, hard-reset to the remote branch, copy the
# generated files back over it, commit and push. A rejected push just repeats the whole cycle.
#
# Run it from a copy outside the checkout (the reset may replace files in the working tree, this one included).
set -euo pipefail

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
ATTEMPTS="${ATTEMPTS:-3}"
STASH="$(mktemp -d)"
GENERATED=(market latest.json history.json status.json ledger.json receipts)

mkdir -p "$STASH/data"
for p in "${GENERATED[@]}"; do
  if [ -e "data/$p" ]; then cp -R "data/$p" "$STASH/data/"; fi
done
echo "saved generated files: $(ls "$STASH/data" | tr '\n' ' ')"

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "attempt $attempt of $ATTEMPTS"
  git fetch --quiet "$REMOTE" "$BRANCH"
  git reset --hard "$REMOTE/$BRANCH" --quiet 2>/dev/null || git reset --hard FETCH_HEAD --quiet
  mkdir -p data
  cp -R "$STASH/data/." data/        # the run's files win over anything on the remote
  for p in "${GENERATED[@]}"; do
    if [ -e "data/$p" ]; then git add "data/$p"; fi
  done
  if git diff --cached --quiet; then echo "no new data"; exit 0; fi
  git commit --quiet -m "Record market tape $(date -u +%Y-%m-%dT%H:%MZ)"
  if git push --quiet "$REMOTE" "HEAD:$BRANCH"; then
    echo "pushed $(git rev-parse --short HEAD) on attempt $attempt"
    exit 0
  fi
  echo "push rejected on attempt $attempt; re-fetching"
  sleep $((attempt * 3))
done

echo "::error::could not push generated data after $ATTEMPTS attempts"
exit 1
