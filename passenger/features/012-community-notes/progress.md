# Progress: Community Notes

## Status: 🔲 Not Started

## To Do

- [ ] Define note JSON schema
- [ ] Define settings schema for note sources
- [ ] Implement note fetching from git repos
- [ ] Implement passenger.get.notes method
- [ ] Integrate with warning system
- [ ] UI for managing note sources

## Note Schema Fields

| Field | Type | Description |
|-------|------|-------------|
| domain | string | Target domain |
| note | string | The note content |
| severity | string | info/warning/danger/critical |
| category | string | scam/fake-news/phishing/malware/spam/legit |
| author | string | Author's handle |
| entity | string | Entity name |
| status | string | unverified/pending/verified/disputed |

## DDP Methods Needed

- `passenger.get.notes` - Fetch notes for a domain/URL
- `passenger.save.note` - Save a personal note

## Dependencies

- Feature: 008-passenger-skill-registry (for warnings)
- Feature: 009-passenger-settings (for note sources config)

## Notes

This can work as personal notes only (stored locally) or as community notes (fetched from git repos).
