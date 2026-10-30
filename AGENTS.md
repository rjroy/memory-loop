# Project guidance

- Use Beads for significant work: inspect existing issues and dependencies before creating one, then claim the appropriate issue before implementation.
- Record deferred work in a durable Beads issue, not only in a comment, TODO, or design document. Documents may link to the issue.
- Label actionable open issues `agentic` when scope is settled, or `escalate` when a user decision is needed. Keep parent routing consistent with its next action. Close issues only after their work is verified.
- For a sequence of Beads issues, use a dedicated working branch and make a checkpoint commit for each verified issue before starting the next, including only that issue's changes and relevant Beads updates. Stop if verification or committing is blocked. Explicit instructions not to commit take precedence. Never push without approval.
