import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import '../styles/playback.css';
import { getFullJob, deleteJob, saveJob } from '../api/podcastService';

const PlayIcon = ({ size=30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18l15-9-15-9z" /></svg>
);
const PauseIcon = ({ size=30 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
);

export default function LocalisationPlayback(){
  const { jobId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [voices, setVoices] = useState([]);
  const [theme, setTheme] = useState('');
  const [geo, setGeo] = useState('');
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioPhase, setAudioPhase] = useState('idle');
  const fakeProgressRef = useRef(null);
  const [saved, setSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(()=>{
    let ignore=false;
    const navData = location.state?.jobData;
    if(navData){ setTitle(navData.title||'Untitled'); setTranscript(navData.transcript||''); setLoading(false); }
    async function load(retry=0){
      try {
        const data = await getFullJob(jobId);
        if(ignore) return;
        setTitle(data.title || navData?.title || 'Untitled');
        setTranscript(data.transcript || navData?.transcript || '');
        setVoices(data.voices || []);
        setTheme(data.theme || '');
        setGeo(data.geo_location || '');
        setSaved(!!data.saved);
        if(data.status !== 'done' && retry < 5){ setTimeout(()=>load(retry+1), 800*(retry+1)); } else { setLoading(false); }
      } catch(e){
        if(!ignore && /404/.test(e.message||'') && retry < 3){ setTimeout(()=>load(retry+1), 600*(retry+1)); }
        else if(!ignore){ setError(e.message || 'Failed to load'); setLoading(false); }
      }
    }
    if(jobId) load();
    return ()=>{ ignore=true; if(audioUrl) URL.revokeObjectURL(audioUrl); };
  },[jobId]);

  const fetchAudio = async () => {
    if(audioPhase === 'generating' || audioPhase === 'downloading') return;
    setError(null); setAudioLoading(true); setAudioPhase('generating'); setAudioProgress(0);
    if(fakeProgressRef.current) clearInterval(fakeProgressRef.current);
    fakeProgressRef.current = setInterval(()=>{
      setAudioProgress(p=>{ if(audioPhase==='downloading') return p; if(p<92) return p+Math.max(1,Math.round((92-p)/18)); return p; });
    },500);
    try {
      let meta = await getFullJob(jobId);
      if(meta.status !== 'done'){
        const start = performance.now();
        while(performance.now()-start < 15000){
          await new Promise(r=>setTimeout(r,900));
            meta = await getFullJob(jobId);
            if(meta.status==='done') break;
        }
      }
      const audioRes = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:8000'}/api/audio/${jobId}`);
      if(!audioRes.ok) throw new Error('Audio generation failed');
      const total = Number(audioRes.headers.get('Content-Length') || 0);
      setAudioPhase('downloading');
      if(audioRes.body && total>0 && window.ReadableStream){
        const reader = audioRes.body.getReader();
        const chunks=[]; let received=0;
        while(true){
          const {done,value} = await reader.read();
          if(done) break;
          chunks.push(value);
          received += value.length;
          setAudioProgress(Math.min(100, Math.round((received/total)*100)));
        }
        const blob = new Blob(chunks, { type: audioRes.headers.get('Content-Type') || 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(old=>{ if(old) URL.revokeObjectURL(old); return url; });
        setAudioProgress(100);
      } else {
        const wavBlob = await audioRes.blob();
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(old=>{ if(old) URL.revokeObjectURL(old); return url; });
        setAudioProgress(100);
      }
      setAudioPhase('ready'); setAudioLoading(false);
      if(fakeProgressRef.current){ clearInterval(fakeProgressRef.current); fakeProgressRef.current=null; }
    } catch(e){
      if(fakeProgressRef.current){ clearInterval(fakeProgressRef.current); fakeProgressRef.current=null; }
      setAudioPhase('idle'); setAudioLoading(false); setError(e.message || 'Audio fetch failed');
    }
  };

  const handlePlay = async () => {
    if(playing) return;
    if(audioUrl && audioPhase==='ready'){
      try { await audioRef.current.play(); setPlaying(true); } catch { setError('Playback blocked'); }
      return;
    }
    await fetchAudio();
  };
  const handlePause = () => { setPlaying(false); audioRef.current?.pause(); };
  const handleEnded = () => setPlaying(false);

  const handleDelete = async () => { if(!confirm('Delete this podcast?')) return; try { await deleteJob(jobId); navigate('/local'); } catch(e){ alert(e.message || 'Delete failed'); } };
  const handleSave = async () => { if(saved || saveLoading) return; try { setSaveLoading(true); await saveJob(jobId, 'localisation'); setSaved(true); } catch(e){ alert(e.message || 'Save failed'); } finally { setSaveLoading(false); } };

  return (
    <div className="playback-layout">
      <div className="playback-canvas">
        <div className="playback-card">
          <div className="pb-header">
            <div className="pb-nav-left"><button className="mini-nav-btn" onClick={()=>navigate(-1)}>← Back</button></div>
            <h1 className="pb-title">Localisation Podcast</h1>
            <div className="pb-nav-right"><button className="mini-nav-btn" onClick={()=>navigate('/profile')}>Profile</button></div>
          </div>
          {loading && <div className="pb-loading">Loading...</div>}
          {error && <div className="pb-error">{error}</div>}
          {!loading && !error && (
            <>
              <div className="pb-title-panel"><div className="pb-label">Title</div><div className="pb-title-value">{title}</div></div>
              <div style={{marginBottom:12,fontSize:14,opacity:0.85}}>Theme: <strong>{theme}</strong> | Location: <strong>{geo}</strong></div>
              <div className="pb-player-row">
                <button className="pb-btn circle" onClick={handlePlay} disabled={playing || audioLoading}>{<PlayIcon size={28} />}</button>
                <button className="pb-btn circle" onClick={handlePause} disabled={!playing}><PauseIcon size={28} /></button>
                <div className="pb-meta">Single speaker {voices && voices.length>0 && `| ${(voices[0]==='M'?'Male':'Female')}`}</div>
                <audio
                  ref={audioRef}
                  src={audioUrl||undefined}
                  onEnded={handleEnded}
                  onLoadedMetadata={()=>{ if(audioRef.current){ setDuration(audioRef.current.duration||0); } }}
                  onTimeUpdate={()=>{ if(!seeking && audioRef.current){ setCurrentTime(audioRef.current.currentTime); } }}
                />
              </div>
              {audioPhase==='ready' && audioUrl && (
                <div className="pb-seek-row">
                  <span className="time tcur">{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    className="seek-slider"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(e)=>{ const v=parseFloat(e.target.value); setCurrentTime(v); }}
                    onMouseDown={()=>setSeeking(true)}
                    onMouseUp={(e)=>{ const v=parseFloat(e.target.value); if(audioRef.current) audioRef.current.currentTime=v; setSeeking(false);} }
                    onTouchStart={()=>setSeeking(true)}
                    onTouchEnd={(e)=>{ const v=parseFloat(e.target.value); if(audioRef.current) audioRef.current.currentTime=v; setSeeking(false);} }
                    disabled={!duration}
                  />
                  <span className="time tdur">{formatTime(duration)}</span>
                </div>
              )}
              {(audioPhase==='generating' || audioPhase==='downloading' || (audioLoading && audioPhase!=='ready')) && (
                <div style={{width:'100%'}}>
                  <div className="pb-loading">
                    {audioPhase==='generating' && `Génération du modèle... ${audioProgress}%`}
                    {audioPhase==='downloading' && `Téléchargement audio... ${audioProgress}%`}
                  </div>
                  <div className="pb-progress-bar"><div className="pb-progress-fill" style={{width: audioProgress+'%'}} /></div>
                </div>
              )}
              <div className="pb-actions">
                <button className="pill-btn secondary" onClick={handleDelete}>Delete</button>
                <button className="pill-btn secondary" disabled={!audioUrl} onClick={()=>{ if(!audioUrl)return; const a=document.createElement('a'); a.href=audioUrl; a.download=`local_podcast_${jobId}.wav`; a.click(); }}>Download</button>
                <button className="pill-btn primary" disabled={saved || saveLoading} onClick={handleSave}>{saved ? 'Saved' : (saveLoading ? 'Saving...' : 'Save')}</button>
              </div>
              <div className="pb-transcript" style={{marginTop:24,maxHeight:240,overflow:'auto',fontSize:14,lineHeight:1.4,whiteSpace:'pre-wrap'}}>{transcript}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(sec){
  if(!isFinite(sec)) return '0:00';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
