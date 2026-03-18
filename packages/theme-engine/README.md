# koad:io-theme-engine

A dynamic theme engine for [Meteor](https://github.com/meteor/meteor) applications built on the koad:io framework. This package provides a CSS-based theming system with HSL color variables, dark mode support, and programmatic theme control.

## Installation

```shell
meteor add koad:io-theme-engine
```

## Dependencies

This package requires:
- `koad:io-core` - Core koad:io functionality
- `templating` - Meteor templating
- `tracker` - Meteor reactivity
- `reactive-var` - Reactive variables

## Features

### Dynamic Color System
- HSL-based color calculations
- Automatic color transformations
- CSS custom properties for all theme colors

### Dark Mode Support
- Toggle between light and dark themes
- Automatic brightness calculation
- CSS variable-based implementation

### Programmatic Control
- Set theme hue programmatically
- Enable/disable theme rotation
- Reactivity support for theme changes

### Responsive Design
- Mobile-first responsive utilities
- Media query support
- Flexible content width

## CSS Variables

The theme engine provides a comprehensive set of CSS variables that can be used throughout your application.

### Core Variables

```css
:root {
  /* Base hue (0-360 degrees) */
  --application-hue: 200;
  
  /* Saturation (0-100%) */
  --application-saturation: 61;
  
  /* Brightness (0-100%) */
  --application-brightness: 10;
  
  /* Transparency (0-100%) */
  --application-transparency: 10;
  
  /* Content width */
  --content-width: 90vw;
}
```

### Derived Colors

The theme engine automatically calculates these derived colors:

| Variable | Description |
|----------|-------------|
| `--text-color` | Main text color |
| `--background-color` | Background color |
| `--accent-color` | Accent color for highlights |
| `--shadow-color` | Color for shadows |
| `--border-color` | Border color |
| `--highlight-color` | Highlight color |
| `--primary` | Primary brand color |
| `--secondary` | Secondary color |
| `--success` | Success state color |
| `--info` | Info state color |
| `--warning` | Warning state color |
| `--danger` | Danger/error color |

### Color Palette

The following named colors are also available:

```css
--blue, --indigo, --purple, --pink, --red, --orange, --yellow, --green, --teal, --cyan, --white, --gray, --gray-dark
```

### Typography

```css
--font-family: /* System fonts */
--body-font: /* Body text font */
--heading-font: /* Headings font */
--table-font: /* Table font */
--card-font: /* Card component font */
```

## JavaScript API

### koad.theme

The theme engine exposes a global `koad.theme` object:

```javascript
// Current hue (false or number)
koad.theme.hue

// Set theme hue
koad.theme.set.hue(200);  // Set to blue

// Toggle dark mode
koad.theme.darkmode.toggle();
```

### Setting the Theme Hue

```javascript
// Set a specific hue (0-360)
koad.theme.set.hue(0);    // Red
koad.theme.set.hue(120);   // Green
koad.theme.set.hue(240);   // Blue

// Set hue from template
Template.myTemplate.helpers({
  setHue: function() {
    koad.theme.set.hue(180); // Cyan
  }
});
```

### Dark Mode Toggle

```javascript
// Toggle between light and dark mode
koad.theme.darkmode.toggle();
```

The dark mode toggle switches:
- `--application-brightness` between 10 and 90
- `--text-brightness` between 90 and 10

### Template Helper

```html
{{#if HasTheme}}
  <div>Theme is active</div>
{{/if}}
```

Returns `true` if a theme hue has been set.

## Usage Examples

### Basic Usage

The theme engine works automatically. Simply include the package:

```javascript
meteor add koad:io-theme-engine
```

The default theme will be applied based on settings.

### Customizing via Settings

Configure the theme in your `settings.json`:

```json
{
  "public": {
    "application": {
      "theme": {
        "hue": 200,
        "saturation": 61,
        "brightness": 10
      }
    }
  }
}
```

### Programmatic Theme Control

```javascript
// In your client code
Meteor.startup(() => {
  // Set theme hue after login
  koad.theme.set.hue(200);
  
  // Or based on user preference
  if (userPreferences.darkMode) {
    koad.theme.darkmode.toggle();
  }
});
```

### Using CSS Variables

```css
/* In your component styles */
.my-component {
  background-color: var(--background-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
}

.my-button {
  background-color: var(--primary);
  color: var(--accent-text-color);
}

.my-shadow {
  box-shadow: 0 4px 6px var(--shadow-color);
}
```

### Responsive Content

```css
.content {
  width: var(--content-width);
  max-width: 1200px;
  margin: 0 auto;
}
```

## Theme Rotation

The theme engine includes a rotation feature that cycles through hues. This is disabled by default but can be enabled:

```javascript
// In your client code
Meteor.startup(() => {
  // Enable theme rotation
  // theme.rotator = setInterval(updateHue, 1000);
});
```

## Dark Mode Implementation

The dark mode toggle works by manipulating CSS variables:

```javascript
function toggleDarkMode() {
  const rootStyle = getComputedStyle(document.documentElement);
  const brightness = rootStyle.getPropertyValue('--application-brightness').trim();
  
  // Switch between 10 (dark) and 90 (light)
  document.documentElement.style.setProperty('--application-brightness', 100 - brightness);
  document.documentElement.style.setProperty('--text-brightness', brightness);
}
```

## Browser Compatibility

The theme engine requires:
- CSS Custom Properties (CSS Variables)
- ES6 (const, arrow functions)

Supported browsers:
- Chrome 49+
- Firefox 31+
- Safari 9.1+
- Edge 15+

## Overriding Styles

The theme engine provides base styles that can be overridden. Add your custom styles after the package loads:

```css
/* Your custom styles */
:root {
  --application-hue: 250; /* Override default hue */
  --application-saturation: 80%; /* Override saturation */
}

body {
  /* Override body styles */
  font-family: var(--body-font);
}
```

## File Structure

```
theme-engine/
├── package.js           # Package definition
├── logic.js             # Client-side theme logic
└── styles/
    ├── 01-normalize.css   # CSS normalization
    ├── 02-variables.css   # CSS custom properties
    ├── body.css           # Base body styles
    └── media-queries.css  # Responsive utilities
```

## Events

The theme changes are reactive and will automatically update all styled elements:

```javascript
Tracker.autorun(() => {
  // This will re-run when theme changes
  console.log('Current hue:', koad.theme.hue);
});
```
