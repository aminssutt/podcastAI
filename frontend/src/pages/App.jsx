import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './Home.jsx';
import GeneratedPodcast from './GeneratedPodcast.jsx';
import GeneratedResult from './GeneratedResult.jsx';
import GeneratedPlayback from './GeneratedPlayback.jsx';
import Profile from './Profile.jsx';
import LocalisationPodcast from './LocalisationPodcast.jsx';
import LocalisationResult from './LocalisationResult.jsx';
import LocalisationPlayback from './LocalisationPlayback.jsx';

const App = () => (
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/generated" element={<GeneratedPodcast />} />
    <Route path="/generated/result/:jobId" element={<GeneratedResult />} />
    <Route path="/generated/play/:jobId" element={<GeneratedPlayback />} />
    <Route path="/local" element={<LocalisationPodcast />} />
    <Route path="/local/result/:jobId" element={<LocalisationResult />} />
    <Route path="/local/play/:jobId" element={<LocalisationPlayback />} />
    <Route path="/profile" element={<Profile />} />
  </Routes>
);

export default App;
