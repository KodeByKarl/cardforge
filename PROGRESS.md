# Progress Log

## 2026-10-29 — Phases 1–3
- Environment: empty directory; Node 26.13, npm 11.20; CorelDRAW Graphics Suite v27.2 installed on the dev PC (no X7).
- Scaffolded Electron 33 + electron-vite + React 18 + TS strict + Tailwind 3 + ExcelJS + Vitest + electron-builder.
- Built the import module end to end (parse → header detection → column setup → normalise → validate → table/issues UI).
- Settings (validated, atomic), structured logging, CorelDRAW detection (registry → server exe, stale detection).
- CorelDRAW PoC script passes on v27.2. Found and documented three PowerShell/COM pitfalls.
- Adapter interface + mock adapter for development.
- 42 unit tests passing; the app was driven end to end over CDP with a fixture workbook.
- Dev-environment workarounds (see README): Electron zip extraction under Node 26; `ELECTRON_RUN_AS_NODE` inherited from VS Code.

**Blocked on client:** X7 PoC run, real template, real spreadsheet, print specs (REQUIREMENTS.md).
**Next:** Phase 4: PowerShell bridge (`inspectTemplate`), template setup + mapping screen.
