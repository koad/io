# koad:io-templating

**Meteor package name:** `koad:io-templating`  
**Version:** 3.6.9

The Blaze helper library and reactive layout engine for koad:io applications. Provides ~60 global template helpers organized by domain, plus `ApplicationLayout` — a multi-panel window manager for Blaze.

## Installation

```bash
meteor add koad:io-templating
```

This package is implied by `koad:io`, so apps using the main package get it automatically.

## Dependencies

- `ecmascript`
- `underscore`
- `meteor-base`
- `blaze-html-templates`
- `reactive-var`
- `mizzao:timesync`
- `momentjs:moment`
- `koad:io-session` (implied)

All dependencies are implied — they propagate to consuming apps.

## Exports

| Symbol | Scope | Description |
|--------|-------|-------------|
| `ApplicationLayout` | client | Reactive multi-panel layout manager |

## Template Helpers

All helpers are global Blaze helpers, registered for use in any template. Names use PascalCase to distinguish global helpers from local template data properties.

### Application (`01-application.js`)
`SiteTitle`, `Instance`, `Version`, `Build`, `SiteLogo`, `Ident`, `Copyright`, `CopyrightText`, `CopyrightYear`, `BrandName`, `AppName`, `AppVersion`, `AppBuild`, `AppSlogan`, `Hoster`, `PrivacyPolicyUrl`

### User (`02-user.js`)
`UserId`, `Uid`, `Username`, `DisplayName`, `AvatarUrl`, `Firstname`, `Lastname`, `Profile`, `AccountAge`, `UserGreetingString`, `Scrobble`, `Packages`

### Roles (`03-roles.js`)
`UserIsInRole(uid, role)`, `UserHasRole(role)`, `IsDesktop`

### Status (`04-status.js`)
`SiteInMaintenance`, `SiteOnline`, `DevModeEnabled`, `IsBetaContentEnabled`, `IsLoggedInUser`, `LoggedInUserOwnsThis`, `IsPopup`

### Numbers (`05-numbers.js`)
`ToFixed(num, decimals)`, `NumberWithCommas(num, decimals)`, `NumberOfDecimals(num)`, `CentsToDollars(cents)`, `FormatCentsToDollars(cents)`, `DenominationsToFractions(denom)`

### Dates (`06-dates.js`)
`Reldate(date)`, `FromNow(date)`, `Now`, `Timestamp(date)`, `FormatDate(date)`, `DayOfWeek(date)`, `FullSizedDate(date)`, `DaysAgo(count)`, `LastSunday`, `StartTime`, `DatePlus1000(ts)`, `WasWithinTheLastNineMinutes(date)`

### Strings (`07-strings.js`)
`ToLowercase(str)`, `Substring(str, len, post)`, `Stringify(obj)`, `Json(obj)`, `FormatHash(hash)`, `HiddenIp(ip)`, `Arrayify(obj)`

### Arrays (`08-arrays.js`)
`Length(array)`, `First(array)`, `FirstN(array, n)`, `RandomN(array, n)`, `JoinArrayWithCommas(array)`

### Cursors (`09-cursors.js`)
`CursorCount(cursor)`, `HasItems(cursor)`, `HasMultipleItems(cursor)`

### Misc (`10-misc.js`)
`DeviceIcon(device)`, `IsObject(thing)`, `IsReady`, `IsSettingToggledOn(key)`, `TypeIsBoolean`, `TypeIsString`, `ObjectKeysLength(obj)`, `GetRolesForUser(id)`

### Constants (`00-constants.js`)

Reactive dependencies available globally:

| Name | Description |
|------|-------------|
| `tick1s` | Reactive dependency, invalidates every second |
| `tick1m` | Reactive dependency, invalidates every minute |
| `screenSize` | Reactive dependency, invalidates on window resize |

Time constants: `SECONDS` (1000ms), `MINUTES`, `HOURS`, `DAYS`, `WEEKS`, `MONTHS`, `YEARS`

## ApplicationLayout

A reactive multi-panel window manager for Blaze. Manages which panels are visible, handles navigation history, and supports gesture-based navigation.

```javascript
// Switch to a panel
ApplicationLayout.set('panelName');

// Navigate with history (supports back())
ApplicationLayout.go('panelName');

// Go back
ApplicationLayout.back();
```

Source: `client/layout/engine.js`

## File Structure

```
templating/
├── package.js
├── PRIMER.md
└── client/
    ├── helpers/
    │   ├── templates.html       ← helper template definitions
    │   ├── 00-constants.js
    │   ├── 01-application.js
    │   ├── 02-user.js
    │   ├── 03-roles.js
    │   ├── 04-status.js
    │   ├── 05-numbers.js
    │   ├── 06-dates.js
    │   ├── 07-strings.js
    │   ├── 08-arrays.js
    │   ├── 09-cursors.js
    │   ├── 10-misc.js
    │   └── 11-events.js
    └── layout/
        ├── templates.html       ← layout markup
        ├── logic.js             ← layout controller
        ├── styles.css           ← layout styles
        ├── engine.js            ← ApplicationLayout core
        ├── gestures.js          ← swipe/gesture support
        └── history.js           ← navigation history
```

## Notes

- `mizzao:timesync` dependency means the package requires server-side time synchronization
- `koad:io-session` is implied — persistent session is always available in apps using this package
- Do not confuse `koad:io-templating` (this package) with the Meteor core `templating` package
- `io-template-helpers/` in this packages tree is an earlier version (v0.0.2); this package (`templating/`) supersedes it
