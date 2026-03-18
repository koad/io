# Commit Command

A koad-io command that uses opencode to intelligently create git commit messages for the currently staged files.

## Usage

```bash
koad-io commit staged [optional context]
```

## Requirements

- `ENTITY` environment variable must be set
- `OPENCODE_MODEL` environment variable must be set in the entity's `.env` file

## What It Does

This command invokes opencode with your configured agent to analyze staged changes, then creates well-formatted git commit messages following best practices.

## Configuration

Set these in your entity's `.env` file:

```bash
OPENCODE_MODEL=your-preferred-model
```
