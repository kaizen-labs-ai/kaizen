/**
 * Kaizen Theme Kit — CSS, component patterns, and prompt instructions
 * for generating consistently-styled HTML output.
 *
 * Injected into developer prompts when the theme_kit_enabled setting is true.
 */

/* ── Inline CSS (embedded in <style> by the developer) ─────────── */
export const THEME_CSS = `
:root {
  --radius: 0.625rem;
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--background); color: var(--foreground); line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--chart-1); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: "Geist Mono", "Fira Code", monospace; }
pre { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; overflow-x: auto; font-size: 0.875rem; }
code { background: var(--secondary); padding: 0.125rem 0.375rem; border-radius: calc(var(--radius) - 4px); font-size: 0.875em; }
pre code { background: none; padding: 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
.container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
.card { background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; }
.card-title { font-size: 1.125rem; font-weight: 600; }
.card-description { font-size: 0.875rem; color: var(--muted-foreground); margin-top: 0.25rem; }
.badge { display: inline-flex; align-items: center; padding: 0.125rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; background: var(--secondary); color: var(--secondary-foreground); border: 1px solid var(--border); }
.badge-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.badge-destructive { background: var(--destructive); color: white; border-color: transparent; }
.badge-success { background: oklch(0.35 0.1 150); color: oklch(0.9 0.1 150); border-color: transparent; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: var(--radius); font-size: 0.875rem; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--secondary); color: var(--secondary-foreground); transition: background 0.15s, opacity 0.15s; }
.btn:hover { opacity: 0.9; }
.btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover { background: var(--accent); }
.input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--input); border-radius: var(--radius); background: transparent; color: var(--foreground); font-size: 0.875rem; outline: none; }
.input:focus { border-color: var(--ring); box-shadow: 0 0 0 2px oklch(0.556 0 0 / 20%); }
.input::placeholder { color: var(--muted-foreground); }
.table-wrapper { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table.table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.table th { text-align: left; padding: 0.75rem 1rem; font-weight: 500; color: var(--muted-foreground); border-bottom: 1px solid var(--border); background: var(--card); }
.table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); }
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: var(--accent); }
.alert { padding: 1rem; border-radius: var(--radius); border: 1px solid var(--border); font-size: 0.875rem; }
.alert-info { background: oklch(0.25 0.05 260); border-color: oklch(0.4 0.1 260); color: oklch(0.85 0.05 260); }
.alert-warning { background: oklch(0.25 0.05 85); border-color: oklch(0.4 0.1 85); color: oklch(0.85 0.1 85); }
.alert-error { background: oklch(0.25 0.05 25); border-color: oklch(0.4 0.1 25); color: oklch(0.85 0.1 25); }
.alert-success { background: oklch(0.25 0.05 150); border-color: oklch(0.4 0.1 150); color: oklch(0.85 0.1 150); }
.tabs { display: flex; border-bottom: 1px solid var(--border); }
.tab { padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; color: var(--muted-foreground); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
.tab:hover { color: var(--foreground); }
.tab.active { color: var(--foreground); border-bottom-color: var(--primary); }
.progress { width: 100%; height: 0.5rem; background: var(--secondary); border-radius: 9999px; overflow: hidden; }
.progress-bar { height: 100%; background: var(--chart-1); border-radius: 9999px; transition: width 0.3s ease; }
.text-muted { color: var(--muted-foreground); }
.grid { display: grid; gap: 1rem; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
`.trim();


/* ── HTML Component Patterns ───────────────────────────────────── */
export const THEME_COMPONENTS = `
## Available Component Patterns

### Card
<div class="card">
  <div class="card-title">Title</div>
  <div class="card-description">Description text</div>
  <div style="margin-top: 1rem;">Card content here</div>
</div>

### Badge
<span class="badge">Default</span>
<span class="badge badge-primary">Primary</span>
<span class="badge badge-success">Success</span>
<span class="badge badge-destructive">Error</span>

### Button
<button class="btn">Default</button>
<button class="btn btn-primary">Primary</button>
<button class="btn btn-ghost">Ghost</button>

### Input
<input class="input" placeholder="Type here..." />
<textarea class="input" placeholder="Multi-line..."></textarea>

### Table
<div class="table-wrapper">
  <table class="table">
    <thead><tr><th>Name</th><th>Value</th></tr></thead>
    <tbody><tr><td>Item</td><td>123</td></tr></tbody>
  </table>
</div>

### Alert
<div class="alert alert-info"><strong>Info:</strong> Message here</div>
<div class="alert alert-warning"><strong>Warning:</strong> Message here</div>
<div class="alert alert-error"><strong>Error:</strong> Message here</div>
<div class="alert alert-success"><strong>Success:</strong> Message here</div>

### Tabs
<div class="tabs">
  <button class="tab active">Tab 1</button>
  <button class="tab">Tab 2</button>
</div>

### Progress Bar
<div class="progress"><div class="progress-bar" style="width: 65%;"></div></div>

### Grid Layout
<div class="grid grid-3">
  <div class="card">Col 1</div>
  <div class="card">Col 2</div>
  <div class="card">Col 3</div>
</div>

### Container (centered content)
<div class="container">
  <h1>Page Title</h1>
  <!-- content -->
</div>
`.trim();


/* ── Prompt Instructions ───────────────────────────────────────── */

export const THEME_DEVELOPER_INSTRUCTIONS = `
# Kaizen Theme Kit (ENABLED)

## Process — FOLLOW THIS ORDER:
1. **Identify components**: Determine which shadcn/ui components are needed (Table, Card, Dialog, Tabs, Badge, etc.)
2. **Fetch docs**: Call \`shadcn-docs\` for each component you need to get the exact structure, styles, and patterns
3. **Convert**: Translate the shadcn React component patterns into vanilla HTML + CSS + JS, using the Kaizen color variables below
4. **Build**: Produce the final self-contained HTML file with embedded <style> and <script>

## Base Theme CSS (ALWAYS include in <style>)

<style>
${THEME_CSS}
</style>

## Quick Reference — Common Patterns
${THEME_COMPONENTS}

## Rules
- ALWAYS call \`shadcn-docs\` to fetch the exact component structure before writing HTML. Do NOT guess the styles — fetch the real source.
- ALWAYS include the base theme <style> block above in any HTML file you produce.
- Convert shadcn React components to vanilla HTML+CSS+JS. Use the CSS variables above for all colors.
- For interactive components (tabs, dialogs, accordions), write vanilla JavaScript in a <script> tag.
- Dark background, light text — this is a dark theme. Never override the background to white or light colors.
- For charts/data visualization colors, use var(--chart-1) through var(--chart-5).
- For layout, use .container (max-width: 1200px centered) and .grid / .grid-2 / .grid-3.
- Do NOT add Tailwind CDN, React CDN, Bootstrap, or any other external framework.
`.trim();
