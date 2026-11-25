# Instructions for Claude

The owner of this repository is new to GitHub. Keep explanations simple and
friendly, and handle the git and GitHub steps yourself.

## How code gets merged here

- Always work on a branch whose name starts with `claude/`.
- Commit your work and push that branch. That's all: the
  `.github/workflows/auto-merge.yml` workflow runs the tests, opens a pull
  request into `main`, and merges it automatically.
- You do not need to open or merge pull requests by hand.
- If the workflow fails (failing tests or a merge conflict), fix the cause on
  the branch and push again.
- After a merge the branch is deleted. For more work, start again from the
  latest `main`.
