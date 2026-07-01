# ResMonix Development Rules & Guidelines

These workspace-scoped rules guide development, coding style, theme aesthetics, and internationalization standards for the ResMonix System Resource Manager.

## 🛠️ Stack & Coding Style
- **Package Manager**: Use **Bun** exclusively. Do not run `npm`, `pnpm`, or `yarn`.
- **Framework**: React 19 with TypeScript (`tsconfig.json` rules must be strictly followed).
- **State Management**: Zustand stores in `src/store/`. Keep actions and selectors highly performant.
- **Modularity**: Avoid overly large files. Keep components modular, extracting smaller UI blocks (e.g. process details, tree components) into their own sub-folders.
- **Code split / Performance**: Eagerly import only core layouts (Toolbar, Sidebar, StatusBar). All module views (Dashboard, MemoryView, Suggestions, Disk Treemap, etc.) must be lazy-loaded using `React.lazy()` and wrapped under a `<Suspense>` boundary to maintain instant startup times.

## 🎨 Theme & Design Aesthetics
- **Default Theme**: Default to dark mode by setting `class="dark"` on the `<html>` element. The native window background color should match `#121212` (configured as `[18, 18, 18, 255]` in `tauri.conf.json`) to prevent white flashes during webview initialization.
- **Color Palette**: Use modern HSL / OKLCH tailored dark mode colors (e.g., deep dark backgrounds `#121212` / `oklch(0.145 0 0)`, border overlays `oklch(1 0 0 / 10%)`). Avoid basic browser defaults.
- **UI Elements**: Follow Shadcn-like design aesthetics. Use smooth animations, hover effects, and modern icons from `lucide-react`.
- **Skeleton Screens**: Always implement clean, pulsing skeleton screens matching the dark mode variables (`--skeleton-bg`, `--skeleton-card`) for initial loading states in `index.html`.

## 🌐 Internationalization (i18n)
- **Multi-language Support**: Fully support both English (`en`) and Vietnamese (`vi`).
- **No Hardcoded UI Strings**: Do not hardcode user-facing strings in UI component files. Always use the `t()` translation hook from `react-i18next`.
- **Translation Keys**: Keep translation keys organized inside namespace objects matching their view logic:
  - `ui.*` for core application Shell tabs and language buttons.
  - `memory.*` for RAM history, optimization tools, and pool descriptions.
  - `disk.*` for scanning, file structure, sizes, and action prompts.
  - `process_detail.*` for process table headers, analysis results, and process info panels.
  - `suggestions.*` for optimization categories (titles, category tags, and descriptions).
  - `classifier.*` for file descriptor details retrieved from path analysis.
- **Backend String Translation**: Any raw Vietnamese strings returned by the Rust backend (e.g. file description labels, safety analysis notes, error messages) must be intercepted, mapped, and translated on the frontend React side using helper functions before rendering.

## 🦀 Rust & Tauri Rules
- Keep native scanning, memory management, and system-level operations in the Rust backend (`src-tauri`).
- Handle permissions carefully. If operations require Administrator privileges (e.g. optimization modes, deep clean, system process termination), ensure the backend returns a clear warning, and the frontend handles the error gracefully by prompting the user or disabling controls.
