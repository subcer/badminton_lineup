---
name: Amber Hearth Professional
colors:
  surface: '#faf9f6'
  surface-dim: '#dbdad7'
  surface-bright: '#faf9f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f0'
  surface-container: '#efeeeb'
  surface-container-high: '#e9e8e5'
  surface-container-highest: '#e3e2df'
  on-surface: '#1a1c1a'
  on-surface-variant: '#56433b'
  inverse-surface: '#2f312f'
  inverse-on-surface: '#f2f1ee'
  outline: '#897269'
  outline-variant: '#dcc1b6'
  surface-tint: '#9b4417'
  primary: '#984215'
  on-primary: '#ffffff'
  primary-container: '#b85a2b'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb596'
  secondary: '#635d5a'
  on-secondary: '#ffffff'
  secondary-container: '#e6ded9'
  on-secondary-container: '#67625e'
  tertiary: '#446345'
  on-tertiary: '#ffffff'
  tertiary-container: '#5c7d5d'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcd'
  primary-fixed-dim: '#ffb596'
  on-primary-fixed: '#360f00'
  on-primary-fixed-variant: '#7c2e00'
  secondary-fixed: '#e9e1dc'
  secondary-fixed-dim: '#cdc5c0'
  on-secondary-fixed: '#1e1b18'
  on-secondary-fixed-variant: '#4b4642'
  tertiary-fixed: '#c7ecc6'
  tertiary-fixed-dim: '#acd0ab'
  on-tertiary-fixed: '#022109'
  on-tertiary-fixed-variant: '#2f4e32'
  background: '#faf9f6'
  on-background: '#1a1c1a'
  surface-variant: '#e3e2df'
typography:
  headline-xl:
    fontFamily: Manrope
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-tabular:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  sidebar-width: 280px
  gutter: 24px
---

## Brand & Style

The design system embodies a "Premium Hospitality" aesthetic, balancing the warmth of a traditional hearth with the precision of modern SaaS. It is designed for professional restaurant operators who require high-density data visualization without sacrificing visual elegance.

The style is a blend of **Modern Corporate** and **Glassmorphism**. It utilizes soft, layered depth and sophisticated translucent materials to create a clear hierarchy in complex management dashboards. The emotional response is one of reliability, warmth, and effortless control—moving away from casual utility toward a refined, institutional tool for culinary excellence.

## Colors

The palette centers on **Amber Hearth (#c06031)**, used strategically for primary actions and brand emphasis to maintain warmth. 

- **Primary:** Amber Hearth is reserved for high-contrast CTAs and active states.
- **Surface Neutrals:** We move away from flat grays to "Warm Stone" neutrals (#f8f7f4 and #f0ede9). These provide a sophisticated, organic backdrop that reduces eye strain during long shifts.
- **Secondary:** "Charcoal Oak" (#2d2926) is used for high-contrast typography and sidebar navigation backgrounds to provide a grounded, professional anchor.
- **Success/Data:** "Sage" (#5e7f5f) provides a muted, professional alternative to bright greens for status indicators and financial growth data.

## Typography

This design system utilizes **Manrope** for headlines to provide a modern, geometric, and professional structure. **Hanken Grotesk** is used for body and interface elements for its exceptional legibility and contemporary feel.

Numeric data—crucial for restaurant management—must always use `tabular-nums` to ensure that prices and quantities align perfectly in lists and tables. Labels use a slightly increased letter-spacing and uppercase styling to provide clear metadata markers without cluttering the UI.

## Layout & Spacing

The layout utilizes a **12-column fixed grid** for Desktop (1440px max-width) and an **8-column fluid grid** for Tablet. 

- **Sidebar:** A persistent 280px sidebar on Desktop provides high-level navigation. It collapses to an icon-only rail (80px) on Tablet to maximize workspace.
- **Rhythm:** A strict 8px-based spacing system ensures vertical rhythm. 
- **Containers:** Content is grouped into "Service Cards" with 24px internal padding. 
- **Data Density:** In management views, the gutter reduces to 16px to allow for more columns of information, while dashboard views utilize 40px margins to feel more premium and spacious.

## Elevation & Depth

Hierarchy is established through **Ambient Shadows** and **Tonal Layering**:

1.  **Level 0 (Floor):** Warm Stone (#f8f7f4) background.
2.  **Level 1 (Card):** White surfaces with a very soft, diffused shadow (0px 4px 20px rgba(45, 41, 38, 0.04)).
3.  **Level 2 (Active/Hover):** Cards lift slightly with a more pronounced shadow and a 1px internal border in the primary color at 10% opacity.
4.  **Level 3 (Modals/Overlays):** These utilize a **Glassmorphism** effect: a white surface at 80% opacity with a 20px backdrop blur. This keeps the restaurant floor context visible while focusing on the management task.

## Shapes

The design system uses a "Sophisticated Rounded" language. 

- **Standard Elements:** Buttons, inputs, and small chips use a **12px** radius (represented by `rounded-md`).
- **Surface Containers:** Dashboard cards and large modals use a **16px** radius (`rounded-lg`) to create a softer, more premium feel.
- **Navigation:** Sidebar active states use a "squircle" or pill-shape on one side to indicate selection.

## Components

### Buttons & CTAs
Primary buttons use the Amber Hearth (#c06031) background with white text and a subtle 2px bottom shadow for a tactile feel. Secondary buttons use a "Warm Stone" ghost style with a 1px border.

### Sidebar Navigation
The sidebar uses a dark theme (#2d2926) to contrast with the light workspace. Active states are indicated by a vertical Amber Hearth bar and a subtle 5% white overlay on the menu item.

### Management Cards
Used for table status or menu items. These feature a "Glass" header for category titles and a clean white body for data points. Status indicators (Occupied, Cleaning, Reserved) use soft-colored pills with Sage or Amber tints.

### Inputs & Tables
Form fields use a 1px "Stone" border that thickens to 2px in Amber Hearth upon focus. Tables use subtle horizontal dividers (1px #f0ede9) and no vertical borders, ensuring a clean, breathable data display.

### Data Visualization
Charts should use the Primary Amber, Sage Green, and Charcoal Oak. Avoid bright "web" colors; keep the palette "baked" and organic.