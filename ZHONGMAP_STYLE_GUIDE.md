# ZhongMap Brand Style Guide

**Version**: 1.0
**Last Updated**: 2025-12-31

---

## 🎨 Brand Identity

**App Name**: ZhongMap (中 Map)
**Tagline**: Learn Chinese Characters Through Interactive Maps
**Brand Essence**: Warm, approachable, growth-oriented learning

**Logo**: Orange-to-green gradient representing the learning journey from beginner (warm orange) to mastery (growing green)

---

## Color Palette

### Primary Brand Colors

```javascript
// Extracted from ZhongMap logo gradient
PRIMARY_ORANGE: '#FF7C2E',    // Vibrant, energetic - main actions
PRIMARY_YELLOW: '#F5B840',    // Warm, optimistic - highlights
PRIMARY_GREEN: '#7BAA3C',     // Growth, success - mastery

// Brand Gradient
BRAND_GRADIENT: 'linear-gradient(135deg, #FF7C2E 0%, #F5B840 50%, #7BAA3C 100%)'
```

### Secondary Colors

```javascript
// Darker variations for emphasis
DARK_ORANGE: '#E06020',       // Hover states, pressed buttons
DARK_YELLOW: '#E0A830',       // Active states
DARK_GREEN: '#5C8A2E',        // Deep mastery, success

// Lighter variations for backgrounds
LIGHT_ORANGE: '#FFE8D9',      // Subtle backgrounds, highlights
LIGHT_YELLOW: '#FFF9E6',      // Warning backgrounds
LIGHT_GREEN: '#E8F4DC',       // Success backgrounds
```

### Neutral Colors

```javascript
// Text colors
DARK_TEXT: '#2C3E50',         // Primary text
MEDIUM_TEXT: '#5A6C7D',       // Secondary text
LIGHT_TEXT: '#7F8C8D',        // Tertiary text, hints

// Backgrounds & borders
WHITE: '#FFFFFF',             // Pure white
LIGHT_GRAY: '#F5F7FA',        // Light backgrounds
MEDIUM_GRAY: '#ECF0F1',       // Borders, dividers
DARK_GRAY: '#BDC3C7',         // Disabled states
```

### Semantic Colors

```javascript
// User feedback colors
SUCCESS: '#7BAA3C',           // Correct answers, achievements
WARNING: '#F39C12',           // Needs practice, medium difficulty
ERROR: '#E74C3C',             // Wrong answers, forgot
INFO: '#3498DB',              // Tips, information
```

### Quiz Quality Rating Colors

```javascript
// Spaced repetition quality ratings (0-5 scale)
QUALITY_FORGOT: {
  background: '#FFEBEE',      // Light red
  border: '#E74C3C',          // Red
  text: '#C0392B',            // Dark red
},

QUALITY_HARD: {
  background: '#FFF9E6',      // Light yellow
  border: '#F39C12',          // Orange-yellow
  text: '#D68910',            // Dark yellow
},

QUALITY_GOOD: {
  background: '#E8F4DC',      // Light green
  border: '#7BAA3C',          // Brand green
  text: '#5C8A2E',            // Dark green
},

QUALITY_PERFECT: {
  background: '#FFE8D9',      // Light orange (brand color)
  border: '#FF7C2E',          // Brand orange
  text: '#E06020',            // Dark orange
}
```

---

## Typography

### Font Families

```javascript
// System font stack for performance
FONT_FAMILY: {
  default: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  chinese: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  monospace: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Courier, monospace',
}
```

### Font Sizes

```javascript
FONT_SIZE: {
  hero: 48,           // Large Chinese characters in quiz
  title: 32,          // Screen titles
  subtitle: 24,       // Section headers
  large: 20,          // Pinyin, important text
  body: 16,           // Regular body text
  small: 14,          // Labels, secondary info
  tiny: 12,           // Metadata, hints
}
```

### Font Weights

```javascript
FONT_WEIGHT: {
  regular: '400',     // Body text
  medium: '500',      // Subtle emphasis
  semibold: '600',    // Buttons, labels
  bold: '700',        // Titles, headings
}
```

### Line Heights

```javascript
LINE_HEIGHT: {
  tight: 1.2,         // Headings, titles
  normal: 1.5,        // Body text
  relaxed: 1.8,       // Long-form content
}
```

---

## Spacing System

### Base Unit: 4px

```javascript
SPACING: {
  xs: 4,              // Minimal spacing
  sm: 8,              // Compact spacing
  md: 12,             // Standard spacing
  lg: 16,             // Comfortable spacing
  xl: 20,             // Generous spacing
  xxl: 24,            // Large spacing
  xxxl: 32,           // Section spacing
  huge: 40,           // Major sections
}
```

---

## Border Radius

```javascript
BORDER_RADIUS: {
  none: 0,            // Sharp corners
  small: 8,           // Small cards, inputs
  medium: 12,         // Standard cards, buttons
  large: 16,          // Quiz cards, panels
  xlarge: 20,         // Modal dialogs
  pill: 50,           // Circular buttons, badges
  circle: '50%',      // Perfect circles
}
```

---

## Shadows & Elevation

### Shadow System

```javascript
SHADOW: {
  none: 'none',

  // Neutral shadows
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },

  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },

  // Brand-colored shadows (for primary actions)
  brandSmall: {
    shadowColor: '#FF7C2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },

  brandMedium: {
    shadowColor: '#FF7C2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
}
```

---

## Component Styles

### Buttons

#### Primary Button (Main Actions)
```javascript
{
  backgroundColor: '#FF7C2E',        // Brand orange
  paddingVertical: 16,
  paddingHorizontal: 24,
  borderRadius: 14,
  shadowColor: '#FF7C2E',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 8,
  elevation: 6,
}

// Text
{
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: '600',
}
```

#### Secondary Button
```javascript
{
  backgroundColor: '#FFFFFF',
  paddingVertical: 16,
  paddingHorizontal: 24,
  borderRadius: 14,
  borderWidth: 2,
  borderColor: '#FF7C2E',
}

// Text
{
  color: '#FF7C2E',
  fontSize: 16,
  fontWeight: '600',
}
```

#### Success Button
```javascript
{
  backgroundColor: '#7BAA3C',
  paddingVertical: 16,
  paddingHorizontal: 24,
  borderRadius: 14,
}

// Text
{
  color: '#FFFFFF',
  fontSize: 16,
  fontWeight: '600',
}
```

### Cards

#### Quiz Card
```javascript
{
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#FFE8D9',            // Light orange tint
  padding: 24,
  shadowColor: '#FF7C2E',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  elevation: 3,
}
```

#### Standard Card
```javascript
{
  backgroundColor: '#FFFFFF',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#ECF0F1',
  padding: 16,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 4,
  elevation: 2,
}
```

### Quality Rating Buttons

#### Layout
```javascript
{
  flexDirection: 'row',
  gap: 8,
  width: '100%',
}

// Individual button
{
  flex: 1,
  paddingVertical: 16,
  paddingHorizontal: 8,
  borderRadius: 12,
  alignItems: 'center',
  borderWidth: 2,
  minHeight: 70,
  justifyContent: 'center',
}
```

#### Forgot (Quality 0)
```javascript
{
  backgroundColor: '#FFEBEE',
  borderColor: '#E74C3C',
}
```

#### Hard (Quality 2)
```javascript
{
  backgroundColor: '#FFF9E6',
  borderColor: '#F39C12',
}
```

#### Good (Quality 4)
```javascript
{
  backgroundColor: '#E8F4DC',
  borderColor: '#7BAA3C',
}
```

#### Perfect (Quality 5)
```javascript
{
  backgroundColor: '#FFE8D9',
  borderColor: '#FF7C2E',
}
```

### Speaker/Audio Button
```javascript
{
  padding: 12,
  backgroundColor: '#FFE8D9',        // Light orange
  borderRadius: 50,
  width: 56,
  height: 56,
  justifyContent: 'center',
  alignItems: 'center',
  shadowColor: '#FF7C2E',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.2,
  shadowRadius: 4,
  elevation: 3,
}

// Icon
{
  fontSize: 28,
}
```

---

## Navigation & Header Styles

### Header Bar
```javascript
{
  backgroundColor: '#FFFFFF',
  borderBottomWidth: 1,
  borderBottomColor: '#FFE8D9',      // Light orange border
  paddingHorizontal: 16,
  paddingVertical: 12,
}
```

### Tab Bar (Bottom Navigation)
```javascript
{
  backgroundColor: '#FFFFFF',
  borderTopWidth: 1,
  borderTopColor: '#ECF0F1',
  height: 60,
}

// Active tab
{
  color: '#FF7C2E',                  // Brand orange
}

// Inactive tab
{
  color: '#7F8C8D',                  // Gray
}
```

---

## Animation & Transitions

### Timing
```javascript
ANIMATION: {
  fast: 150,          // Quick feedback (button press)
  normal: 300,        // Standard transitions
  slow: 500,          // Gentle, noticeable changes
}
```

### Easing
```javascript
EASING: {
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
  spring: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',  // Bouncy
}
```

### Interactions
- **Button Press**: `activeOpacity: 0.7`
- **Haptic Feedback**: `Vibration.vibrate(50)` on important actions
- **Scale Animation**: Subtle 0.95-1.0 scale on press

---

## Icon System

### Sizes
```javascript
ICON_SIZE: {
  tiny: 16,
  small: 20,
  medium: 24,
  large: 32,
  xlarge: 48,
}
```

### Usage
- **Speaker Icon**: 🔊 (28px)
- **Fire/Streak**: 🔥 (20px)
- **Audio Mode**: 🎧 (20px)
- **Success**: ✅ (24px)
- **Reveal**: 👁️ (18px)

---

## Accessibility

### Contrast Ratios
- **Text on White**: Minimum 4.5:1 (WCAG AA)
- **Large Text on White**: Minimum 3:1
- **Interactive Elements**: Minimum 3:1

### Touch Targets
- **Minimum Size**: 44x44px (iOS HIG)
- **Recommended**: 48x48px (Material Design)
- **Quality Buttons**: 70px height

### Color Blindness
- Don't rely on color alone (use icons + text)
- Quality buttons use emoji + text labels
- High contrast borders on all interactive elements

---

## Usage Guidelines

### Do's ✅
- Use brand gradient for splash screens, hero sections
- Use orange (#FF7C2E) for primary CTAs (Start Quiz, Reveal Answer)
- Use green (#7BAA3C) for success states, mastery indicators
- Maintain 16px minimum padding around interactive elements
- Use consistent border radius (12-16px for most elements)

### Don'ts ❌
- Don't use pure black (#000000) - use #2C3E50 instead
- Don't mix border radius styles randomly
- Don't use colors outside the defined palette
- Don't create buttons smaller than 44x44px
- Don't use gradient on small text (readability issues)

---

## Logo Usage

### Variations
- **Full Logo**: ZhongMap text + gradient icon (for splash, about)
- **Icon Only**: Gradient "中" character (for app icon, small spaces)
- **Text Only**: "ZhongMap" with gradient (for headers)

### Placement
- **Home Screen**: Top center, full logo
- **Quiz Header**: Top left, icon only (small)
- **Profile**: Top of screen, full logo
- **Loading**: Center, full logo with animation

### Clear Space
- Minimum padding around logo: 16px on all sides
- Don't stretch, squish, or rotate the logo
- Don't change logo colors or gradient

---

## Platform-Specific Considerations

### iOS
- Use SF symbols when possible
- Respect safe area insets
- Follow iOS Human Interface Guidelines
- Use native blur effects for overlays

### Android
- Use Material Design icons
- Respect navigation bar height
- Use elevation for depth
- Support dark mode (future consideration)

---

## File Structure

```
/src
  /theme
    colors.js          # Color constants
    typography.js      # Font styles
    spacing.js         # Spacing scale
    shadows.js         # Shadow definitions
    components.js      # Component styles
  /components
    /common
      Button.js        # Reusable button component
      Card.js          # Reusable card component
      Badge.js         # Reusable badge component
```

---

## Version History

- **v1.0** (2025-12-31): Initial style guide based on ZhongMap logo
  - Defined color palette from brand gradient
  - Established typography scale
  - Created component style guidelines
  - Added accessibility standards

---

**Next Steps:**
1. Create theme configuration files
2. Implement brand colors in app components
3. Add logo to key screens
4. Test color contrast for accessibility
5. Gather user feedback and iterate
