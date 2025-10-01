## Render Deployment Notes

Use these settings in the Render Web Service form:

Build Command:
```
pip install --upgrade pip
pip install -r requirements.txt
```

Start Command:
```
uvicorn api_server:app --host 0.0.0.0 --port $PORT
```

Python Version: picked automatically from `runtime.txt` (3.11.9).

Do NOT install OS packages (like portaudio) in the build command; PyAudio was removed for this reason.

Set Environment Variable:
```
API_KEY=<your gemini key>
```

Test after deploy:
```
GET /api/health
```
