# Progress: Read Later

## Status: 🔲 Not Started

## To Do

- [ ] Implement local storage read later
- [ ] Implement DDP methods
- [ ] Add popup UI
- [ ] Add "read later" button to popup

## Storage Options

**Local Storage** (default):
- Saved to `chrome.storage.local`
- Key: `readLater`

**Passenger Storage**:
- Via DDP method `passenger.readLater.add`
- Synced to entity's database

## DDP Methods

- `passenger.readLater.add({url, title, added})`
- `passenger.readLater.remove(url)`
- `passenger.readLater.list()`

## Dependencies

- Feature: 008-passenger-skill-registry (for DDP methods)

## Notes

Simple bookmarking feature - can work without a passenger (local storage) or with one (synced).
