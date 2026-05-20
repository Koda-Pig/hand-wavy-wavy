// app.jsx — 3×3 grid of ethereal gesture tiles + global Tweaks panel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "hex": "#ffffff",
  "speed": 3,
  "opacity": 0.72,
  "intensity": 2.5,
  "trail": 0.23,
  "glow": 20,
  "tint": "cool",
  "bgGrid": true
}/*EDITMODE-END*/;

// ---- helpers ---------------------------------------------------------------

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- Tile: hosts one gesture in its own canvas -----------------------------

function Tile({ gesture, opts, label, desc, idx }) {
  const canvasRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  const stateRef = React.useRef(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');

    let dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const W = 280, H = 440;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    // seed bg
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    stateRef.current = new gesture.cls(W, H);

    let prev = performance.now();
    let raf = 0;
    let alive = true;
    const loop = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      try {
        stateRef.current.step(dt, optsRef.current);
        stateRef.current.draw(ctx, optsRef.current);
      } catch (e) {
        console.error('gesture error', gesture.id, e);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [gesture]);

  return (
    <figure className="tile" data-screen-label={`Tile ${idx + 1} · ${label}`}>
      <div className="tile-frame" ref={wrapRef}>
        <canvas ref={canvasRef} />
        <div className="tile-vignette" />
      </div>
      <figcaption className="tile-cap">
        <span className="tile-name">{label}</span>
        <span className="tile-desc">{desc}</span>
      </figcaption>
    </figure>
  );
}

// ---- App -------------------------------------------------------------------

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const opts = React.useMemo(() => ({
    speed: t.speed,
    color: hexToRgb(t.hex),
    opacity: t.opacity,
    intensity: t.intensity,
    trail: t.trail,
    glow: t.glow,
  }), [t.speed, t.hex, t.opacity, t.intensity, t.trail, t.glow]);

  return (
    <div className="page" data-bggrid={t.bgGrid ? '1' : '0'}>
      <header className="hd">
        <div className="hd-l">
          <h1>Gesture motion · explorations</h1>
          <p>Nine energy-stream studies — bio-luminescent, smoky, ephemeral. Each tile is a candidate gesture to bind to a tracked fingertip.</p>
        </div>
        <div className="hd-r">
          <span className="hd-dot" /> live · 9 motions
        </div>
      </header>

      <main className="grid">
        {GESTURES.map((g, i) => (
          <Tile key={g.id} gesture={g} opts={opts} label={g.name} desc={g.desc} idx={i} />
        ))}
      </main>

      <TweaksPanel title="Motion controls">
        <TweakSection label="Energy">
          <TweakSlider label="Speed"     value={t.speed}     min={0.1} max={3}    step={0.05} unit="×"
                       onChange={(v) => setTweak('speed', v)} />
          <TweakSlider label="Intensity" value={t.intensity} min={0.3} max={2.5}  step={0.05} unit="×"
                       onChange={(v) => setTweak('intensity', v)} />
          <TweakSlider label="Opacity"   value={t.opacity}   min={0.1} max={1}    step={0.02}
                       onChange={(v) => setTweak('opacity', v)} />
        </TweakSection>

        <TweakSection label="Light">
          <TweakSlider label="Glow"      value={t.glow}      min={0}   max={28}   step={1} unit="px"
                       onChange={(v) => setTweak('glow', v)} />
          <TweakSlider label="Persistence" value={Number((1 - t.trail).toFixed(2))} min={0.7} max={0.99} step={0.01}
                       onChange={(v) => setTweak('trail', Number((1 - v).toFixed(3)))} />
        </TweakSection>

        <TweakSection label="Tint">
          <TweakColor label="Stream colour" value={t.hex}
            options={['#ffffff', '#9ad6ff', '#7df0d1', '#caa6ff', '#ffb38a', '#ff7a9e']}
            onChange={(v) => setTweak('hex', v)} />
        </TweakSection>

        <TweakSection label="Stage">
          <TweakToggle label="Grid backdrop" value={t.bgGrid}
                       onChange={(v) => setTweak('bgGrid', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
