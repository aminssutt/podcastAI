import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/generated.css';
import { UserIcon } from '../ui/Icons.jsx';
import { startGeneration } from '../api/podcastService';

/*
  Progressive flow states:
  step 0 -> choose speakers
  step 1 -> choose voice gender
  step 2 -> provide prompt (mic or text)
*/

const GeneratedPodcast = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [numSpeakers, setNumSpeakers] = useState(null); // '1' | '2'
  const [voiceGender1, setVoiceGender1] = useState(null); // 'M' | 'F'
  const [voiceGender2, setVoiceGender2] = useState(null); // 'M' | 'F'
  const [recording, setRecording] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null); // will hold recorded audio
  const [textPrompt, setTextPrompt] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    setMediaSupported(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  }, []);

  const startRecording = async () => {
    if (!mediaSupported) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setAudioBlob(blob);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      setRecording(false);
    }
  };

  const undoTo = (targetStep) => {
    // Stop any recording in progress
    if (recording) stopRecording();
    if (targetStep === 0) {
      setStep(0);
      // Allow changing speakers again; keep previous selection for convenience
  setVoiceGender1(null);
  setVoiceGender2(null);
  setVoiceGender2(null);
  setAudioBlob(null);
      setTextPrompt('');
    } else if (targetStep === 1) {
      setStep(1);
      setAudioBlob(null);
      setTextPrompt('');
    }
  };

  // Placeholder submit – will later choose audio vs text and call backend
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (loading) return;
    setError(null);
    try {
      setLoading(true);
      const defaultLanguage = localStorage.getItem('defaultLanguage') || 'en';
      const jobId = await startGeneration({
        mode: audioBlob ? 'audio' : 'text',
        text: audioBlob ? undefined : textPrompt.trim(),
        useInternet: true, // future toggle
        speakers: numSpeakers,
        voices: numSpeakers === '2' ? [voiceGender1, voiceGender2] : [voiceGender1],
        audioBlob: audioBlob || undefined,
        language: defaultLanguage
      });
      navigate(`/generated/result/${jobId}`);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  // Derived UI helpers
  const canProceedFromSpeakers = !!numSpeakers;
  const voicesReady = numSpeakers === '2' ? (voiceGender1 && voiceGender2) : !!voiceGender1;
  const canGenerate = (audioBlob || textPrompt.trim().length > 0) && canProceedFromSpeakers && voicesReady;

  return (
    <div className="gen-layout">
      <div className={`gen-canvas ${step >= 2 ? 'prompt-phase' : 'center-phase'}`}> 
      <div className="gen-card">
        <div className="gen-header-row">
          <button className="back-btn" onClick={() => navigate('/')}>←</button>
          <h1 className="gen-title">Generated Podcast</h1>
          <div className="gen-actions">
            <button className="icon-btn sm" aria-label="Profile"><UserIcon size={20} /></button>
          </div>
        </div>

        <div className="flow-container">
          {/* Step 0: number of speakers */}
          <div className={`flow-block ${step >= 0 ? 'active' : ''} ${step > 0 ? 'compressed' : ''}`}>
            <div className="flow-header-row">
              <div className="flow-label">Choose Number of Speakers</div>
              {step > 0 && (
                <div className="compressed-meta">
                  <span>{numSpeakers} speaker{numSpeakers === '2' ? 's' : ''}</span>
                  <button className="undo-btn" onClick={() => undoTo(0)}>Undo</button>
                </div>
              )}
            </div>
            <div className="choice-row">
              {['1','2'].map(opt => (
                <button
                  key={opt}
                  className={`pill ${numSpeakers === opt ? 'selected' : ''}`}
                  onClick={() => { if (step === 0) { setNumSpeakers(opt); setStep(1); } }}
                  disabled={step > 0}
                >{opt}</button>
              ))}
            </div>
          </div>

          {/* Step 1: gender */}
          {step >= 1 && (
            <div className={`flow-block ${step > 1 ? 'compressed' : ''}`}>
              <div className="flow-header-row">
                <div className="flow-label">{numSpeakers === '2' ? 'Choose Voices' : 'Choose Voice'}</div>
                {step > 1 && (
                  <div className="compressed-meta">
                    {numSpeakers === '2' ? (
                      <span>{(voiceGender1 === 'M' ? 'Male' : 'Female')} / {(voiceGender2 === 'M' ? 'Male' : 'Female')}</span>
                    ) : (
                      <span>{voiceGender1 === 'M' ? 'Male' : 'Female'}</span>
                    )}
                    <button className="undo-btn" onClick={() => undoTo(1)}>Undo</button>
                  </div>
                )}
              </div>
              <div className="voice-groups">
                <div className="voice-group">
                  {numSpeakers === '2' && <div className="voice-label">Speaker 1</div>}
                  <div className="choice-row">
                    {['M','F'].map(g => (
                      <button
                        key={g}
                        className={`pill ${voiceGender1 === g ? 'selected' : ''}`}
                        onClick={() => {
                          if (step === 1) {
                            if (numSpeakers === '1') { setVoiceGender1(g); setStep(2); }
                            else { setVoiceGender1(g); }
                          }
                        }}
                        disabled={step > 1}
                      >{g}</button>
                    ))}
                  </div>
                </div>
                {numSpeakers === '2' && (
                  <div className={`voice-group ${!voiceGender1 ? 'locked' : ''}`}>
                    <div className="voice-label">Speaker 2</div>
                    <div className="choice-row">
                      {['M','F'].map(g => (
                        <button
                          key={g}
                          className={`pill ${voiceGender2 === g ? 'selected' : ''}`}
                          onClick={() => {
                            if (step === 1 && voiceGender1) { setVoiceGender2(g); setStep(2); }
                          }}
                          disabled={!voiceGender1 || step > 1}
                        >{g}</button>
                      ))}
                    </div>
                    {!voiceGender1 && <div className="locked-hint">Select speaker 1 first</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: prompt input */}
          {step >= 2 && (
            <div className="flow-block prompt-block">
              <div className="flow-label">Give your prompt</div>
              <div className="prompt-row">
                <div className="mic-section">
                  <button
                    className={`mic-btn ${recording ? 'rec' : ''}`}
                    onClick={recording ? stopRecording : startRecording}
                    disabled={!mediaSupported}
                    aria-label={recording ? 'Stop recording' : 'Start recording'}
                  >
                    {recording ? '●' : '🎤'}
                  </button>
                  <div className="mic-hint">{recording ? 'Recording...' : audioBlob ? 'Recorded ✔' : 'Speak'}</div>
                </div>
                <textarea
                  className="prompt-input"
                  placeholder="Or type your podcast idea here..."
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  disabled={!!audioBlob}
                />
                {audioBlob && (
                  <button className="clear-audio" onClick={() => setAudioBlob(null)}>Reset Audio</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* generate button moved outside */}
      </div>
      {step >= 2 && (
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
};

export default GeneratedPodcast;
