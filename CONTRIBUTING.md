# Contributing to RadCore

## The flow

1. No work without a Linear ticket (team Radboards-ERP, project "RadCore v2").
2. Branch from `dev`. Name the branch `<ticket-id>-<slug>`, lowercase: `rad-6-repository-guardrails`.
   Do not use Linear's suggested name: it starts with a user prefix (`jainsarthak0205/...`). The
   `branch-name` check fails any other name.
3. Open a PR into `dev` and fill in the template.
4. A PR is merged only after auditor PASS, e2e-playwright PASS (user-facing tickets only) and the
   coordinator's check. Only the coordinator merges. Nobody pushes to `dev` or `main` directly.

## Commit identity

Commits must record the account that owns the repository, **sarthakradboards-hash**, not a personal
email. v1's deployments were blocked for exactly this.

Set it once per clone. It is stored in the repository's own `.git/config`, so every worktree of the
clone uses it:

```bash
git config --local user.name "Sarthak Jain"
git config --local user.email "330352763+sarthakradboards-hash@users.noreply.github.com"
```

Check before your first commit:

```bash
git config user.email
```

It must print the `users.noreply.github.com` address above.

## Never commit

- Secrets: passwords, API keys, tokens, `.env` files with real values.
- The restricted security appendix (02b) or anything quoted from it.
- Real customer, employee or bank data.
