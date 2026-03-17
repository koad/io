# Progress: Passenger & Skill Registry

## Status: 🔄 In Progress

## Completed (Daemon)

- [x] Daemon detects entities with passenger.json
- [x] Daemon exposes passenger list via DDP
- [x] passenger.json schema supports buttons/skills
- [x] Dynamic script loading from URLs
- [x] Custom DDP endpoint per passenger
- [x] URL ingestion method (passenger.ingest.url)
- [x] Identity resolution (passenger.resolve.identity)
- [x] DDP-augmented skills (passenger.get.augments)
- [x] Domain warnings (passenger.check.url)
- [x] Dynamic skill registry (passenger.get.skills)
- [x] TL;DR summarization (passenger.summarize)

## Remaining (Extension)

- [ ] Extension calls ingest.url for all passengers
- [ ] Extension resolves identity on page load
- [ ] Extension displays identity profile in popup
- [ ] Extension loads augments from DDP
- [ ] Extension displays domain warnings
- [ ] Extension displays passenger selector UI
- [ ] Extension executes button actions
- [ ] Extension loads remote scripts from skill URLs
- [ ] Extension settings for enable/disable per passenger
- [ ] Extension matches skills to current site URL

## Priority Order

1. Passenger selector UI (basic functionality)
2. Load skills from passenger.json
3. Execute button actions
4. Domain warnings display
5. Augments loading from DDP
6. Identity resolution
7. Settings page

## Notes

This is the most complex feature - it's the core of what makes passengers useful in the browser.
