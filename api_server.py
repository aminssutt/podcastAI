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

# Load environment variables from .env if present
load_dotenv()

# Simple in-memory job store (POC only)
jobs: Dict[str, Dict[str, Any]] = {}

LLM_MODEL_ID = "gemini-2.0-flash"

def get_client():
    api_key = os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("API_KEY not set in environment (.env or system var)")
    return genai.Client(api_key=api_key)

app = FastAPI(title="PodcastAI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/generate")
async def start_generation(
    prompt_mode: str = Form(..., regex="^(text|audio)$"),
    text: str = Form(""),
    use_internet: bool = Form(False),
    speakers: str = Form("1"),
    voices: str = Form(""),  # comma separated (future use)
    audio_file: UploadFile | None = File(None),
):
    if prompt_mode == "text" and not text.strip():
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
    # Store initial content
    if prompt_mode == "text":
        jobs[job_id]["raw_input"] = text
    else:
        # Store placeholder; actual transcription will occur lazily in stream endpoint
        jobs[job_id]["raw_input"] = "<audio>"
        try:
            audio_bytes = await audio_file.read()
            jobs[job_id]["audio_bytes"] = audio_bytes
            jobs[job_id]["audio_mime"] = audio_file.content_type or "audio/webm"
        except Exception as e:
            jobs[job_id]["audio_error"] = f"Failed to read audio: {e}"  # fallback; will continue with placeholder
    # Store speaker configuration for later prompt enrichment
    try:
        spk_count = int(speakers)
    except ValueError:
        spk_count = 1
    voices_list = [v.strip().upper() for v in voices.split(',') if v.strip()]
    jobs[job_id]["speakers"] = spk_count
    jobs[job_id]["voices"] = voices_list
    return {"job_id": job_id}


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
        """Your task:
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
        Output ONLY the improved prompt itself, not any commentary or explanation.
        Be explicit, professional, and detailed to ensure the TTS model fully understands the task."""
    )

    async def event_generator():
        try:
            jobs[job_id]["status"] = "improving"
            improved = client.models.generate_content(
                model=LLM_MODEL_ID,
                contents=[improvement_prompt, speaker_instructions, raw_input]
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
                    jobs[job_id]["transcript"] = current
                    payload = {"delta": chunk.text, "full": current}
                    yield f"event: chunk\ndata: {json.dumps(payload)}\n\n"
                    await asyncio.sleep(0)  # cooperative

            full_transcript = jobs[job_id]["transcript"]
            # Title generation
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
            final_payload = {"title": title, "full": full_transcript}
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
        }
        for job_id, j in jobs.items()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)
