import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './Home.jsx';
import GeneratedPodcast from './GeneratedPodcast.jsx';
import GeneratedResult from './GeneratedResult.jsx';
import GeneratedPlayback from './GeneratedPlayback.jsx';
import Profile from './Profile.jsx';

const App = () => (
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/generated" element={<GeneratedPodcast />} />
    <Route path="/generated/result/:jobId" element={<GeneratedResult />} />
    <Route path="/generated/play/:jobId" element={<GeneratedPlayback />} />
    <Route path="/profile" element={<Profile />} />
  </Routes>
);

export default App;
