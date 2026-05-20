// React Tweaks panel for the energy-streams sketch. Mutates the global
// window.__streams state object that the canvas animations read from each
// frame, so changes are live without re-mounting anything.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "silver",
  "speed": 1.0,
  "opacity": 1.0,
  "density": 1.0,
  "trail": 0.08,
  "glow": 1.0,
  "paused": false
}/*EDITMODE-END*/;

const PALETTES = {
  silver:  { color: '#e8f4ff', accent: '#ffffff' },
  aurora:  { color: '#7adfff', accent: '#a0ffe6' },
  ember:   { color: '#ffb37a', accent: '#ff6b3d' },
  violet:  { color: '#c79cff', accent: '#7a5cff' },
  jade:    { color: '#9af2c1', accent: '#42d29a' },
  rose:    { color: '#ffb1d8', accent: '#ff6fb8' },
};

function applyTweaks(t) {
  const S = window.__streams;
  if (!S) return;
  const p = PALETTES[t.palette] || PALETTES.silver;
  S.color = p.color;
  S.accent = p.accent;
  S.speed = t.speed;
  S.opacity = t.opacity;
  S.density = t.density;
  S.trail = t.trail;
  S.glow = t.glow;
  S.paused = !!t.paused;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Sync into window.__streams on every change
  React.useEffect(() => { applyTweaks(t); }, [t]);

  return (
    <TweaksPanel title="Energy Streams">
      <TweakSection label="Color" />
      <TweakColor
        label="Palette"
        value={t.palette}
        options={[
          { value: 'silver', label: 'silver' },
          { value: 'aurora', label: 'aurora' },
          { value: 'ember',  label: 'ember'  },
          { value: 'violet', label: 'violet' },
          { value: 'jade',   label: 'jade'   },
          { value: 'rose',   label: 'rose'   },
        ].map(o => o.value)}
        onChange={(v) => setTweak('palette', v)}
      />

      <TweakSection label="Motion" />
      <TweakSlider label="Speed"     value={t.speed}    min={0.1} max={3}   step={0.05} onChange={(v) => setTweak('speed', v)} />
      <TweakSlider label="Density"   value={t.density}  min={0.2} max={2.5} step={0.05} onChange={(v) => setTweak('density', v)} />
      <TweakToggle label="Paused"    value={t.paused}   onChange={(v) => setTweak('paused', v)} />

      <TweakSection label="Look" />
      <TweakSlider label="Opacity"   value={t.opacity}  min={0.1} max={1.5} step={0.05} onChange={(v) => setTweak('opacity', v)} />
      <TweakSlider label="Glow"      value={t.glow}     min={0.2} max={2.5} step={0.05} onChange={(v) => setTweak('glow', v)} />
      <TweakSlider label="Trail"     value={t.trail}    min={0.02} max={0.3} step={0.005} unit="" onChange={(v) => setTweak('trail', v)} />
    </TweaksPanel>
  );
}

// PALETTES needs custom swatch rendering — replace the default TweakColor
// (which expects hex options) with one that maps named palettes to swatches.
// Inline override below.
const __originalTweakColor = window.TweakColor;
window.TweakColor = function PalettePicker({ label, value, options, onChange }) {
  // options here are strings (palette ids). Map each to its colors for display.
  const opts = options.map((id) => {
    const p = PALETTES[id];
    return p ? [p.color, p.accent, '#000000'] : ['#888'];
  });
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((id, i) => {
          const colors = opts[i];
          const [hero, ...rest] = colors;
          const on = id === value;
          return (
            <button key={id} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? '1' : '0'}
                    title={id}
                    style={{ background: hero }}
                    onClick={() => onChange(id)}>
              {rest.length > 0 && (
                <span>
                  {rest.slice(0, 4).map((c, j) => <i key={j} style={{ background: c }} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
};

// Mount when DOM is ready and after animations have booted.
function mount() {
  const host = document.getElementById('panel-root');
  if (!host) return;
  ReactDOM.createRoot(host).render(<App />);
}
window.addEventListener('load', mount);
