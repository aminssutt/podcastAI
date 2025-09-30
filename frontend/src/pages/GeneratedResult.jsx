import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { streamTranscript } from '../api/podcastService';
import '../styles/result.css';

export default function GeneratedResult() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  // We intentionally ignore the improved prompt for UI per new requirement
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('streaming'); // 'streaming' | 'done' | 'error'
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    const unsubscribe = streamTranscript(jobId, {
      onMeta: () => { /* meta ignored */ },
      onChunk: (chunk) => {
        if (!chunk) return;
        // Backend sends { delta: piece, full: current }
        const piece = chunk.delta || chunk.text;
        if (piece) setTranscript(prev => prev + (prev ? ' ' : '') + piece);
      },
      onDone: (done) => {
        if (done && done.title) setTitle(done.title);
        // Backend final payload uses { title, full }
        if (done && (done.full_transcript || done.full)) {
          setTranscript(done.full_transcript || done.full);
        }
        setStatus('done');
      },
      onError: (err) => {
        setError(err?.message || 'Streaming error');
        setStatus('error');
      }
    });
    return () => unsubscribe && unsubscribe();
  }, [jobId]);

  useEffect(() => {
    // auto-scroll to bottom when transcript grows
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleAccept = () => {
    // Placeholder: In future we would trigger TTS generation or finalize job
    navigate('/');
  };

  const handleUndo = () => {
    navigate('/generated');
  };

  return (
    <div className="result-layout">
      <div className="result-canvas">
        <div className="result-card">
          <div className="res-header-row">
            <h1 className="res-title">Generated Podcast</h1>
            <div className="res-status">
              {status === 'streaming' && <span className="res-badge live">Streaming...</span>}
              {status === 'done' && <span className="res-badge done">Done</span>}
              {status === 'error' && <span className="res-badge error">Error</span>}
            </div>
          </div>
          <div className="res-body">
            <div className="res-title-panel">
              <div className="res-label">Title</div>
              <div className="res-title-value">{title || '... generating title ...'}</div>
            </div>
            <div className="res-transcript-panel">
              <div className="res-label">Transcript</div>
              <div className="res-transcript-scroll" ref={scrollRef}>
                {error && <div className="res-error-msg">{error}</div>}
                {!error && (!transcript ? (
                  <p className="placeholder">Streaming transcript...</p>
                ) : transcript.split(/\n+/).map((p, idx) => (
                  <p key={idx}>{p}</p>
                )))}
              </div>
            </div>
          </div>
          <div className="res-actions">
            <button className="pill-btn secondary" onClick={handleUndo}>Undo</button>
            <button className="pill-btn primary" disabled={status !== 'done'} onClick={handleAccept}>Accept</button>
          </div>
        </div>
      </div>
    </div>
  );
}
