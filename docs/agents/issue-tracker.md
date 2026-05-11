# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for issue operations.

## Repository

The GitHub repository is `Omnis-Labs/hunch-it`.

When running `gh` from inside this clone, infer the repository from `git remote -v`.

## Conventions

- Create an issue with `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list --state open --json number,title,body,labels,comments`.
- Comment with `gh issue comment <number> --body "..."`.
- Apply labels with `gh issue edit <number> --add-label "..."`.
- Remove labels with `gh issue edit <number> --remove-label "..."`.
- Close issues with `gh issue close <number> --comment "..."`.

## Skill behavior

When a skill says "publish to the issue tracker", create a GitHub issue.

When a skill says "fetch the relevant ticket", run `gh issue view <number> --comments`.
