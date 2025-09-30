// Simple API service for Podcast generation
// Assumes backend FastAPI running at http://localhost:8000

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export async function startGeneration({ mode, text, useInternet, speakers, voices, audioBlob }) {
  const form = new FormData();
  form.append('prompt_mode', mode); // 'text' | 'audio'
  form.append('use_internet', useInternet ? 'true' : 'false');
  form.append('speakers', speakers);
  form.append('voices', (voices || []).join(','));
  if (mode === 'text') {
    form.append('text', text || '');
  } else if (mode === 'audio' && audioBlob) {
    form.append('audio_file', audioBlob, 'input.webm');
  }

  const res = await fetch(`${API_BASE}/api/generate`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Failed to start generation');
  const data = await res.json();
  return data.job_id;
}

export function streamTranscript(jobId, { onMeta, onChunk, onDone, onError }) {
  const es = new EventSource(`${API_BASE}/api/stream/${jobId}`);
  es.addEventListener('meta', (e) => {
    try { onMeta && onMeta(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });
  es.addEventListener('chunk', (e) => {
    try { onChunk && onChunk(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });
  es.addEventListener('done', (e) => {
    try { onDone && onDone(JSON.parse(e.data)); } catch (err) { console.error(err); }
    es.close();
  });
  es.addEventListener('error', (e) => {
    if (onError) {
      try { onError(JSON.parse(e.data)); } catch { onError({ message: 'Unknown streaming error' }); }
    }
    es.close();
  });
  return () => es.close();
}
