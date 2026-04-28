# CentralFolio - Project Context

## Architecture Overview
- **Backend**: Node.js + Express proxy server, SQLite (`better-sqlite3`) for persistent storage (settings, connections, account mappings). Handles SnapTrade HMAC request signing and Bank of Canada FX rate fetching.
- **Frontend**: React 19 SPA with Vite, React Router, TanStack Query, TradingView Lightweight Charts, Recharts.
- **Data Model**: Single user operator. N people with N Wealthsimple accounts via SnapTrade API. All values normalized to CAD.
- **Local Dev**: Run `backend` and `frontend` separately (e.g., via `npm run dev`). No Docker used for local development.

## Important File Pointers
- **Project Specs & Design**: `project.md` (Reference only specific sections when needed to save tokens)
- **Backend Proxy Entry**: `backend/server.js`
- **Database & State**: `backend/db.js`
- **Frontend Layout & Context**: `frontend/src/App.jsx`

## Claude Efficiency Rules
1. **Provide Specifics**: Ask for changes with precise file paths and line numbers instead of vague requests to reduce exploration.
2. **Output Diffs**: Provide changes as code diffs rather than full file rewrites.
3. **Session Hygiene**: Start new sessions for distinct tasks. Proactively use the `/compact` command after completing sub-tasks to free up context.
4. **Trim Context Input**: Provide minimal snippets, omitting unused code and excessive comments.
5. **Minimize File Reads**: Avoid redundant file re-reading to verify changes; assume successful application when appropriate.
