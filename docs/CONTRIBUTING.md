# Contributing — branch discipline (in force from the first second person)

Two people now touch this repo, so these rules are on (playbook Phase 17):

1. **`main` is protected and always deployable.** Nobody pushes to `main` directly — including the owner. It only moves by merging a green PR from `dev` or a feature branch.
2. **All work happens on branches** (`dev` for integration, `feat/*` for features), merged by pull request.
3. **CI green is required to merge.** The Actions run (syntax → lint → 47 smoke tests → dependency audit) is the referee; a red X blocks the merge.
4. **PRs stay reviewable** — split anything over ~400 changed lines.
5. **Rebases/force-pushes on shared branches are announced first** — they require everyone else to re-sync (`git fetch && git reset --hard origin/<branch>` after committing their work).

## One-time GitHub setup (owner, ~2 minutes)
GitHub → repo **Settings → Branches → Add branch protection rule**:
- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass → select the **CI / checks** workflow
- ✅ Include administrators
Save. (Optional but recommended: the same for `dev` minus the PR requirement.)

## Current branch map
- `main` — deployable, mirrors reviewed work
- `dev` — integration branch (CI runs here too)
- `dev1` — davidagyekum's fork of the app (large rework). **Open item:** agree together which parts merge back (the category-image feature already has), then retire the branch to stop the drift.

## Ownership
| Area | Owner |
|---|---|
| Storefront, catalogue, orders, deploys | Calvin |
| `dev1` rework, storage/product-image hardening | David |
| Anything unlisted | Calvin until assigned |
