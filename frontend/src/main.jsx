import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './pages/App.jsx';
import { BrowserRouter } from 'react-router-dom';
import './styles/viewport-scale.css';
import './styles/global.css';

const RootWithScale = () => {
	const [scale, setScale] = useState(1);
	const designW = 1800;
	const designH = 720;

	const recalc = () => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		const s = Math.min(w / designW, h / designH);
		setScale(s);
	};

	useEffect(() => {
		recalc();
		window.addEventListener('resize', recalc);
		window.addEventListener('orientationchange', recalc);
		return () => {
			window.removeEventListener('resize', recalc);
			window.removeEventListener('orientationchange', recalc);
		};
	}, []);

	return (
		<div className="viewport-scale-root" style={{ ['--app-scale']: scale }}>
			<div className="viewport-scale-inner">
				<BrowserRouter>
					<App />
				</BrowserRouter>
			</div>
		</div>
	);
};

createRoot(document.getElementById('root')).render(<RootWithScale />);
