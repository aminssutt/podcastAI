import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './Home.jsx';
import GeneratedPodcast from './GeneratedPodcast.jsx';
import GeneratedResult from './GeneratedResult.jsx';

const App = () => (
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/generated" element={<GeneratedPodcast />} />
    <Route path="/generated/result/:jobId" element={<GeneratedResult />} />
  </Routes>
);

export default App;
