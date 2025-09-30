import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/home.css';
import { UserIcon, SettingsIcon } from '../ui/Icons.jsx';

const Home = () => {
  const navigate = useNavigate();
  return (
    <div className="layout">
      <div className="page-center">
        <header className="topbar">
          <div className="topbar-spacer" aria-hidden="true" />
          <div className="brand">Podcast AI</div>
          <div className="actions">
            <button className="icon-btn" aria-label="Profile"><UserIcon /></button>
            <button className="icon-btn" aria-label="Settings"><SettingsIcon /></button>
          </div>
        </header>

        <main className="main-grid">
          <div className="card" role="button" tabIndex={0} onClick={() => navigate('/local')}> 
            <div className="card-title">Localisation Podcast</div>
            <p className="card-desc">Create a podcast based on your location.</p>
            <div className="wave-placeholder" />
          </div>
          <div className="card" role="button" tabIndex={0} onClick={() => navigate('/generated')}>
            <div className="card-title">Generated Podcast</div>
              <p className="card-desc">Generate your own podcast based on what you want.</p>
            <div className="wave-placeholder" />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Home;
