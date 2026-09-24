'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CloudRain, Flame, Grid3X3, Moon, Plus, Sparkles, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

const GRID_STOPS = [16, 32, 64, 128, 256, 512];
const POWDERS = {
  copper: { label: '銅', formula: 'Cu', color: '#45e6b0' },
  strontium: { label: 'ストロンチウム', formula: 'Sr', color: '#ff3158' },
  sodium: { label: 'ナトリウム', formula: 'Na', color: '#ffd43b' },
} as const;

type Powder = keyof typeof POWDERS | 'none';
type Weather = 'calm' | 'wind' | 'rain';

function sample(field: Float32Array, size: number, x: number, y: number) {
  const ix = Math.max(0, Math.min(size - 1, x | 0));
  const iy = Math.max(0, Math.min(size - 1, y | 0));
  return field[iy * size + ix];
}

function FireCanvas({
  size,
  logs,
  powder,
  weather,
}: {
  size: number;
  logs: number;
  powder: Powder;
  weather: Weather;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;
    ctx.imageSmoothingEnabled = false;
    let heat = new Float32Array(size * size);
    let next = new Float32Array(size * size);
    let animation = 0;
    let frame = 0;
    const start = performance.now();
    const pixels = ctx.createImageData(size, size);
    const flameLayer = document.createElement('canvas');
    flameLayer.width = size;
    flameLayer.height = size;
    const flameCtx = flameLayer.getContext('2d', { alpha: true });
    if (!flameCtx) return;
    flameCtx.imageSmoothingEnabled = false;
    const tongueCenterA = new Float32Array(size);
    const tongueCenterB = new Float32Array(size);
    const tongueCenterC = new Float32Array(size);
    const tongueWidthA = new Float32Array(size);
    const tongueWidthB = new Float32Array(size);
    const tongueWidthC = new Float32Array(size);

    const draw = (now: number) => {
      frame += 1;
      const stride = size >= 512 ? 3 : size >= 256 ? 2 : 1;
      const time = (now - start) / 1000;

      if (frame % stride === 0) {
        const sinX1 = new Float32Array(size);
        const cosX1 = new Float32Array(size);
        const sinX2 = new Float32Array(size);
        const cosX2 = new Float32Array(size);
        const sinY1 = new Float32Array(size);
        const cosY1 = new Float32Array(size);
        const sinY2 = new Float32Array(size);
        const cosY2 = new Float32Array(size);

        for (let i = 0; i < size; i += 1) {
          const p = i / size;
          sinX1[i] = Math.sin(p * 11.2 + time * 0.7);
          cosX1[i] = Math.cos(p * 11.2 + time * 0.7);
          sinX2[i] = Math.sin(p * 23.6 - time * 0.43);
          cosX2[i] = Math.cos(p * 23.6 - time * 0.43);
          sinY1[i] = Math.sin(p * 12.8 - time * 0.94);
          cosY1[i] = Math.cos(p * 12.8 - time * 0.94);
          sinY2[i] = Math.sin(p * 21.4 + time * 0.61);
          cosY2[i] = Math.cos(p * 21.4 + time * 0.61);
        }

        const sourceY = size * 0.855;
        const sourceWidth = 0.19 + Math.min(logs, 8) * 0.026;
        const rainFactor = weather === 'rain' ? 0.82 : 1;
        const strength = (0.76 + Math.min(logs, 8) * 0.06) * rainFactor;
        const windPush = weather === 'wind' ? 2.1 + Math.sin(time * 0.7) * 0.9 : 0;

        for (let y = 0; y < size; y += 1) {
          const ny = y / size;
          for (let x = 0; x < size; x += 1) {
            const index = y * size + x;
            const curlX = sinX1[x] * cosY1[y] + sinX2[x] * cosY2[y] * 0.42;
            const curlY = -cosX1[x] * sinY1[y] - cosX2[x] * sinY2[y] * 0.42;
            const hash = (((x * 73856093) ^ (y * 19349663) ^ (frame * 83492791)) & 255) / 255;
            const rise = 0.66 + Math.max(0, heat[index]) * 1.42;
            const sx = x - curlX * (0.72 + ny * 0.5) - windPush * (1 - ny) + (hash - 0.5) * 0.45;
            const sy = y + rise - curlY * 0.48;
            let value = sample(heat, size, sx, sy) * (0.981 - (1 - ny) * 0.018);

            const sourceDistance = Math.abs(x / size - 0.5) / sourceWidth;
            if (sourceDistance < 1) {
              const envelope = Math.max(0, 1 - sourceDistance * sourceDistance);
              const sourceWave =
                Math.sin(x * 0.31 + time * 3.1) * size * 0.007
                + Math.sin(x * 0.13 - time * 2.2) * size * 0.005
                + (1 - envelope) * size * 0.012;
              const localSourceY = sourceY + sourceWave;
              const sourceDepth = size * (0.009 + envelope * 0.012);
              const verticalDistance = Math.abs(y - localSourceY) / Math.max(1, sourceDepth);

              if (verticalDistance < 1) {
                const pocket = 0.72
                  + Math.sin(x * 0.23 - time * 4.4) * 0.13
                  + Math.sin(x * 0.51 + time * 2.7) * 0.09
                  + (hash - 0.5) * 0.12;
                const ignition = strength
                  * Math.pow(envelope, 0.58)
                  * Math.pow(1 - verticalDistance, 0.7)
                  * pocket;
                value = Math.max(value, ignition);
              }
            }
            next[index] = Math.max(0, Math.min(1.35, value));
          }
        }
        [heat, next] = [next, heat];
      }

      const flameBaseY = size * 0.875;
      const baseWidth = 0.16 + Math.min(logs, 8) * 0.022;
      const windAmount = weather === 'wind' ? 0.34 + Math.sin(time * 0.72) * 0.08 : 0;
      const fuelLift = Math.min(logs, 8) * 0.012;
      const tongueHeights = [
        0.48 + fuelLift + Math.sin(time * 1.37) * 0.055,
        0.31 + fuelLift * 0.6 + Math.sin(time * 1.91 + 2.1) * 0.045,
        0.37 + fuelLift * 0.72 + Math.sin(time * 1.63 + 4.3) * 0.05,
      ];
      const tongueCenters = [tongueCenterA, tongueCenterB, tongueCenterC];
      const tongueWidths = [tongueWidthA, tongueWidthB, tongueWidthC];
      const tongueOffsets = [0, -baseWidth * 0.5, baseWidth * 0.48];
      const tongueBaseWidths = [baseWidth, baseWidth * 0.58, baseWidth * 0.54];

      for (let y = 0; y < size; y += 1) {
        const upward = (flameBaseY - y) / size;

        for (let tongue = 0; tongue < 3; tongue += 1) {
          const progress = upward / tongueHeights[tongue];
          if (progress < 0 || progress >= 1) {
            tongueCenters[tongue][y] = 0.5;
            tongueWidths[tongue][y] = 0;
            continue;
          }
          const phase = tongue * 2.37;
          const curl =
            Math.sin(progress * 8.6 - time * 1.78 + phase) * (0.012 + progress * 0.028)
            + Math.sin(progress * 17.3 + time * 1.11 + phase * 0.7) * 0.009;
          tongueCenters[tongue][y] = 0.5 + tongueOffsets[tongue] * (1 - progress) + windAmount * Math.pow(progress, 1.45) + curl;
          tongueWidths[tongue][y] = tongueBaseWidths[tongue]
            * Math.pow(1 - progress, 0.76)
            * (0.86 + Math.sin(progress * 12.4 - time * 2.06 + phase) * 0.14);
        }
      }

      for (let i = 0; i < heat.length; i += 1) {
        const p = i * 4;
        const x = i % size;
        const y = Math.floor(i / size);
        const nx = x / size;
        const maskA = tongueWidthA[y] > 0 ? Math.max(0, 1 - Math.abs(nx - tongueCenterA[y]) / tongueWidthA[y]) : 0;
        const maskB = tongueWidthB[y] > 0 ? Math.max(0, 1 - Math.abs(nx - tongueCenterB[y]) / tongueWidthB[y]) : 0;
        const maskC = tongueWidthC[y] > 0 ? Math.max(0, 1 - Math.abs(nx - tongueCenterC[y]) / tongueWidthC[y]) : 0;
        const silhouette = Math.max(maskA, maskB, maskC);
        const upward = Math.max(0, (flameBaseY - y) / size);
        const detail = 0.72
          + Math.sin(x * 0.43 + y * 0.19 - time * 3.2) * 0.12
          + Math.sin(x * 0.17 - y * 0.31 + time * 2.1) * 0.1
          + Math.sin((x + y) * 0.61 - time * 4.7) * 0.06;
        const renderStrength = (0.7 + Math.min(logs, 8) * 0.052) * (weather === 'rain' ? 0.84 : 1);
        const shapedHeat = heat[i] * Math.min(1.18, 0.32 + silhouette * 1.04);
        const postHeat = Math.pow(silhouette, 0.64) * Math.max(0.22, 1 - upward * 1.18) * detail * renderStrength;
        const t = silhouette > 0 ? Math.max(shapedHeat, postHeat) : 0;
        const dither = ((x & 1) * 2 + (y & 1)) / 3;
        const cutoff = 0.052 + dither * 0.018;
        if (t < cutoff) {
          pixels.data[p] = 0;
          pixels.data[p + 1] = 0;
          pixels.data[p + 2] = 0;
          pixels.data[p + 3] = 0;
          continue;
        }
        const glow = Math.min(1, Math.pow((t - cutoff) / (1 - cutoff), 0.78));
        let red = Math.min(255, 92 + glow * 205);
        let green = Math.min(255, Math.max(0, (glow - 0.2) * 300));
        let blue = Math.min(255, Math.max(0, (glow - 0.7) * 620));
        if (powder !== 'none' && glow > 0.26) {
          const tint = powder === 'copper'
            ? [39, 239, 171]
            : powder === 'strontium'
              ? [255, 28, 68]
              : [255, 218, 47];
          const mix = Math.min(0.72, (glow - 0.26) * 0.92);
          red = red * (1 - mix) + tint[0] * mix;
          green = green * (1 - mix) + tint[1] * mix;
          blue = blue * (1 - mix) + tint[2] * mix;
        }
        pixels.data[p] = red;
        pixels.data[p + 1] = green;
        pixels.data[p + 2] = blue;
        pixels.data[p + 3] = Math.min(255, 18 + glow * 260);
      }

      flameCtx.clearRect(0, 0, size, size);
      flameCtx.putImageData(pixels, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.filter = `blur(${Math.max(1, size * 0.024)}px)`;
      ctx.drawImage(flameLayer, 0, 0);
      ctx.globalAlpha = 0.28;
      ctx.filter = `blur(${Math.max(0.6, size * 0.009)}px)`;
      ctx.drawImage(flameLayer, 0, 0);
      ctx.restore();
      ctx.drawImage(flameLayer, 0, 0);

      const logH = Math.max(1, Math.round(size * 0.038));
      const logW = Math.round(size * 0.42);
      const logX = Math.round((size - logW) / 2);
      const visibleLogs = Math.max(1, Math.min(logs, 7));
      for (let i = 0; i < visibleLogs; i += 1) {
        const y = Math.round(size * 0.87 + (i % 3) * logH * 1.15);
        const inset = (i % 2) * Math.round(size * 0.045);
        ctx.fillStyle = i % 2 ? '#5c2718' : '#70301b';
        ctx.fillRect(logX + inset, y, logW - inset * 2, logH);
        ctx.fillStyle = '#dc6a2c';
        ctx.fillRect(logX + inset + 1, y, Math.max(1, logH * 0.8), logH);
        ctx.fillStyle = '#32140f';
        ctx.fillRect(logX + inset + logH * 2, y + 1, logW * 0.2, 1);
      }

      animation = requestAnimationFrame(draw);
    };

    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [size, logs, powder, weather]);

  return <canvas ref={canvasRef} className="fire-canvas" aria-label={`${size}×${size} 格子で動く薪の炎`} />;
}

export function FireView() {
  const [gridIndex, setGridIndex] = useState(2);
  const [logs, setLogs] = useState(3);
  const [burnAge, setBurnAge] = useState(0);
  const [powder, setPowder] = useState<Powder>('none');
  const [powderUntil, setPowderUntil] = useState(0);
  const [weather, setWeather] = useState<Weather>('calm');
  const size = GRID_STOPS[gridIndex];

  const addLog = useCallback(() => setLogs((value) => Math.min(12, value + 1)), []);
  const addPowder = useCallback((kind: Powder) => {
    setPowder(kind);
    setPowderUntil(Date.now() + 10000);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBurnAge((value) => {
        if (value >= 29) {
          setLogs((count) => Math.max(0, count - 1));
          return 0;
        }
        return value + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (powder === 'none') return;
    const delay = Math.max(0, powderUntil - Date.now());
    const timer = window.setTimeout(() => setPowder('none'), delay);
    return () => window.clearTimeout(timer);
  }, [powder, powderUntil]);

  useEffect(() => {
    const cycle: Weather[] = ['calm', 'wind', 'calm', 'rain'];
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % cycle.length;
      setWeather(cycle[index]);
    }, 16000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    type ToolContext = {
      registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
    const context = (document as unknown as { modelContext?: ToolContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool({
      name: 'configure_fire',
      title: '炎を調整する',
      description: '格子解像度、追加する薪、炎色反応の粉、天候をまとめて変更します。',
      inputSchema: {
        type: 'object',
        properties: {
          gridSize: { type: 'integer', enum: GRID_STOPS },
          addLogs: { type: 'integer', minimum: 0, maximum: 3 },
          powder: { type: 'string', enum: ['none', 'copper', 'strontium', 'sodium'] },
          weather: { type: 'string', enum: ['calm', 'wind', 'rain'] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('設定をオブジェクトで指定してください。');
        const values = input as { gridSize?: number; addLogs?: number; powder?: Powder; weather?: Weather };
        if (values.gridSize !== undefined) {
          const index = GRID_STOPS.indexOf(values.gridSize);
          if (index < 0) throw new Error('gridSize は 16, 32, 64, 128, 256, 512 のいずれかです。');
          setGridIndex(index);
        }
        if (values.addLogs !== undefined) {
          if (!Number.isInteger(values.addLogs) || values.addLogs < 0 || values.addLogs > 3) throw new Error('addLogs は0〜3の整数です。');
          setLogs((count) => Math.min(12, count + values.addLogs!));
        }
        if (values.powder !== undefined) {
          if (!['none', 'copper', 'strontium', 'sodium'].includes(values.powder)) throw new Error('未対応の粉です。');
          if (values.powder === 'none') setPowder('none');
          else addPowder(values.powder);
        }
        if (values.weather !== undefined) {
          if (!['calm', 'wind', 'rain'].includes(values.weather)) throw new Error('未対応の天候です。');
          setWeather(values.weather);
        }
        return { ok: true, applied: values };
      },
    }, { signal: lifecycle.signal });
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [addPowder]);

  const weatherCopy = weather === 'rain' ? '雨' : weather === 'wind' ? '風' : '静かな夜';
  const WeatherIcon = weather === 'rain' ? CloudRain : weather === 'wind' ? Wind : Moon;
  const cycleWeather = () => setWeather((value) => value === 'calm' ? 'wind' : value === 'wind' ? 'rain' : 'calm');

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><Flame /></div>
        <div>
          <p className="eyebrow">REALTIME FIRE STUDY</p>
          <h1>FIRE / VIEW</h1>
        </div>
        <div className="status-pill"><span className="status-dot" />LIVE · {weatherCopy}</div>
      </header>

      <section className={`stage weather-${weather}`} aria-label="焚き火シミュレーション">
        {weather === 'rain' && (
          <div className="rain-layer" aria-hidden="true">
            {Array.from({ length: 26 }, (_, index) => (
              <i
                key={index}
                style={{
                  left: `${(index * 37 + 5) % 100}%`,
                  animationDelay: `${index * -0.11}s`,
                  animationDuration: `${0.65 + (index % 4) * 0.08}s`,
                }}
              />
            ))}
          </div>
        )}
        {weather === 'wind' && <div className="wind-streaks" aria-hidden="true"><i /><i /><i /></div>}
        <div className="scene-label">
          <span>01</span>
          <div><b>EMBER FIELD</b><small>CURL NOISE / {weatherCopy.toUpperCase()}</small></div>
        </div>
        <Button variant="ghost" size="sm" onClick={cycleWeather} className="weather-button" aria-label="天候を切り替える">
          <WeatherIcon /> {weatherCopy}
        </Button>
        <div className="canvas-wrap">
          <FireCanvas size={size} logs={logs} powder={powder} weather={weather} />
          <span className="grid-badge">{size} × {size}</span>
          {powder !== 'none' && <span className="reaction-badge" style={{ color: POWDERS[powder].color }}><Sparkles /> {POWDERS[powder].label}</span>}
        </div>
      </section>

      <aside className="control-dock" aria-label="炎の操作">
        <div className="control-heading">
          <span className="control-icon"><Grid3X3 /></span>
          <div><p>GRID RESOLUTION</p><strong>{size} × {size}</strong></div>
        </div>
        <Slider
          aria-label="格子の解像度"
          min={0}
          max={GRID_STOPS.length - 1}
          step={1}
          value={[gridIndex]}
          onValueChange={(value) => setGridIndex(Array.isArray(value) ? value[0] : value)}
          className="resolution-slider"
        />
        <div className="slider-labels" aria-hidden="true">{GRID_STOPS.map((stop) => <span key={stop}>{stop}</span>)}</div>
        <div className="fuel-row">
          <div><div><p>薪ストック</p><strong>{logs}<small> 本</small></strong></div><span className="burn-copy">次の燃焼まで {30 - burnAge}s</span></div>
          <div className="burn-track" aria-hidden="true"><i style={{ width: `${(burnAge / 30) * 100}%` }} /></div>
          <Button onClick={addLog} className="add-log-button" disabled={logs >= 12}>
            <Plus /> 薪をくべる
          </Button>
        </div>

        <section className="powder-panel" aria-labelledby="powder-title">
          <div className="section-title"><Sparkles /><div><p id="powder-title">FLAME COLOR</p><span>金属の粉をかける</span></div></div>
          <div className="powder-grid">
            {(Object.entries(POWDERS) as [Exclude<Powder, 'none'>, (typeof POWDERS)[Exclude<Powder, 'none'>]][]).map(([key, item]) => (
              <Button
                key={key}
                variant="outline"
                onClick={() => addPowder(key)}
                className={`powder-button ${powder === key ? 'is-active' : ''}`}
                style={{ '--powder': item.color } as CSSProperties}
              >
                <i /> <span>{item.formula}<small>{item.label}</small></span>
              </Button>
            ))}
          </div>
          <p className="powder-note">炎色は10秒間ゆらぎ、元の橙色へ戻ります。</p>
        </section>
      </aside>

      <footer className="footer-note">
        <span>SIMULATION 01</span><p>格子の中を流れる、消えない夜の火。</p><small>{logs === 0 ? '熾火が静かに燃えています' : `薪 ${logs}本 · ${weatherCopy}`}</small>
      </footer>
    </main>
  );
}
