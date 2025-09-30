import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import '../styles/playback.css';
import { getFullJob, deleteJob, saveJob } from '../api/podcastService';

const PlayIcon = ({ size=30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 3v18l15-9-15-9z" />
  </svg>
);
const PauseIcon = ({ size=30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);

export default function GeneratedPlayback(){
  const { jobId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [speakers, setSpeakers] = useState(1);
  const [voices, setVoices] = useState([]);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioTries, setAudioTries] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0); // 0-100
  const [audioPhase, setAudioPhase] = useState('idle'); // idle | generating | downloading | ready
  const fakeProgressRef = useRef(null);
  const [saved, setSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    let ignore=false;
    // If we got state from previous page, hydrate immediately (optimistic)
    const navData = location.state?.jobData;
    if(navData){
      setTitle(navData.title || 'Untitled');
      setTranscript(navData.transcript || '');
      setLoading(false);
    }
  async function load(retry=0){
      try {
        const data = await getFullJob(jobId);
        if(ignore) return;
        setTitle(data.title || navData?.title || 'Untitled');
        const finalTranscript = data.transcript || navData?.transcript || '';
        setTranscript(finalTranscript);
  setSpeakers(data.speakers || 1);
        setVoices(data.voices || []);
  setSaved(!!data.saved);
        // We no longer auto-fetch audio; fetch happens on Play click
        if (data.status === 'done') {
          // nothing extra for now
        } else if (retry < 5) {
          // keep polling until done so user can click once ready
          setTimeout(()=>load(retry+1), 700 * (retry+1));
        }
      } catch(e){
        // If 404 likely memory lost or user refreshed before job existed; small retry window
        if(!ignore && /404/.test(e.message || '') && retry < 3){
          setTimeout(()=>load(retry+1), 600 * (retry+1));
        } else if(!ignore){
          setError(e.message || 'Failed to load podcast');
        }
      } finally { if(!navData) setLoading(false); }
    }
    if(jobId) load();
    return () => { ignore=true; if(audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [jobId]);
  const handlePlay = async () => {
    if (playing) return;
    // If audio already ready -> just play
    if(audioUrl && audioPhase === 'ready'){
      try { await audioRef.current.play(); setPlaying(true); } catch { setError('Lecture bloquée. Réessayez.'); }
      return;
    }
    if(audioPhase === 'generating' || audioPhase === 'downloading') return; // debounce
    if(!audioUrl){
      if (loading) return;
      setError(null);
      setAudioLoading(true);
      setAudioPhase('generating');
      setAudioProgress(0);
      // Fake progress tick while model generates (before first byte)
      if(fakeProgressRef.current) clearInterval(fakeProgressRef.current);
      fakeProgressRef.current = setInterval(()=>{
        setAudioProgress(p => {
          if(audioPhase === 'downloading') return p; // real phase now
            if(p < 92) return p + Math.max(1, Math.round((92-p)/15));
            return p;
        });
      }, 500);
      try {
        // Wait until job truly done (in case user clicked early)
        let meta = await getFullJob(jobId);
        if(meta.status !== 'done'){
          const start = performance.now();
          while(performance.now() - start < 15000){
            await new Promise(r=>setTimeout(r, 900));
            meta = await getFullJob(jobId);
            if(meta.status === 'done') break;
          }
        }
        const audioRes = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/audio/${jobId}`);
        if(!audioRes.ok) throw new Error('Audio generation failed');
        const total = Number(audioRes.headers.get('Content-Length') || 0);
        setAudioPhase('downloading');
        if(audioRes.body && total > 0 && window.ReadableStream){
          const reader = audioRes.body.getReader();
          const chunks = [];
          let received = 0;
          while(true){
            const {done, value} = await reader.read();
            if(done) break;
            chunks.push(value);
            received += value.length;
            setAudioProgress(Math.min(100, Math.round((received/total)*100)));
          }
          const blob = new Blob(chunks, { type: audioRes.headers.get('Content-Type') || 'audio/wav' });
          const url = URL.createObjectURL(blob);
          setAudioUrl(old => { if(old) URL.revokeObjectURL(old); return url; });
          setAudioProgress(100);
        } else {
          const wavBlob = await audioRes.blob();
            const url = URL.createObjectURL(wavBlob);
            setAudioUrl(old => { if(old) URL.revokeObjectURL(old); return url; });
            setAudioProgress(100);
        }
        setAudioPhase('ready');
        setAudioLoading(false);
        if(fakeProgressRef.current){ clearInterval(fakeProgressRef.current); fakeProgressRef.current=null; }
        // Do NOT auto-play to avoid gesture loss; user must click again now that audio ready.
      } catch(e){
        if(fakeProgressRef.current){ clearInterval(fakeProgressRef.current); fakeProgressRef.current=null; }
        setAudioPhase('idle');
        setAudioLoading(false);
        setError(e.message || 'Audio fetch failed');
      }
      return;
    }
  };
  const handlePause = () => { setPlaying(false); audioRef.current?.pause(); };
  const handleEnded = () => setPlaying(false);

  const handleDelete = async () => {
    if(!confirm('Delete this generated podcast?')) return;
    try { await deleteJob(jobId); navigate('/generated'); } catch(e){ alert(e.message || 'Delete failed'); }
  };

  const handleSave = async () => {
    if(saved || saveLoading) return;
    try {
      setSaveLoading(true);
      await saveJob(jobId, 'generated');
      setSaved(true);
    } catch(e){
      alert(e.message || 'Save failed');
    } finally { setSaveLoading(false); }
  };

  return (
    <div className="playback-layout">
      <div className="playback-canvas">
        <div className="playback-card">
          <div className="pb-header">
            <div className="pb-nav-left">
              <button className="mini-nav-btn" onClick={()=>navigate(-1)}>← Back</button>
            </div>
            <h1 className="pb-title">Generated Podcast</h1>
            <div className="pb-nav-right">
              <button className="mini-nav-btn" onClick={()=>navigate('/profile')}>Profile</button>
            </div>
          </div>
          {loading && <div className="pb-loading">Loading...</div>}
          {error && <div className="pb-error">{error}</div>}
          {!loading && !error && (
            <>
              <div className="pb-title-panel">
                <div className="pb-label">Title</div>
                <div className="pb-title-value">{title}</div>
              </div>
              <div className="pb-player-row">
                <button className="pb-btn circle" onClick={handlePlay} disabled={playing || audioLoading} aria-label="Play">
                  {audioPhase==='ready' && !audioLoading ? <PlayIcon size={28} /> : (audioLoading ? '⏳' : <PlayIcon size={28} />)}
                </button>
                <button className="pb-btn circle" onClick={handlePause} disabled={!playing} aria-label="Pause"><PauseIcon size={28} /></button>
                <div className="pb-meta">{speakers} speaker{speakers===2?'s':''} {voices && voices.length>0 && `| ${voices.map(v=>v==='M'?'Male':'Female').join(' / ')}`}</div>
                <audio ref={audioRef} src={audioUrl || undefined} onEnded={handleEnded} />
              </div>
              {(audioPhase==='generating' || audioPhase==='downloading' || (audioLoading && audioPhase!=='ready')) && (
                <div style={{width:'100%'}}>
                  <div className="pb-loading">
                    {audioPhase==='generating' && `Génération du modèle... ${audioProgress}%`}
                    {audioPhase==='downloading' && `Téléchargement audio... ${audioProgress}%`}
                  </div>
                  <div className="pb-progress-bar"><div className="pb-progress-fill" style={{width: audioProgress+"%"}} /></div>
                  {audioPhase==='ready' && <div className="pb-loading">Audio prêt. Cliquez Play.</div>}
                </div>
              )}
              <div className="pb-actions">
                <button className="pill-btn secondary" onClick={handleDelete}>Delete</button>
                <button className="pill-btn secondary" disabled={!audioUrl} onClick={() => {
                  if(!audioUrl) return; const a=document.createElement('a'); a.href=audioUrl; a.download=`podcast_${jobId}.wav`; a.click();
                }}>Download</button>
                <button className="pill-btn primary" disabled={saved || saveLoading} onClick={handleSave}>{saved ? 'Saved' : (saveLoading ? 'Saving...' : 'Save')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
