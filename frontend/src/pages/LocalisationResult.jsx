import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { streamTranscript, getFullJob } from '../api/podcastService';
import '../styles/result.css';

export default function LocalisationResult(){
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('streaming');
  const [error, setError] = useState(null);
  const [locMeta, setLocMeta] = useState(null); // {theme, geo_location}
  const scrollRef = useRef(null);

  useEffect(()=>{
    let ignore=false;
    (async ()=>{
      try { const meta = await getFullJob(jobId); if(!ignore) setLocMeta({ theme: meta.theme, geo: meta.geo_location }); } catch { /* ignore */ }
    })();
    return ()=>{ignore=true};
  },[jobId]);

  useEffect(()=>{
    if(!jobId) return;
    const unsub = streamTranscript(jobId, {
      onMeta: ()=>{},
      onChunk: (chunk)=>{
        if(!chunk) return;
        const piece = chunk.delta || chunk.text;
        if(piece) setTranscript(prev => prev + (prev ? ' ' : '') + piece);
      },
      onDone: (done)=>{
        if(done && done.title) setTitle(done.title);
        if(done && (done.full_transcript || done.full)) setTranscript(done.full_transcript || done.full);
        setStatus('done');
      },
      onError: (err)=>{ setError(err?.message || 'Streaming error'); setStatus('error'); }
    });
    return ()=>unsub && unsub();
  },[jobId]);

  useEffect(()=>{ if(scrollRef.current){ scrollRef.current.scrollTop = scrollRef.current.scrollHeight; } },[transcript]);

  const handleAccept = () => navigate(`/local/play/${jobId}`, { state: { jobData: { title, transcript } } });

  return (
    <div className="result-layout">
      <div className="result-canvas">
        <div className="result-card">
          <div className="res-header-row">
            <div className="res-nav-left">
              <button className="mini-nav-btn" onClick={()=>navigate('/local')}>← Back</button>
            </div>
            <h1 className="res-title">Localisation Podcast</h1>
            <div className="res-status">
              {status === 'streaming' && <span className="res-badge live">Streaming...</span>}
              {status === 'done' && <span className="res-badge done">Done</span>}
              {status === 'error' && <span className="res-badge error">Error</span>}
            </div>
            <div className="res-nav-right">
              <button className="mini-nav-btn" onClick={()=>navigate('/profile')}>Profile</button>
            </div>
          </div>
          <div className="res-body">
            <div className="res-title-panel">
              <div className="res-label">Title</div>
              <div className="res-title-value">{title || '... generating title ...'}</div>
            </div>
            {locMeta && (
              <div style={{marginBottom:12,fontSize:14,opacity:0.85}}>
                Theme: <strong>{locMeta.theme}</strong> | Location: <strong>{locMeta.geo}</strong>
              </div>
            )}
            <div className="res-transcript-panel">
              <div className="res-label">Transcript</div>
              <div className="res-transcript-scroll" ref={scrollRef}>
                {error && <div className="res-error-msg">{error}</div>}
                {!error && (!transcript ? (
                  <p className="placeholder">Streaming transcript...</p>
                ) : transcript.split(/\n+/).map((p,i)=>(<p key={i}>{p}</p>)))}
              </div>
            </div>
          </div>
          <div className="res-actions">
            <button className="pill-btn secondary" onClick={()=>navigate('/local')}>Undo</button>
            <button className="pill-btn primary" disabled={status!=='done'} onClick={handleAccept}>Accept</button>
          </div>
        </div>
      </div>
    </div>
  );
}
