// Simple API service for Podcast generation
// Assumes backend FastAPI running at http://localhost:8000

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export async function startGeneration({ mode, text, useInternet, speakers, voices, audioBlob, category, theme, geo_location }) {
  const form = new FormData();
  form.append('prompt_mode', mode); // 'text' | 'audio'
  form.append('use_internet', useInternet ? 'true' : 'false');
  form.append('speakers', speakers);
  form.append('voices', (voices || []).join(','));
  if(category) form.append('category', category);
  if(theme) form.append('theme', theme);
  if(geo_location) form.append('geo_location', geo_location);
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

export async function getFullJob(jobId){
  const res = await fetch(`${API_BASE}/api/full/${jobId}`);
  if(!res.ok) throw new Error('Failed to load job');
  return res.json();
}

export async function deleteJob(jobId){
  const res = await fetch(`${API_BASE}/api/job/${jobId}`, { method:'DELETE' });
  if(!res.ok) throw new Error('Failed to delete job');
  return res.json();
}

export async function saveJob(jobId, category='generated'){
  const form = new FormData();
  form.append('category', category);
  const res = await fetch(`${API_BASE}/api/save/${jobId}`, { method:'POST', body: form });
  if(!res.ok) throw new Error('Failed to save podcast');
  return res.json();
}

export async function listSaved(category){
  const url = new URL(`${API_BASE}/api/saved`);
  if(category) url.searchParams.set('category', category);
  const res = await fetch(url.toString());
  if(!res.ok) throw new Error('Failed to load saved podcasts');
  return res.json();
}

export async function unsaveJob(jobId){
  const res = await fetch(`${API_BASE}/api/saved/${jobId}`, { method:'DELETE' });
  if(!res.ok) throw new Error('Failed to unsave podcast');
  return res.json();
}
