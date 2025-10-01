# Podcast AI Frontend

React 19 + Vite SPA connected to a FastAPI backend (Render) that streams transcript tokens (SSE) and serves generated audio.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Structure
```
frontend/
  index.html
  vite.config.js
  package.json
  src/
    main.jsx
    pages/
      App.jsx
      Home.jsx
    ui/Icons.jsx
    styles/
      global.css
      home.css
```

## Environment Variables
Set before build (Netlify or local):

```
VITE_API_BASE=https://your-backend.onrender.com
```

Local override:
```bash
VITE_API_BASE=http://localhost:8000 npm run dev
```

## Backend Contract Summary
- POST /api/generate (multipart/form-data) -> { job_id }
- SSE  /api/stream/{job_id} events: meta | chunk | done | error
- GET  /api/full/{job_id}
- GET  /api/audio/{job_id}
- POST /api/save/{job_id}
- GET  /api/saved

`chunk` event payload example:
```json
{ "delta": "text fragment or null when truncated", "full": "full transcript so far", "truncated": false }
```
`done` event payload includes: `title`, `full`, `truncated`.

If `truncated` is true, the transcript hit the ~90s soft cap.

## Deployment (Netlify + Render)
1. Deploy backend (FastAPI) to Render, note the base URL.
2. In Netlify UI => Site settings => Environment variables: add `VITE_API_BASE` with the Render URL.
3. Trigger a new deploy (or push a commit).
4. Open browser console and verify:
```js
import.meta.env.VITE_API_BASE
```
5. Generate a podcast and watch the SSE stream (Network tab -> EventStream).

## CORS
Backend supports env var `ALLOWED_ORIGINS` (comma separated). Set it on Render, e.g.:
```
ALLOWED_ORIGINS=https://your-site.netlify.app
```
Leave empty in development for wildcard.

## Error Handling Notes
- Network drop mid-SSE: call `streamTranscript` again (idempotent; transcript state kept server side).
- 400 on /api/audio if job not finished: poll /api/status until `status===done`.

## Future Enhancements
- Display a badge if truncated.
- Retry with exponential backoff on transient fetch errors.
- Offline cache of saved podcasts (IndexedDB).

## License
Internal prototype.
