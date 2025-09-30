import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSaved, unsaveJob } from '../api/podcastService';
import '../styles/profile.css';

// Simple tabbed profile page showing saved podcasts per category
export default function Profile(){
  const navigate = useNavigate();
  const [category, setCategory] = useState('generated'); // 'generated' | 'localisation'
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(cat){
    setLoading(true); setError(null);
    try {
      const data = await listSaved(cat === 'localisation' ? 'localisation' : 'generated');
      setItems(data.items || []);
    } catch(e){ setError(e.message || 'Failed to load saved'); }
    finally { setLoading(false); }
  }

  useEffect(()=>{ load(category); }, [category]);

  const handleOpen = (jobId) => navigate(`/generated/play/${jobId}`);

  const handleRemove = async (jobId, title) => {
    if(!confirm(`Are you sure you want to remove "${title}" from saved?`)) return;
    if(!confirm('Really remove? This only unsaves (job stays in memory).')) return;
    try {
      await unsaveJob(jobId);
      setItems(prev => prev.filter(it => it.job_id !== jobId));
    } catch(e){ alert(e.message || 'Failed to unsave'); }
  };

  return (
    <div className="profile-layout">
      <div className="profile-canvas">
        <div className="profile-card">
          <header className="profile-header">
            <h1 className="pr-title">Profile</h1>
            <div className="pr-tabs">
              <button className={category==='generated'? 'tab active':'tab'} onClick={()=>setCategory('generated')}>Generated Podcast</button>
              <button className={category==='localisation'? 'tab active':'tab'} onClick={()=>setCategory('localisation')}>Localisation Podcast</button>
            </div>
            <button className="back-btn" onClick={()=>navigate('/')}>← Home</button>
          </header>
          <div className="pr-body">
            {loading && <div className="pr-loading">Loading...</div>}
            {error && <div className="pr-error">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="pr-empty">No saved podcasts in this category.</div>
            )}
            {!loading && !error && items.length > 0 && (
              <ul className="pr-list">
                {items.map(item => (
                  <li key={item.job_id} className="pr-item">
                    <div className="pr-item-main" onClick={()=>handleOpen(item.job_id)}>
                      <div className="pr-item-title">{item.title}</div>
                      <div className="pr-item-meta">{item.speakers} spk | { (item.voices||[]).map(v=>v==='M'?'Male':'Female').join(' / ') }</div>
                    </div>
                    <div className="pr-item-actions">
                      <button className="mini-btn" onClick={()=>handleOpen(item.job_id)}>Open</button>
                      <button className="mini-btn danger" onClick={()=>handleRemove(item.job_id, item.title)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
