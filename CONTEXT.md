

## 2026-11-25 23:46 UTC, Mason

## Wave 6 plan (draft, written by Mason's Claude, 2026-11-25). NOT pushed yet. Nobody starts a task until BOTH humans approve.

**What it is:** `TASKS.md` in BOTH repos was rewritten as the Wave 6 plan (Wave 5 text stays in git history). Source docs: the three Google Docs polish.md, goals.md, ideas.md, plus unfinished backlog from priorityImprovements.md. The files are local in Mason's checkout for now; Mason decides when to push (PR title `Documentation: ...`). Sections 0, 1, 2, 7, 8 are identical in both repos; sections 3-6 are per repo.

**Lanes kept as they were:** Mason = processor/**, .gitignore, frontend src/lib, src/api, App.jsx, main.jsx, theme.js, JobStatusPanel, tests/unit, README, root config, package*.json. Drew = server/**, .github/workflows, backend README/.env.example/Dockerfile/docs, frontend src/pages, src/components (except JobStatusPanel), src/hooks, tests/e2e, playwright config. Files a task creates belong to that task's owner. One planned handover: Mason's F-N1 creates stub pages JobsPage.jsx and MetadataPage.jsx, which become Drew's after it merges.

**Priorities:** P1 = polish.md + Mason's priority: human-written README + GIF, remove unneeded files, FILE UPLOAD (user's own videos), jobs DATABASE + jobs TABLE (Supabase), EXPORT formats. P2 = color picker fix, settings + help, UI polish, metadata + geolocation, nav tabs (legacy vs new), sign-in, mobile-first. P3 = hosting + old backlog.

**Decisions already made by Mason:** free Supabase (DB + sign-in) and Vercel (frontend). Everything else is a default in Section 7 (D1-D10) waiting for the humans. Important one: Vercel cannot run our Java+ffmpeg backend, so D2 = where the backend runs (needs a Docker host); B-H1 starts with a written comparison, no deploy before Mason picks.

**New API (Section 2, build both halves in parallel against it):** optional `Authorization: Bearer <supabase token>`; `POST /api/videos` (multipart field `video`) -> 201 `{filename}`; `GET /api/videos/:filename/metadata` -> VideoMetadata; `GET /api/jobs` -> JobSummary[] (401 for guests); `POST /process` may now return 429. All under `/api`, so no vite proxy change. Existing routes/JAR args/CSV unchanged.

**DREW'S BACKEND TASKS (strict order, all touch server/app.js):** B-S1 validation (ext allowlist, threshold cap) -> B-U1 upload route (needs OK to add `multer`, decision D3) -> B-DB1 job store behind an interface (runJob stays synchronous!) -> B-DB2 Supabase job store (+ docs/supabase-schema.sql; falls back to the file store when no env, so tests need no account) -> B-A1 optional auth middleware -> B-J1 GET /api/jobs -> B-M1 metadata via ffprobe (+ parse ISO 6709 location) -> B-E2 recover stuck jobs -> B-S2 cap concurrent jobs -> B-H1 Dockerfile + deploy notes (after Mason picks host) -> B-D3 README, WRITTEN BY HAND BY DREW (polish.md says no AI-written README; agent may only verify commands/links and comment).
**DREW'S FRONTEND TASKS (strict order):** F-U1 upload UI (file picker + phone Record button; needs Mason's F-API1) -> F-E2 sturdier polling -> F-R2 extract hooks -> F-C1 color picker fix (native <input type=color> opens an OS dialog over the frame; replace with click-the-frame sampling + hex field beside the frame) -> F-J1 jobs table page (needs F-N1, F-API1, F-A2) -> F-M1 metadata page (needs F-N1, F-API1) -> F-P2 throttle preview (needs Mason's F-P1) -> F-B2 recent jobs restore settings via `?color=&threshold=` (needs F-ST1) -> F-UX1 UI polish (needs F-TH1 + decision D10) -> F-MB1 mobile-first (needs F-TH2) -> F-T2 stronger e2e -> F-D2 JSDoc.
**MASON'S TASKS (for awareness):** backend: S-0 Supabase setup, B-R1 tidy root, B-B1, B-R2, B-P1, B-B2, B-P2, B-D1. Frontend: F-API1 and F-N1 FIRST (they unblock Drew), then F-R3, F-S2, F-O1, F-B1, F-S1, F-P1, F-A1, F-A2, F-ST1, F-X1 (export), F-TH1, F-TH2, F-H1, F-D1 (README + GIF, by hand).

**Open item for Drew / Drew's Claude:** goals.md says "Add Geolocation tags to videos (Paunchy revise this one)". I defaulted it to: read the location tag from the file's metadata (ffprobe), show it and link to a map; we do not write tags into videos (decision D6). Please confirm or revise.

**Please:** read Section 7 (decisions D1-D10) and say which defaults you disagree with. Don't start any branch yet.

## 2026-11-26 00:19 UTC, Mason

## Decision (2026-11-25, Mason): Wave 6 plan approved, all defaults final
Mason made the executive call: no sign-off from Drew is needed. Every default in `TASKS.md` Section 7 is final, including D6 (geolocation = read the file's location tag, show it, link to a map, never write tags). Already decided earlier: local only (B-H1 and F-H1 parked), `multer` approved, PR prefix `Other:`, no `AI Used` commit prefix. Drew's agent may start its first task in each repo, in the order in Section 4, one open branch per repo. Drew's first tasks: backend B-S1, then B-U1. Frontend F-U1 waits for Mason's F-API1 to merge. Pull `main` in both repos first.
