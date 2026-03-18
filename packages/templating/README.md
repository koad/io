# koad:io-template-helpers

Template helpers for koad:io Meteor applications.

## Naming Convention

All global template helpers in koad:io start with a capital letter (PascalCase). This follows the Meteor/Blaze convention where global helpers are distinguished from data properties.

## File Structure

```
client/helpers/
├── 00-constants.js     # Global constants and reactive dependencies
├── 01-application.js   # App settings and configuration
├── 02-user.js          # User-related helpers
├── 03-roles.js         # Roles and permissions
├── 04-status.js        # Site status and session state
├── 05-numbers.js       # Number formatting
├── 06-dates.js        # Date and time formatting
├── 07-strings.js      # String manipulation
├── 08-arrays.js       # Array operations
├── 09-cursors.js      # MongoDB cursor helpers
├── 10-misc.js         # Miscellaneous helpers
└── 11-events.js       # Event handlers and template events
```

## Available Helpers

### Application (`01-application.js`)
| Helper | Description |
|--------|-------------|
| `SiteTitle` | Site title from settings |
| `Instance` | Koad instance |
| `Version` | App version |
| `Build` | App build number |
| `SiteLogo` | Site logo URL |
| `Ident` | Instance identifier |
| `Copyright`, `CopyrightText`, `CopyrightYear` | Copyright info |
| `BrandName` | Brand name |
| `AppName`, `AppVersion`, `AppBuild`, `AppSlogan` | Application info |
| `Hoster` | Hoster information |
| `PrivacyPolicyUrl` | Privacy policy URL |

### User (`02-user.js`)
| Helper | Description |
|--------|-------------|
| `UserId`, `Uid` | Current user ID |
| `Username` | Current username |
| `DisplayName` | User's display name |
| `AvatarUrl` | User avatar URL |
| `Firstname`, `Lastname` | Name parts |
| `Profile` | User profile object |
| `AccountAge` | Account creation date |
| `UserGreetingString` | Time-based greeting |
| `Scrobble` | Now playing info |
| `Packages` | List of Meteor packages |

### Roles (`03-roles.js`)
| Helper | Description |
|--------|-------------|
| `UserIsInRole(uid, role)` | Check if user is in role |
| `UserHasRole(role)` | Check if current user has role |
| `IsDesktop` | Check if viewing on desktop |

### Status (`04-status.js`)
| Helper | Description |
|--------|-------------|
| `SiteInMaintenance` | Is site in maintenance mode |
| `SiteOnline` | Is site online |
| `DevModeEnabled` | Is developer mode enabled |
| `IsBetaContentEnabled` | Is beta content enabled |
| `IsLoggedInUser` | Check if logged in user matches |
| `LoggedInUserOwnsThis` | Check ownership |
| `IsPopup` | Check if popup |

### Numbers (`05-numbers.js`)
| Helper | Description |
|--------|-------------|
| `ToFixed(num, decimals)` | Format number (0-8 decimals) |
| `NumberWithCommas(num, decimals)` | Format with commas |
| `NumberOfDecimals(num)` | Get decimal count |
| `CentsToDollars(cents)` | Convert cents to dollars |
| `FormatCentsToDollars(cents)` | Format as currency string |
| `DenominationsToFractions(denom)` | Convert denomination to fraction |

### Dates (`06-dates.js`)
| Helper | Description |
|--------|-------------|
| `Reldate(date)` | Relative date (e.g., "5 minutes ago") |
| `FromNow(date)` | Time from now |
| `Now` | Current time string |
| `Timestamp(date)` | Formatted timestamp |
| `FormatDate(date)` | Locale formatted date |
| `DayOfWeek(date)` | Day of week name |
| `FullSizedDate(date)` | Full formatted date |
| `DaysAgo(count)` | Date N days ago |
| `LastSunday` | Date of last Sunday |
| `StartTime` | Start time from data context |
| `DatePlus1000(ts)` | Convert timestamp to date |
| `WasWithinTheLastNineMinutes(date)` | Check if recent |

### Strings (`07-strings.js`)
| Helper | Description |
|--------|-------------|
| `ToLowercase(str)` | Convert to lowercase |
| `Substring(str, len, post)` | Truncate string |
| `Stringify(obj)` | JSON stringify |
| `Json(obj)` | Log JSON to console |
| `FormatHash(hash)` | Format hash for display |
| `HiddenIp(ip)` | Partially hide IP address |
| `Arrayify(obj)` | Convert object to array |

### Arrays (`08-arrays.js`)
| Helper | Description |
|--------|-------------|
| `Length(array)` | Array length |
| `First(array)` | First element |
| `FirstN(array, n)` | First N elements (default 3) |
| `RandomN(array, n)` | Random N elements (default 20) |
| `JoinArrayWithCommas(array)` | Join with commas |

### Cursors (`09-cursors.js`)
| Helper | Description |
|--------|-------------|
| `CursorCount(cursor)` | Count cursor items |
| `HasItems(cursor)` | Check if cursor/array has items |
| `HasMultipleItems(cursor)` | Check if cursor/array has >1 item |

### Misc (`10-misc.js`)
| Helper | Description |
|--------|-------------|
| `DeviceIcon(device)` | Get icon for device type |
| `IsObject(thing)` | Check if value is object |
| `IsReady` | Check if template is ready |
| `IsSettingToggledOn(key)` | Check if setting is enabled |
| `TypeIsBoolean`, `TypeIsString` | Type checking helpers |
| `ObjectKeysLength(obj)` | Count object keys |
| `GetRolesForUser(id)` | Get user roles |

### Events (`11-events.js`)
- Double-press Escape to enable dev mode
- Click `.btn-dump-json` to dump object to console
- `hoverableTimestamp` template with hover functionality

## Constants (`00-constants.js`)

### Reactive Dependencies
| Name | Description |
|------|-------------|
| `tick1s` | Triggers every second |
| `tick1m` | Triggers every minute |
| `screenSize` | Triggers on window resize |

### Time Constants
| Name | Value |
|------|-------|
| `SECONDS` | 1000 |
| `MINUTES` | 60000 |
| `HOURS` | 3600000 |
| `DAYS` | 86400000 |
| `WEEKS` | 604800000 |
| `YEARS` | 31536000000 |
| `MONTHS` | 2628000000 |
