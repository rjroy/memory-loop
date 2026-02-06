---
description: Prepare a release by updating CHANGELOG.md and nextjs/package.json
argument-hint: [version]
---

# Setup Release v$1

You are preparing release v$1 for Memory Loop.

## Step 1: Find the previous release tag

Run `git tag --list 'v*' --sort=-v:refname` to find the most recent release tag.

## Step 2: Gather changes since that tag

Run these commands to collect raw material:

1. `gh pr list --state merged --base main --search "merged:>=$(git log -1 --format=%ai <previous-tag>)" --limit 100 --json number,title,labels` to get merged PRs with issue numbers.
2. `git log <previous-tag>..HEAD --oneline` for commit history as a fallback if PR data is sparse.

## Step 3: Read the existing CHANGELOG

Read `CHANGELOG.md` to understand the format and style. Pay attention to:

- Section grouping (bold sub-headers like **Spaced Repetition System**)
- Keep a Changelog sections: Added, Changed, Removed, Fixed, Documentation
- Issue references in parentheses at end of bullet points (e.g., #396)
- Concise single-line descriptions

## Step 4: Draft the CHANGELOG entry

Insert a new section at the top of the changelog (after the preamble, before the previous version):

```
## [$1] - YYYY-MM-DD
```

Use today's date. Organize the changes following the existing style. Group related changes under bold sub-headers when 3+ items share a theme. Use your judgment on grouping and wording, matching the voice of existing entries.

## Step 5: Update nextjs/package.json

Change the `version` field in `nextjs/package.json` to `$1`.

## Step 6: Show the user what changed

Summarize what you did: the previous tag, how many PRs/commits were included, and the sections you created. Let the user review and adjust before committing.
