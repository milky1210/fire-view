'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { CloudRain, Flame, Grid3X3, Moon, Plus, Sparkles, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { FluidFireCanvas } from './fluid-fire-canvas';

const GRID_STOPS = [16, 32, 64, 128, 256, 512];
const POWDERS = {
  copper: { label: '銅', formula: 'Cu', color: '#45e6b0' },
  strontium: { label: 'ストロンチウム', formula: 'Sr', color: '#ff3158' },
  sodium: { label: 'ナトリウム', formula: 'Na', color: '#ffd43b' },
} as const;

type Powder = keyof typeof POWDERS | 'none';
type Weather = 'calm' | 'wind' | 'rain';

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
          <div><b>EMBER FIELD</b><small>GPU FLUID · CURL FORCE / {weatherCopy.toUpperCase()}</small></div>
        </div>
        <Button variant="ghost" size="sm" onClick={cycleWeather} className="weather-button" aria-label="天候を切り替える">
          <WeatherIcon /> {weatherCopy}
        </Button>
        <div className="canvas-wrap">
          <FluidFireCanvas size={size} logs={logs} powder={powder} weather={weather} />
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
