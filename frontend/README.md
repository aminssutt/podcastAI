# Podcast AI Frontend (POC)

React 19 + Vite single-page prototype targeting 1800x720 in-vehicle dashboard display.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Structure
```
frontend/
  index.html
  vite.config.js
  package.json
  src/
    main.jsx
    pages/
      App.jsx
      Home.jsx
    ui/Icons.jsx
    styles/
      global.css
      home.css
```

## Notes
- Pure static prototype for now; no API wiring yet.
- Cards: "Localisation Podcast" and "Generated Podcast" are placeholders for navigation.
- Styling is handcrafted (no Tailwind) to keep bundle minimal.
- Responsive down to tablet widths; design baseline 1800x720.

## Next Steps (Possible)
1. Add routing (React Router) for podcast generation flow.
2. Integrate with existing Gradio backend via iframe or REST layer.
3. Add profile dropdown + authentication stub.
4. Replace wave placeholder with mini animated SVG waveform.
