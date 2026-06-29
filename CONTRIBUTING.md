# Contributing to ResMonix

Thank you for your interest in contributing to ResMonix! We welcome all contributions to make this disk and resource management tool better.

## How Can I Contribute?

### Reporting Bugs & Feature Requests
* Search existing issues before creating a new one.
* Use a clear and descriptive title.
* Provide steps to reproduce, expected vs. actual behavior, and include logs if possible.

### Suggesting Enhancements
* Explain the use case and why this feature would be useful.
* Keep it detailed and aligned with the project design aesthetics.

### Code Contributions
1. **Fork the Repository** and clone it locally.
2. **Create a Branch** using a logical prefix:
   * `feat/feature-name` for new features
   * `fix/bug-name` for bug fixes
   * `docs/documentation-changes` for docs
3. **Commit your changes**:
   * Write clear commit messages in English.
   * Format: `type(scope): brief description` (e.g. `feat(memory): add graph sorting`).
4. **Follow Project Rules**:
   * Use `bun` (not `npm` or `yarn`) for package management and scripts.
   * Write clean TypeScript and Rust code.
   * Keep files focused and optimized in length.
5. **Submit a Pull Request** to the `main` branch. Provide a detailed summary of what your changes accomplish.

## Setup Instructions

Make sure you have:
* [Bun](https://bun.sh/) installed.
* [Rust](https://www.rust-lang.org/) (cargo, rustc) installed.
* Tauri CLI installed (via `bun install`).

To start the development server:
```bash
bun run dev
```

To build a release package:
```bash
# On Windows, you can double-click build.bat or run:
./build.bat
```
