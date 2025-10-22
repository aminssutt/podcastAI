# 🎙️ PodcastAI

**AI-powered podcast generator** using Google Gemini API for transcript generation and text-to-speech.

[![Deployed Backend](https://img.shields.io/badge/Backend-Render-46E3B7?style=flat-square)](https://podcastai-frh3.onrender.com)
[![Deployed Frontend](https://img.shields.io/badge/Frontend-Netlify-00C7B7?style=flat-square)](#)

## 📋 Features

### 🎯 Generated Podcast
- **Custom podcast creation** based on text or voice prompts
- **1-2 speakers** with configurable male/female voices
- **Multi-language support**: English, French, Spanish, German, Italian, Portuguese, Korean, Chinese
- **Internet-augmented generation** for factual content
- **Real-time streaming** of transcript generation

### 📍 Localisation Podcast
- **GPS auto-detection** of user's current location
- **Theme-based content**: Culture, History, Music, Sport
- **Single-speaker monologue** format
- **Contextual local details** automatically incorporated

### 🎵 Audio Generation
- **Real-time TTS** using Gemini 2.5 Flash TTS
- **30 voice options** (14 female + 16 male)
- **Automatic fallback** to placeholder audio if TTS fails
- **90-second podcast limit** (~225 words)

## 🏗️ Architecture

```
podcast_generator/
├── api_server.py          # FastAPI backend (769 lines)
├── requirements.txt       # Python dependencies
├── Procfile              # Render deployment config
├── runtime.txt           # Python 3.11.9
├── netlify.toml          # Frontend deployment config
├── data/jobs/            # Persistent podcast storage (JSON)
└── frontend/             # React 19 + Vite SPA
    ├── src/
    │   ├── pages/        # 8 route components
    │   ├── api/          # Backend service client
    │   ├── styles/       # CSS modules
    │   └── ui/           # Shared components
    └── package.json
```

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Google Gemini API Key ([Get one here](https://aistudio.google.com/apikey))

### Backend Setup

```bash
cd podcast_generator

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "API_KEY=your_gemini_api_key_here" > .env

# Run development server
uvicorn api_server:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at: **http://localhost:8000**

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Frontend will be available at: **http://localhost:5173**

## 🌐 Deployment

### Backend (Render)
See [BACKEND_DEPLOY_RENDER.md](BACKEND_DEPLOY_RENDER.md) for detailed instructions.

**Quick deploy:**
1. Push to GitHub
2. Create Web Service on Render
3. Set environment variable: `API_KEY=your_gemini_key`
4. Deploy with:
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn api_server:app --host 0.0.0.0 --port $PORT`

### Frontend (Netlify)
1. Configure `netlify.toml` with your backend URL
2. Connect GitHub repo to Netlify
3. Deploy automatically on push

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API info |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/version` | Version metadata |
| `POST` | `/api/generate` | Start podcast generation |
| `GET` | `/api/stream/{job_id}` | SSE transcript stream |
| `GET` | `/api/audio/{job_id}` | Get generated audio |
| `GET` | `/api/full/{job_id}` | Get complete job data |
| `POST` | `/api/save/{job_id}` | Save podcast to library |
| `GET` | `/api/saved` | List saved podcasts |
| `DELETE` | `/api/saved/{job_id}` | Remove from saved |
| `DELETE` | `/api/job/{job_id}` | Delete job |

## 📱 Tech Stack

**Backend:**
- FastAPI 0.119+
- Uvicorn (ASGI server)
- Google Gemini API (LLM + TTS)
- Server-Sent Events (SSE) for streaming
- In-memory + JSON persistence

**Frontend:**
- React 19
- React Router 7
- Vite 5.4
- Native Web APIs (MediaRecorder, Geolocation)
- Custom CSS (NouvelR font)

## 🎤 Voice Options

**Female voices (14):** Zephyr, Kore, Leda, Aoede, Callirrhoe, Autonoe, Despina, Erinome, Laomedeia, Achernar, Pulcherrima, Vindemiatrix, Sulafat, Gacrux

**Male voices (16):** Puck, Charon, Fenrir, Orus, Enceladus, Iapetus, Algenib, Rasalgethi, Alnilam, Schedar, Zubenelgenubi, Sadaltager, Umbriel, Achird, Sadachbia

## 🛡️ Environment Variables

### Backend
```env
API_KEY=your_gemini_api_key          # Required
ALLOWED_ORIGINS=https://your-frontend.netlify.app  # Optional (CORS)
```

### Frontend
```env
VITE_API_BASE=https://your-backend.onrender.com  # Required
```

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 🐛 Known Limitations

- **Ephemeral storage**: Jobs stored in-memory + JSON files (lost on redeploy)
- **90-second limit**: Podcasts automatically truncated to ~225 words
- **No authentication**: Open API (add auth for production)
- **CORS**: Currently set to `allow_origins=["*"]` (restrict in production)

## 📧 Contact

For questions or support, please open an issue on GitHub.

---

**Made with ❤️ using Google Gemini API**
