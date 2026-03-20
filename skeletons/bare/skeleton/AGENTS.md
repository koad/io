# AGENTS.md – Context-Driven Agent Workflow

## 1. Skeleton Loading
- On session start, scan the folder for:
  - `context.md` – authoritative source for project info.
  - `features/` – working memory folder for all feature files.
  - Preset skeletons/templates in `src/preset/`.

## 2. Context Handling
- **If `context.md` exists:**
  - Load it fully.
  - Treat all info in it as the source of truth.
- **If `context.md` does NOT exist:**
  - Ask which file to start with.
  - Heavily suggest using an exported conversation from the user’s favorite agent.
  - If the user insists on no context file, **remain in Question Period** and gather all project/feature info interactively.

## 3. Question Period – **PLAN MODE ENFORCED**
- **Plan Mode is active**: nothing can be written, modified, or implemented.
- Purpose: resolve all uncertainties **before touching any files**.
- Rules:
  1. Ask about all desired features; ensure **the `features/` folder will reflect the full outcome**.
  2. Reference `context.md` whenever possible.
  3. **Never assume** any details.
  4. Once all questions are resolved, explicitly state:
     > “I am satisfied; Question Period complete.”

## 4. Build Mode / Specialist Mode
- Triggered by the user after Question Period ends.
- Purpose: incrementally implement features and update `features/`.
- Rules:
  - Follow confirmed answers and context strictly.
  - Work feature by feature, guided by checklists.
  - Do not start new features until prior checklists are complete.
  - Keep everything small, incremental, and context-driven.

## 5. Features Folder Guidelines
- Each feature/concept gets a markdown file in `features/`.
- **Feature Template** (place in `features/template.md`):

```

# Feature: [Feature Name]

## Description

[Copied or interpreted from context]

## Checklist

* [ ] Task 1
* [ ] Task 2
* [ ] Task N

## Notes

[Context references, clarifications, design constraints]

## Code Snippets

[Optional starter code from skeleton or preset]

```

- Always ensure each file represents a **full concept or feature set**.
- Update checklists as tasks progress; mark completed tasks clearly.

## 6. Workflow Summary
1. Load `AGENTS.md`.
2. Load `context.md` (or resolve missing context via questions).
3. Enter **Question Period (Plan Mode)**.
4. Resolve all ambiguities; confirm feature list completeness.
5. Declare satisfaction → exit Question Period.
6. Enter Build/Specialist Mode to implement features incrementally.


# koad:io Development Environment

## Description
This is the platform-level, inherited feature for the koad:io development space. It defines the **context for all other features** and is **not user-facing**. It provides:

- A complete catalog of available Meteor/koad-io packages:
  - `~/.koad-io/packages/`  
  - `~/.ecoincore/packages/`  
  - `src/packages/` in the local project
- A **reactive event bus via DDP**, enabling near-instant updates across multiple apps, screens, and parties.
- Platform inheritance: all user-facing features (login, dashboards, state) reference this environment for helpers, templates, and reactive streams.
- Sovereign, modern architecture: multi-app PWAs can share a Mongo backend locally or via DDP without requiring cloud services.

## Checklist
- [ ] Enumerate all packages in each package location
- [ ] Verify availability of reactive helpers and utilities
- [ ] Confirm DDP connections are possible and accessible
- [ ] Document relevant packages for each future feature
- [ ] Ensure all reactive updates (state, session, dashboards) reference DDP where applicable
- [ ] Keep this feature **Plan Mode only**; do not implement user-facing code here

## Notes
- The environment is **authoritative context**. All features must reference it.
- DDP is the mechanism for real-time updates; do not assume Mongo polling.
- Treat this feature as a **pipeline/bus** for creating user-facing features.
- Always consult `context.md` or skeleton before planning or implementing.

## Example: Enumerate Packages
```bash
echo $METEOR_PACKAGE_DIRS
````

