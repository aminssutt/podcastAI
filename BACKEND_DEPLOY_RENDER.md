# Deploying FastAPI Backend to Render

## 1. Repo structure (expected by this guide)
```
.
├── api_server.py          # FastAPI app entry
├── requirements.txt       # Python deps
├── Procfile               # (optional) Heroku-style process declaration
├── runtime.txt            # (optional) python version hint
├── data/                  # ephemeral JSON job storage
└── frontend/              # (ignored by backend build, separate Netlify deploy)
```

## 2. Fast steps (TL;DR)
1. Push repo to GitHub.
2. Go to https://dashboard.render.com → New → Web Service.
3. Select repo.
4. Environment: Python 3.11.
5. Build Command:
   ```
   pip install -r requirements.txt
   ```
6. Start Command:
   ```
   uvicorn api_server:app --host 0.0.0.0 --port $PORT
   ```
7. Add Environment Variable:
   - `API_KEY` = your Gemini key.
8. Deploy → Note the URL → use in Netlify as `VITE_API_BASE`.

## 3. Health check
After deploy test:
```
GET https://<your-service>.onrender.com/api/health
```
Should return:
```json
{"ok": true, "jobs_in_memory": 0}
```

## 4. CORS
Currently `allow_origins=["*"]`. For production you can tighten:
```python
allow_origins=["https://your-netlify-site.netlify.app"]
```

## 5. Persistence caveat
`data/jobs/*.json` is on ephemeral disk. Redeploy clears memory; files may persist until next build but **not guaranteed**. For durable storage later: attach DB (Redis, Postgres, or S3-like bucket).

## 6. Local test parity
```bash
pip install -r requirements.txt
uvicorn api_server:app --reload
```

## 7. Common issues
| Symptom | Cause | Fix |
|---------|-------|-----|
| 500 on first TTS call | Missing API_KEY | Set env var in Render dashboard |
| CORS error in browser | Wildcard blocked by corporate proxy | Add explicit origin |
| SSE not streaming | Corporate network buffering | Try different network or disable proxy |
| Long cold start | Free tier idle spin-up | Hit /api/health before first user |

## 8. Next enhancements
- Add `/api/version` with git commit hash.
- Swap JSON file persistence for DB.
- Structured logging (uvicorn access log + custom). 

---
Happy shipping!
