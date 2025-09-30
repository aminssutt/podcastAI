import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/generated.css';
import { UserIcon, SettingsIcon } from '../ui/Icons.jsx';
import { startGeneration } from '../api/podcastService';

/* Progressive localisation flow (single speaker):
  step 0 -> choose voice gender
  step 1 -> choose theme
  step 2 -> localisation prompt (user types location / context)
*/

const THEMES = ['Culture','History','Music','Sport'];

export default function LocalisationPodcast(){
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState(null); // 'M' | 'F'
  const [theme, setTheme] = useState('culture');
  const [locPrompt, setLocPrompt] = useState(''); // user localisation input acts as prompt + geo_location
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null); // holds location toast text

  useEffect(()=>{ if(step===0 && gender) setStep(1); },[gender]);
  useEffect(()=>{ if(step===1 && theme) setStep(2); },[theme]);

  const undoTo = (target) => {
    if(target===0){ setStep(0); setGender(null); setTheme('culture'); setLocPrompt(''); }
    else if(target===1){ setStep(1); setTheme('culture'); setLocPrompt(''); }
  };

  const canGenerate = gender && locPrompt.trim().length>0;

  const handleGenerate = async () => {
    if(!canGenerate || loading) return;
    setError(null);
    try {
      setLoading(true);
      const value = locPrompt.trim();
      // Show toast immediately (do not wait for network)
      setToast(value);
      // Auto-hide toast after 2.4s
      setTimeout(()=> setToast(null), 2400);
      const jobId = await startGeneration({
        mode: 'text',
        text: value, // this is the actual prompt
        useInternet: true,
        speakers: '1',
        voices: [gender],
        category: 'localisation',
        theme,
        geo_location: value // reuse so backend augmentation keeps working
      });
      // Return to original behavior: go to transcript streaming result page first
      setTimeout(()=> navigate(`/local/result/${jobId}`), 600);
    } catch(e){ setError(e.message || 'Generation failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="gen-layout">
      <div className={`gen-canvas ${step>=2 ? 'prompt-phase':'center-phase'}`}> 
        {toast && (
          <div className="toast">You are currently in <span className="hl">{toast.length>70 ? toast.slice(0,70)+'…' : toast}</span></div>
        )}
        <div className="gen-card">
          <div className="gen-header-row">
            <button className="back-btn" onClick={()=>navigate('/')}>←</button>
            <h1 className="gen-title">Localisation Podcast</h1>
            <div className="gen-actions">
              <button className="icon-btn sm" aria-label="Profile" onClick={()=>navigate('/profile')}><UserIcon size={20} /></button>
              <button className="icon-btn sm" aria-label="Settings"><SettingsIcon size={20} /></button>
            </div>
          </div>

          <div className="flow-container">
            {/* Step 0: voice gender */}
            <div className={`flow-block ${step>0 ? 'compressed':''} active`}>
              <div className="flow-header-row">
                <div className="flow-label">Choose Voice</div>
                {step>0 && (
                  <div className="compressed-meta">
                    <span>{gender==='M'?'Male':'Female'}</span>
                    <button className="undo-btn" onClick={()=>undoTo(0)}>Undo</button>
                  </div>
                )}
              </div>
              <div className="choice-row">
                {['M','F'].map(g => (
                  <button
                    key={g}
                    className={`pill ${gender===g?'selected':''}`}
                    onClick={()=>{ if(step===0) setGender(g); }}
                    disabled={step>0}
                  >{g}</button>
                ))}
              </div>
            </div>

            {/* Step 1: theme */}
            {step>=1 && (
              <div className={`flow-block ${step>1 ? 'compressed':''} active`}>
                <div className="flow-header-row">
                  <div className="flow-label">Theme</div>
                  {step>1 && (
                    <div className="compressed-meta">
                      <span>{theme}</span>
                      <button className="undo-btn" onClick={()=>undoTo(1)}>Undo</button>
                    </div>
                  )}
                </div>
                <div className="choice-row">
                  {THEMES.map(t => (
                    <button
                      key={t}
                      className={`pill ${theme===t?'selected':''}`}
                      onClick={()=>{ if(step===1) setTheme(t); }}
                      disabled={step>1}
                    >{t}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: localisation prompt */}
            {step>=2 && (
              <div className="flow-block prompt-block">
                <div className="flow-label">Input your localisation</div>
                <textarea
                  className="prompt-input"
                  style={{minHeight:'140px'}}
                  placeholder="Ex: Seoul, South Korea - vibrant night street food scene near Gwangjang Market; Busan coastal temples at sunrise"
                  value={locPrompt}
                  onChange={e=>setLocPrompt(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
        {step>=2 && (
          <div className="fixed-generate-wrapper">
            {error && <div className="gen-error">{error}</div>}
            <button
              className="generate-btn fixed-generate"
              disabled={!canGenerate || loading}
              onClick={handleGenerate}
            >{loading ? 'Starting...' : 'Generate Podcast'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
