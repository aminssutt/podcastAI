import os
import uuid
import asyncio
import json
from typing import Dict, Any
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv
import io
import wave
import math
import struct
import random
from datetime import datetime
from pathlib import Path

# Load environment variables from .env if present
load_dotenv()

# Simple in-memory job store (POC only)
jobs: Dict[str, Dict[str, Any]] = {}

# Minimal persistence (so that a uvicorn reload does not lose freshly generated podcasts)
BASE_DATA_DIR = Path(__file__).parent / "data"
JOBS_DIR = BASE_DATA_DIR / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

PERSIST_FIELDS = [
    "status", "title", "transcript", "speakers", "voices", "use_internet",
    "saved", "category", "saved_at", "theme", "geo_location", "voice_names", "language", "truncated"
]

def _persist_job(job_id: str):
    j = jobs.get(job_id)
    if not j:
        return
    try:
        data = {k: j.get(k) for k in PERSIST_FIELDS if k in j}
        data["job_id"] = job_id
        with open(JOBS_DIR / f"{job_id}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        print(f"[persist] failed to write job {job_id}: {e}")

def _load_job(job_id: str) -> bool:
    fp = JOBS_DIR / f"{job_id}.json"
    if not fp.exists():
        return False
    try:
        with open(fp, "r", encoding="utf-8") as f:
            data = json.load(f)
        jobs[job_id] = data  # trust stored structure
        return True
    except Exception as e:
        print(f"[persist] failed to load {job_id}: {e}")
        return False

LLM_MODEL_ID = "gemini-2.0-flash"
TTS_MODEL_ID = "gemini-2.5-flash-preview-tts"

# Approximate generation duration controls
# Spoken average: ~2.3–2.7 words/sec. Using 2.5 for estimation.
MAX_SPOKEN_SECONDS = 90  # 1 min 30
AVG_WORDS_PER_SECOND = 2.5
MAX_TRANSCRIPT_WORDS = int(MAX_SPOKEN_SECONDS * AVG_WORDS_PER_SECOND)  # ~225

def get_client():
    api_key = os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("API_KEY not set in environment (.env or system var)")
    return genai.Client(api_key=api_key)

app = FastAPI(title="PodcastAI API", version="0.1.0")

# Allow overriding CORS origins in production with a comma-separated env var ALLOWED_ORIGINS
_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
if _origins_env:
    _allowed_origins = [o.strip() for o in _origins_env.split(',') if o.strip()]
else:
    _allowed_origins = ["*"]  # fallback for local/dev

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "name": "PodcastAI API",
        "version": app.version,
        "health": "/api/health",
        "version_endpoint": "/api/version",
        "generate": "/api/generate (POST form)",
        "stream": "/api/stream/{job_id}",
        "audio": "/api/audio/{job_id}",
        "status": "/api/status/{job_id}",
        "saved": "/api/saved"
    }

@app.get("/api/health")
async def health():
    """Simple health endpoint for deployment platforms (Render/Railway/Fly) to probe."""
    return {"ok": True, "jobs_in_memory": len(jobs)}

@app.get("/api/version")
async def version():
    """Return build/runtime metadata helpful for troubleshooting deployments."""
    import sys
    return {
        "app_version": app.version,
        "python_version": sys.version.split()[0],
        "commit": os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or None,
        "jobs_cached": len(jobs),
    }

@app.post("/api/generate")
async def start_generation(
    prompt_mode: str = Form(..., regex="^(text|audio)$"),
    text: str = Form(""),
    use_internet: bool = Form(False),
    speakers: str = Form("1"),
    voices: str = Form(""),  # comma separated gender codes (M/F)
    category: str = Form("generated"),  # 'generated' | 'localisation'
    theme: str = Form(""),  # culture | history | music | sport (only for localisation)
    geo_location: str = Form(""),  # free-form location / city / place (only for localisation)
    audio_file: UploadFile | None = File(None),
    language: str = Form("")  # optional default language code (en, fr, es, de, it, pt, ko, zh)
):
    # Allow empty text only for localisation (we will synthesize a seed prompt)
    if prompt_mode == "text" and not text.strip():
        if category != "localisation" or not geo_location.strip():
            return JSONResponse(status_code=400, content={"error": "Text prompt empty"})
    if prompt_mode == "audio" and audio_file is None:
        return JSONResponse(status_code=400, content={"error": "Audio file missing"})

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "transcript": "",
        "title": None,
        "use_internet": use_internet,
    }
    if language.strip():
        jobs[job_id]["language"] = language.strip().lower()
    # Store initial content (text placeholder may be empty for localisation)
    if prompt_mode == "text":
        jobs[job_id]["raw_input"] = text if text.strip() else ""
    else:
        # Store placeholder; actual transcription will occur lazily in stream endpoint
        jobs[job_id]["raw_input"] = "<audio>"
        try:
            audio_bytes = await audio_file.read()
            jobs[job_id]["audio_bytes"] = audio_bytes
            jobs[job_id]["audio_mime"] = audio_file.content_type or "audio/webm"
        except Exception as e:
            jobs[job_id]["audio_error"] = f"Failed to read audio: {e}"  # fallback; will continue with placeholder
    # Normalize category
    if category not in ("generated", "localisation"):
        category = "generated"
    jobs[job_id]["category"] = category
    # Store localisation extras if relevant
    if category == "localisation":
        # Force single speaker regardless of provided param to keep UX consistent
        speakers = "1"
        norm_theme = theme.lower().strip()
        allowed_themes = {"culture", "history", "music", "sport"}
        if norm_theme not in allowed_themes:
            norm_theme = "culture"
        jobs[job_id]["theme"] = norm_theme
        jobs[job_id]["geo_location"] = geo_location.strip()
        # If no user text provided, synthesize a seed raw_input so improvement model has context
        if prompt_mode == "text" and not text.strip():
            seed = (
                f"Localisation seed: Generate an engaging educational monologue about the {norm_theme} aspects of "
                f"{geo_location.strip()}. Include authentic cultural details and keep tone informative and lively."
            )
            jobs[job_id]["raw_input"] = seed

    # Store speaker configuration for later prompt enrichment
    try:
        spk_count = int(speakers)
    except ValueError:
        spk_count = 1
    voices_list = [v.strip().upper() for v in voices.split(',') if v.strip()]
    jobs[job_id]["speakers"] = spk_count
    jobs[job_id]["voices"] = voices_list  # genders (M/F)
    # Pre-select concrete voice names now for stability (one per speaker)
    voice_names = []
    for idx in range(spk_count):
        gender = voices_list[idx] if idx < len(voices_list) else None
        voice_names.append(_pick_voice(gender or 'M'))
    jobs[job_id]["voice_names"] = voice_names
    return {"job_id": job_id}

def _generate_placeholder_audio(transcript: str, speakers: int, voices: list[str]) -> bytes:
    """Generate a simple WAV (sine tones) representing the transcript.
    - Each speaker gets a base frequency depending on gender & index.
    - Duration of a line proportional to its character length.
    This is ONLY a POC placeholder until real TTS is integrated.
    """
    sample_rate = 16000
    lines = [ln.strip() for ln in transcript.splitlines() if ln.strip()]
    if not lines:
        lines = [transcript.strip() or "(empty)"]

    # Frequency maps
    base_map_m = [150, 190]  # male speakers
    base_map_f = [240, 280]  # female speakers
    fallback_map = [200, 260]

    def speaker_freq(idx: int) -> int:
        gender = None
        if idx < len(voices):
            gender = voices[idx]
        if gender == 'M':
            return base_map_m[idx if idx < len(base_map_m) else 0]
        if gender == 'F':
            return base_map_f[idx if idx < len(base_map_f) else 0]
        return fallback_map[idx if idx < len(fallback_map) else 0]

    # Parse speaker from line prefix (Speaker 1:, Speaker 2:)
    def detect_speaker(line: str) -> int:
        if line.lower().startswith('speaker 1:'): return 0
        if line.lower().startswith('speaker 2:'): return 1
        return 0

    frames = []  # list of bytes chunks
    for raw_line in lines:
        line = raw_line
        spk = detect_speaker(line)
        # Remove label from audio content length calc
        if line.lower().startswith('speaker 1:'):
            spoken_content = line[len('Speaker 1:'):].strip()
        elif line.lower().startswith('speaker 2:'):
            spoken_content = line[len('Speaker 2:'):].strip()
        else:
            spoken_content = line

        # Duration heuristics
        char_count = max(len(spoken_content), 1)
        duration = min(4.0, 0.45 + char_count * 0.03)  # cap at 4s
        freq = speaker_freq(spk)
        total_samples = int(duration * sample_rate)
        # Simple amplitude envelope (attack / release)
        attack = int(0.05 * total_samples)
        release = int(0.08 * total_samples)
        two_pi_f = 2 * math.pi * freq
        for i in range(total_samples):
            t = i / sample_rate
            # envelope
            if i < attack:
                env = i / attack
            elif i > total_samples - release:
                env = max(0.0, (total_samples - i) / release)
            else:
                env = 1.0
            sample = 0.32 * env * math.sin(two_pi_f * t)
            # pack as 16-bit PCM
            frames.append(struct.pack('<h', int(sample * 32767)))
        # brief silence between lines
        gap_samples = int(0.18 * sample_rate)
        for _ in range(gap_samples):
            frames.append(struct.pack('<h', 0))

    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b''.join(frames))
    return buffer.getvalue()


@app.get("/api/stream/{job_id}")
async def stream_transcript(job_id: str):
    if job_id not in jobs:
        return JSONResponse(status_code=404, content={"error": "Job not found"})

    client = get_client()
    use_internet = jobs[job_id]["use_internet"]
    raw_input = jobs[job_id]["raw_input"]
    # If raw_input is placeholder and we have audio bytes, attempt transcription once
    if raw_input == "<audio>" and jobs[job_id].get("audio_bytes") and not jobs[job_id].get("transcribed_audio"):
        try:
            jobs[job_id]["status"] = "transcribing"
            audio_part = types.Part.from_bytes(
                data=jobs[job_id]["audio_bytes"],
                mime_type=jobs[job_id].get("audio_mime", "audio/webm")
            )
            transcription_instruction = (
                "Transcribe the spoken audio accurately. Output only the plain text transcript without speaker labels. "
                "Do not invent content beyond what is clearly heard."
            )
            transcript_text = client.models.generate_content(
                model=LLM_MODEL_ID,
                contents=[audio_part, transcription_instruction]
            ).text.strip()
            if transcript_text:
                jobs[job_id]["transcribed_audio"] = transcript_text
                raw_input = transcript_text
            else:
                raw_input = "(Audio transcript empty)"
        except Exception as e:
            # On failure, fall back so flow continues
            jobs[job_id]["audio_transcription_error"] = str(e)
            raw_input = "(Audio transcription failed; proceed with generic prompt)"
    spk_count = jobs[job_id].get("speakers", 1)
    voices_list = jobs[job_id].get("voices", [])

    # Derive speaker/gender instructions
    def voice_word(v):
        return {"M": "male", "F": "female"}.get(v, "unspecified gender")

    if spk_count <= 1:
        gender_desc = voice_word(voices_list[0]) if voices_list else "unspecified"
        speaker_instructions = (
            f"There is exactly one speaker. It is a {gender_desc} host speaking alone. "
            "Write the output as a monologue (no other voices)."
        )
    else:
        v1 = voice_word(voices_list[0]) if len(voices_list) > 0 else "unspecified"
        v2 = voice_word(voices_list[1]) if len(voices_list) > 1 else "unspecified"
        speaker_instructions = (
            f"There are exactly two speakers. Speaker 1 is {v1}. Speaker 2 is {v2}. "
            "Alternate their dialogue naturally. Label each line with 'Speaker 1:' or 'Speaker 2:' only. "
            "Do not invent extra characters."
        )

    # Build improved prompt
    improvement_prompt = (
        f"""Your task:
        You are a prompt generator that takes a user idea (either spoken or written) and converts it into a detailed, high-quality prompt 
        to be used for a text-to-speech dialogue model.
        Analyze the user's input and extract the following information:
        - Characters: Who are the speakers? What are their personalities?
        - Scenario / Topic: What is the conversation about?
        - Tone / Style: What is the mood (e.g., casual, professional, educational)?
        - Language mix: Are multiple languages or specific accents mentioned?
        - Special rules: Are there any other instructions like correcting mistakes?
        Use the extracted data to build the final prompt. If any field is missing, use generic but sensible assumptions.
        Your output should:
        - Describe the roles, personalities, and speaking styles of each character.
        - Clearly explain the scenario and context of the conversation.
        - Specify the tone and style.
        - Include clear instructions for language usage.
        - Describe how to handle corrections, vocabulary explanations, and mistakes (if applicable).
        - Provide clear output formatting instructions (e.g., "Only output dialogue, labeled with character names").
        - Avoid adding any extra narration, sound effects, or non-dialogue text.
        - LIMIT: The final transcript should not exceed ~{MAX_TRANSCRIPT_WORDS} words (~{MAX_SPOKEN_SECONDS} seconds of speech). Conclude naturally when reaching that length.
        Output ONLY the improved prompt itself, not any commentary or explanation.
        Be explicit, professional, and detailed to ensure the TTS model fully understands the task."""
    )

    # Localisation augmentation (only affects how we improve the prompt; keeps rest of flow unchanged)
    category = jobs[job_id].get("category")
    loc_theme = jobs[job_id].get("theme")
    loc_geo = jobs[job_id].get("geo_location")
    localisation_instruction = None
    # Language enforcement (heuristic). If user did not explicitly request another language in raw_input, force chosen one.
    language_instruction = None
    chosen_lang = jobs[job_id].get("language")
    if chosen_lang:
        raw_lower = (raw_input or "").lower()
        explicit_tokens = [
            " in french", " en français", " en francais", " in english", " en anglais",
            " in spanish", " en español", " en espanol", " in german", " auf deutsch",
            " in italian", " in portuguese", " em portugues", " in korean", " en coréen", " en coreen",
            " 한국어", " in chinese", " en chinois", " 中文", " 汉语", " 漢語", " 普通话"
        ]
        if not any(tok in raw_lower for tok in explicit_tokens):
            human_names = {
                "en": "English", "fr": "French", "es": "Spanish", "de": "German", "it": "Italian",
                "pt": "Portuguese", "ko": "Korean", "zh": "Chinese"
            }
            human_lang = human_names.get(chosen_lang, chosen_lang)
            language_instruction = (
                f"The entire podcast MUST be written in {human_lang}. Do not switch languages except for unavoidable proper nouns."
            )
    if category == "localisation":
        localisation_instruction = (
            f"Localization context: The podcast is a single-host monologue about {loc_theme} aspects of {loc_geo}. "
            f"The host is currently located in {loc_geo}. Incorporate at least one vivid, authentic local detail (food, landmark, custom) "
            f"relevant to the {loc_theme} theme. Keep it educational yet engaging."
        )

    async def event_generator():
        try:
            jobs[job_id]["status"] = "improving"
            improv_contents = [improvement_prompt, speaker_instructions]
            if localisation_instruction:
                improv_contents.append(localisation_instruction)
            if language_instruction:
                improv_contents.append(language_instruction)
            improv_contents.append(raw_input)
            improved = client.models.generate_content(
                model=LLM_MODEL_ID,
                contents=improv_contents
            ).text
            # Send improved prompt event (optional for UI)
            yield f"event: meta\ndata: {json.dumps({'improved_prompt': improved})}\n\n"

            jobs[job_id]["status"] = "streaming"
            transcript_acc = []
            tools = []
            if use_internet:
                tools.append(types.Tool(google_search=types.GoogleSearch()))
            config = types.GenerateContentConfig(tools=tools) if tools else None
            stream_iter = client.models.generate_content_stream(
                model=LLM_MODEL_ID,
                contents=improved,
                config=config
            )
            for chunk in stream_iter:
                if hasattr(chunk, 'text') and chunk.text:
                    transcript_acc.append(chunk.text)
                    current = ''.join(transcript_acc)
                    # Enforce word limit
                    words = current.split()
                    truncated_flag = False
                    if len(words) > MAX_TRANSCRIPT_WORDS:
                        current = ' '.join(words[:MAX_TRANSCRIPT_WORDS])
                        transcript_acc = [current]  # collapse to truncated form
                        truncated_flag = True
                        jobs[job_id]["truncated"] = True
                    jobs[job_id]["transcript"] = current
                    payload = {"delta": chunk.text if not truncated_flag else None, "full": current, "truncated": truncated_flag}
                    # Only send delta if not truncated; once truncated we stop streaming extra deltas
                    yield f"event: chunk\ndata: {json.dumps(payload)}\n\n"
                    if truncated_flag:
                        break
                    await asyncio.sleep(0)  # cooperative

            full_transcript = jobs[job_id]["transcript"]
            # Title generation
            if jobs[job_id].get("category") == "localisation":
                title_prompt = (
                    "Generate a concise, compelling podcast episode title (max 8 words) capturing the localisation theme and place. "
                    "Avoid quotes and punctuation flourishes. Theme: "
                    f"{loc_theme}. Location: {loc_geo}. Transcript (truncated):\n" + full_transcript[:6000]
                )
            else:
                title_prompt = (
                    "Generate a concise, compelling podcast episode title (max 8 words) based ONLY on this transcript."
                    " No quotes, no extra punctuation. Transcript:\n" + full_transcript[:6000]
                )
            title = client.models.generate_content(
                model=LLM_MODEL_ID,
                contents=title_prompt
            ).text.strip().replace('\n', ' ')
            jobs[job_id]["title"] = title
            jobs[job_id]["status"] = "done"
            # Persist completed job so playback still works after reload
            _persist_job(job_id)
            final_payload = {"title": title, "full": full_transcript, "truncated": jobs[job_id].get("truncated", False)}
            yield f"event: done\ndata: {json.dumps(final_payload)}\n\n"
        except Exception as e:
            jobs[job_id]["status"] = "error"
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    j = jobs[job_id]
    return {
        "status": j["status"],
        "title": j.get("title"),
        "length": len(j.get("transcript", "")),
        "speakers": j.get("speakers"),
        "voices": j.get("voices"),
    }

@app.get("/api/full/{job_id}")
async def get_full(job_id: str):
    if job_id not in jobs:
        # lazy load from disk (in case of dev reload)
        if not _load_job(job_id):
            return JSONResponse(status_code=404, content={"error": "Job not found"})
    j = jobs[job_id]
    return {
        "status": j.get("status"),
        "title": j.get("title"),
        "transcript": j.get("transcript"),
        "speakers": j.get("speakers"),
        "voices": j.get("voices"),
        "saved": j.get("saved", False),
        "category": j.get("category"),
        "voice_names": j.get("voice_names"),
        "theme": j.get("theme"),
        "geo_location": j.get("geo_location"),
        "language": j.get("language"),
    }

@app.delete("/api/job/{job_id}")
async def delete_job(job_id: str):
    if job_id not in jobs:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    # Simple delete
    del jobs[job_id]
    return {"deleted": True, "job_id": job_id}


def _wrap_pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buffer.getvalue()

# Canonical voice name pools (updated full sets provided by user)
FEMALE_VOICE_DESCRIPTORS = {
    "Zephyr": "Bright", "Kore": "Firm", "Leda": "Youthful", "Aoede": "Breezy",
    "Callirrhoe": "Easy-going", "Autonoe": "Bright", "Despina": "Smooth", "Erinome": "Clear",
    "Laomedeia": "Upbeat", "Achernar": "Soft", "Pulcherrima": "Forward", "Vindemiatrix": "Gentle",
    "Sulafat": "Warm", "Gacrux": "Mature"
}
MALE_VOICE_DESCRIPTORS = {
    "Puck": "Upbeat", "Charon": "Informative", "Fenrir": "Excitable", "Orus": "Firm",
    "Enceladus": "Breathy", "Iapetus": "Clear", "Algenib": "Gravelly", "Rasalgethi": "Informative",
    "Alnilam": "Firm", "Schedar": "Even", "Zubenelgenubi": "Casual", "Sadaltager": "Knowledgeable",
    "Umbriel": "Easy-going", "Achird": "Friendly", "Sadachbia": "Lively"
}
FEMALE_VOICE_POOL = list(FEMALE_VOICE_DESCRIPTORS.keys())
MALE_VOICE_POOL = list(MALE_VOICE_DESCRIPTORS.keys())

def _pick_voice(gender: str) -> str:
    if gender == 'F' and FEMALE_VOICE_POOL:
        return random.choice(FEMALE_VOICE_POOL)
    if gender == 'M' and MALE_VOICE_POOL:
        return random.choice(MALE_VOICE_POOL)
    # fallback
    return random.choice((FEMALE_VOICE_POOL + MALE_VOICE_POOL) or ["Zephyr"])

def _generate_tts_audio(transcript: str, speakers: int, voices: list[str], voice_names: list[str] | None = None) -> bytes:
    """Generate real TTS audio using Gemini. Returns WAV bytes.
    Fallback responsibility handled by caller.
    """
    client = get_client()
    if not transcript.strip():
        transcript = "(empty transcript)"

    # Build speech config
    if speakers <= 1:
        # Single speaker voice (use preselected if provided)
        if voice_names and len(voice_names) >= 1:
            voice_name = voice_names[0]
        else:
            gender = voices[0] if voices else 'M'
            voice_name = _pick_voice(gender)
        config = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                )
            )
        )
    else:
        # Multi speaker: assume transcript lines labelled "Speaker 1:" / "Speaker 2:"
        speaker_voice_configs = []
        for idx in range(min(speakers, 2)):
            if voice_names and idx < len(voice_names):
                voice_name = voice_names[idx]
            else:
                gender = voices[idx] if idx < len(voices) else 'M'
                voice_name = _pick_voice(gender)
            speaker_voice_configs.append(
                types.SpeakerVoiceConfig(
                    speaker=f"Speaker {idx+1}",
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
                    )
                )
            )
        config = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                    speaker_voice_configs=speaker_voice_configs
                )
            )
        )

    # Call model
    response = client.models.generate_content(
        model=TTS_MODEL_ID,
        contents=[transcript],
        config=config,
    )
    # Extract PCM bytes
    # Defensive extraction: find first inline_data with data
    audio_bytes = None
    audio_mime = None
    for cand in getattr(response, 'candidates', []) or []:
        content_obj = getattr(cand, 'content', None)
        parts = getattr(content_obj, 'parts', []) if content_obj else []
        for part in parts:
            inline = getattr(part, 'inline_data', None)
            if inline and getattr(inline, 'data', None):
                audio_bytes = inline.data
                audio_mime = getattr(inline, 'mime_type', None)
                break
        if audio_bytes:
            break
    if not audio_bytes:
        raise RuntimeError("No audio data returned from TTS model")
    # Some models might already return a WAV/MP3 container. Only wrap raw PCM.
    container_mimes = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm"}
    if audio_mime in container_mimes:
        # Store mime for response outside
        return audio_bytes, audio_mime
    # Assume raw PCM 16-bit LE mono 24k
    wrapped = _wrap_pcm_to_wav(audio_bytes, sample_rate=24000, channels=1, sample_width=2)
    return wrapped, "audio/wav"

@app.get("/api/audio/{job_id}")
async def get_audio(job_id: str):
    """Return (and lazily generate) audio for a job using real TTS; fallback to placeholder on failure."""
    if job_id not in jobs:
        if not _load_job(job_id):
            return JSONResponse(status_code=404, content={"error": "Job not found"})
    j = jobs[job_id]
    if j.get("status") != "done":
        return JSONResponse(status_code=400, content={"error": "Job not completed"})
    if "audio_wav" not in j:
        transcript = j.get("transcript") or "(no transcript)"
        speakers = j.get("speakers", 1)
        voices = j.get("voices", [])
        voice_names = j.get("voice_names")
        try:
            audio_bytes, audio_mime = _generate_tts_audio(transcript, speakers, voices, voice_names)
            j["audio_wav"] = audio_bytes
            j["audio_mime"] = audio_mime
            j["audio_source"] = f"tts:{audio_mime or 'unknown'}"
        except Exception as e:
            # Fallback to placeholder synthetic tones
            try:
                j["audio_wav"] = _generate_placeholder_audio(transcript, speakers, voices)
                j["audio_mime"] = "audio/wav"
                j["audio_source"] = f"placeholder_fallback: {e}"[:180]
            except Exception as inner:
                return JSONResponse(status_code=500, content={"error": f"Audio generation failed: {e}; fallback failed: {inner}"})
    from fastapi.responses import Response
    audio_bytes = j["audio_wav"]
    headers = {
        "Cache-Control": "no-store",
        "Content-Disposition": f"inline; filename=podcast_{job_id}.wav",
        "Content-Length": str(len(audio_bytes)),
    }
    return Response(content=audio_bytes, media_type=j.get("audio_mime", "audio/wav"), headers=headers)


@app.get("/api/status")
async def list_status():
    """Return a summary of all jobs (POC helper)."""
    return {
        job_id: {
            "status": j.get("status"),
            "title": j.get("title"),
            "length": len(j.get("transcript", "")),
            "speakers": j.get("speakers"),
            "voices": j.get("voices"),
            "saved": j.get("saved", False),
            "category": j.get("category"),
            "voice_names": j.get("voice_names"),
            "theme": j.get("theme"),
            "geo_location": j.get("geo_location"),
            "language": j.get("language"),
        }
        for job_id, j in jobs.items()
    }


@app.post("/api/save/{job_id}")
async def save_job(job_id: str, category: str = Form("generated")):
    """Mark a completed job as saved with a category (generated | localisation)."""
    if job_id not in jobs:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    j = jobs[job_id]
    if j.get("status") != "done":
        return JSONResponse(status_code=400, content={"error": "Job not completed"})
    if category not in ("generated", "localisation", "localization"):
        return JSONResponse(status_code=400, content={"error": "Invalid category"})
    # normalize category naming
    if category == "localization":
        category = "localisation"
    j["saved"] = True
    j["category"] = category
    j["saved_at"] = datetime.utcnow().isoformat() + "Z"
    # Ensure audio present using preselected voice names
    if "audio_wav" not in j and j.get("status") == "done":
        try:
            audio_bytes, audio_mime = _generate_tts_audio(
                j.get("transcript") or "(no transcript)",
                j.get("speakers",1),
                j.get("voices", []),
                j.get("voice_names")
            )
            j["audio_wav"] = audio_bytes
            j["audio_mime"] = audio_mime
            j["audio_source"] = f"tts:{audio_mime or 'unknown'}"
        except Exception as e:
            try:
                j["audio_wav"] = _generate_placeholder_audio(j.get("transcript") or "(no transcript)", j.get("speakers",1), j.get("voices", []))
                j["audio_mime"] = "audio/wav"
                j["audio_source"] = f"placeholder_fallback:{e}"[:160]
            except Exception as inner:
                print(f"[save] audio + fallback failed {job_id}: {e}; {inner}")
    _persist_job(job_id)
    return {"saved": True, "job_id": job_id, "category": category}


@app.get("/api/saved")
async def list_saved(category: str | None = None):
    """List saved podcasts, optionally filtered by category."""
    result = []
    for job_id, j in jobs.items():
        if not j.get("saved"):
            continue
        if category and j.get("category") != category:
            continue
        result.append({
            "job_id": job_id,
            "title": j.get("title") or "Untitled",
            "category": j.get("category"),
            "saved_at": j.get("saved_at"),
            "speakers": j.get("speakers"),
            "voices": j.get("voices"),
        })
    # Sort most recent first
    result.sort(key=lambda r: r.get("saved_at") or "", reverse=True)
    return {"items": result}


@app.delete("/api/saved/{job_id}")
async def unsave_job(job_id: str):
    """Remove a podcast from saved list (does NOT delete the job itself)."""
    if job_id not in jobs:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    j = jobs[job_id]
    if not j.get("saved"):
        return JSONResponse(status_code=400, content={"error": "Not saved"})
    j["saved"] = False
    j.pop("category", None)
    j.pop("saved_at", None)
    # remove persisted file if exists
    json_path = JOBS_DIR / f"{job_id}.json"
    if json_path.exists():
        try: json_path.unlink()
        except Exception as e: print(f"[unsave] failed removing file {json_path}: {e}")
    return {"unsaved": True, "job_id": job_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)
