import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/generated.css';
import { UserIcon } from '../ui/Icons.jsx';
import { startGeneration } from '../api/podcastService';

/* Progressive localisation flow (single speaker):
  step 0 -> choose voice gender
  step 1 -> choose theme
  step 2 -> auto-detect GPS location and generate
*/

const THEMES = ['Culture','History','Music','Sport'];

export default function LocalisationPodcast(){
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [gender, setGender] = useState(null); // 'M' | 'F'
  const [theme, setTheme] = useState('culture');
  const [detectedLocation, setDetectedLocation] = useState(''); // auto-detected location
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [toast, setToast] = useState(null); // holds location toast text

  useEffect(()=>{ if(step===0 && gender) setStep(1); },[gender]);
  useEffect(()=>{ if(step===1 && theme) setStep(2); },[theme]);

  const undoTo = (target) => {
    if(target===0){ setStep(0); setGender(null); setTheme('culture'); setDetectedLocation(''); }
    else if(target===1){ setStep(1); setTheme('culture'); setDetectedLocation(''); }
  };

  // Fetch location name from coordinates using reverse geocoding
  const getLocationName = async (latitude, longitude) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`,
        { headers: { 'User-Agent': 'PodcastAI/1.0' } }
      );
      if (!response.ok) throw new Error('Geocoding failed');
      const data = await response.json();
      
      // Build a detailed location string
      const parts = [];
      if (data.address.neighbourhood) parts.push(data.address.neighbourhood);
      if (data.address.suburb) parts.push(data.address.suburb);
      if (data.address.city) parts.push(data.address.city);
      else if (data.address.town) parts.push(data.address.town);
      else if (data.address.village) parts.push(data.address.village);
      if (data.address.state) parts.push(data.address.state);
      if (data.address.country) parts.push(data.address.country);
      
      return parts.join(', ') || data.display_name || 'Unknown location';
    } catch (e) {
      console.error('Geocoding error:', e);
      return `Coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    }
  };

  const canGenerate = gender && detectedLocation.trim().length>0;

  const handleGenerate = async () => {
    if(loading || geoLoading) return;
    
    // If location not detected yet, detect it first
    if (!detectedLocation.trim()) {
      setError(null);
      setGeoLoading(true);
      
      // Check if geolocation is supported
      if (!navigator.geolocation) {
        setError('Geolocation is not supported by your browser');
        setGeoLoading(false);
        return;
      }

      try {
        // Request user's location
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          });
        });

        const { latitude, longitude } = position.coords;
        
        // Get location name from coordinates
        const locationName = await getLocationName(latitude, longitude);
        setDetectedLocation(locationName);
        
        // Show toast with detected location
        setToast(locationName);
        setTimeout(() => setToast(null), 3500);
        
        setGeoLoading(false);
        
        // Now proceed with generation
        await startPodcastGeneration(locationName);
        
      } catch (geoError) {
        setGeoLoading(false);
        if (geoError.code === 1) {
          setError('Location permission denied. Please allow location access to use this feature.');
        } else if (geoError.code === 2) {
          setError('Location unavailable. Please check your device settings.');
        } else if (geoError.code === 3) {
          setError('Location request timeout. Please try again.');
        } else {
          setError('Failed to detect location: ' + (geoError.message || 'Unknown error'));
        }
        return;
      }
    } else {
      // Location already detected, just generate
      await startPodcastGeneration(detectedLocation);
    }
  };

  const startPodcastGeneration = async (locationValue) => {
    if (!canGenerate || loading) return;
    setError(null);
    try {
      setLoading(true);
      const jobId = await startGeneration({
        mode: 'text',
        text: locationValue,
        useInternet: true,
        speakers: '1',
        voices: [gender],
        category: 'localisation',
        theme,
        geo_location: locationValue,
        language: (localStorage.getItem('defaultLanguage') || 'en')
      });
      setTimeout(()=> navigate(`/local/result/${jobId}`), 600);
    } catch(e){ 
      setError(e.message || 'Generation failed'); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div className="gen-layout">
      <div className={`gen-canvas ${step>=2 ? 'prompt-phase':'center-phase'}`}> 
        {toast && (
          <div className="toast">You are located in <span className="hl">{toast.length>70 ? toast.slice(0,70)+'…' : toast}</span></div>
        )}
        <div className="gen-card">
          <div className="gen-header-row">
            <button className="back-btn" onClick={()=>navigate('/')}>←</button>
            <h1 className="gen-title">Localisation Podcast</h1>
            <div className="gen-actions">
              <button className="icon-btn sm" aria-label="Profile" onClick={()=>navigate('/profile')}><UserIcon size={20} /></button>
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

            {/* Step 2: Auto-detect location and generate */}
            {step>=2 && (
              <div className="flow-block prompt-block">
                <div className="flow-label">Ready to Generate</div>
                <div style={{
                  padding: '24px',
                  background: 'rgba(214,163,64,0.08)',
                  border: '2px solid rgba(214,163,64,0.3)',
                  borderRadius: '16px',
                  textAlign: 'center'
                }}>
                  {detectedLocation ? (
                    <>
                      <div style={{fontSize: 15, opacity: 0.7, marginBottom: 12}}>
                        📍 Location detected:
                      </div>
                      <div style={{fontSize: 18, fontWeight: 600, color: '#d6a340', marginBottom: 16}}>
                        {detectedLocation}
                      </div>
                      <div style={{fontSize: 13, opacity: 0.6, lineHeight: 1.5}}>
                        Click "Generate Podcast" below to create your {theme.toLowerCase()} podcast about this location.
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{fontSize: 16, marginBottom: 12}}>
                        📍 Click "Generate Podcast" to detect your current location
                      </div>
                      <div style={{fontSize: 13, opacity: 0.6, lineHeight: 1.5}}>
                        We'll automatically detect where you are and create a {theme.toLowerCase()} podcast about your location.
                        <br/>
                        <em>You'll be prompted to allow location access.</em>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {step>=2 && (
          <div className="fixed-generate-wrapper">
            {error && <div className="gen-error">{error}</div>}
            <button
              className="generate-btn fixed-generate"
              disabled={loading || geoLoading}
              onClick={handleGenerate}
            >
              {geoLoading ? '📍 Detecting location...' : loading ? 'Starting...' : detectedLocation ? 'Generate Podcast' : '📍 Detect Location & Generate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
