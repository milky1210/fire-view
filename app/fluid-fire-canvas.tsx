'use client';

import { useEffect, useRef } from 'react';

type Powder = 'none' | 'copper' | 'strontium' | 'sodium';
type Weather = 'calm' | 'wind' | 'rain';

type FluidFireCanvasProps = {
  size: number;
  logs: number;
  powder: Powder;
  weather: Weather;
};

type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

type Program = {
  value: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = gl_VertexID == 0 ? vec2(-1.0, -1.0) : gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0);
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const BILERP = `
uniform vec2 uResolution;
vec4 bilerp(sampler2D field, vec2 uv) {
  vec2 position = clamp(uv, vec2(0.0), vec2(1.0)) * uResolution - 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 fraction = fract(position);
  ivec2 limit = ivec2(uResolution) - 1;
  ivec2 p00 = clamp(base, ivec2(0), limit);
  ivec2 p10 = clamp(base + ivec2(1, 0), ivec2(0), limit);
  ivec2 p01 = clamp(base + ivec2(0, 1), ivec2(0), limit);
  ivec2 p11 = clamp(base + ivec2(1, 1), ivec2(0), limit);
  vec4 a = mix(texelFetch(field, p00, 0), texelFetch(field, p10, 0), fraction.x);
  vec4 b = mix(texelFetch(field, p01, 0), texelFetch(field, p11, 0), fraction.x);
  return mix(a, b, fraction.y);
}
`;

const VELOCITY_CODEC = `
vec2 readVelocity(sampler2D field, vec2 uv) {
  vec2 value = bilerp(field, uv).xy;
#ifdef PACKED
  return value * 2.0 - 1.0;
#else
  return value;
#endif
}
vec4 writeVelocity(vec2 value) {
#ifdef PACKED
  return vec4(value * 0.5 + 0.5, 0.0, 1.0);
#else
  return vec4(value, 0.0, 1.0);
#endif
}
`;

const STATE_CODEC = `
vec4 readState(sampler2D field, vec2 uv) {
  vec4 value = bilerp(field, uv);
#ifdef PACKED
  return vec4(value.r * 3.2, value.g * 2.4, value.b * 2.0, 1.0);
#else
  return value;
#endif
}
vec4 writeState(vec3 value) {
#ifdef PACKED
  return vec4(value / vec3(3.2, 2.4, 2.0), 1.0);
#else
  return vec4(value, 1.0);
#endif
}
`;

const SCALAR_CODEC = `
float readScalar(sampler2D field, vec2 uv) {
  float value = texture(field, clamp(uv, vec2(0.0), vec2(1.0))).r;
#ifdef PACKED
  return value * 2.0 - 1.0;
#else
  return value;
#endif
}
vec4 writeScalar(float value) {
#ifdef PACKED
  return vec4(value * 0.5 + 0.5, 0.0, 0.0, 1.0);
#else
  return vec4(value, 0.0, 0.0, 1.0);
#endif
}
`;

const ADVECT_VELOCITY_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uVelocity;
uniform float uDt;
${BILERP}
${VELOCITY_CODEC}
void main() {
  vec2 velocity = readVelocity(uVelocity, vUv);
  vec2 previous = vUv - velocity * uDt;
  vec2 advected = readVelocity(uVelocity, previous) * exp(-uDt * 0.12);
  vec2 cell = 1.0 / uResolution;
  if (vUv.x < cell.x || vUv.x > 1.0 - cell.x) advected.x = 0.0;
  if (vUv.y < cell.y) advected.y = max(0.0, advected.y);
  outValue = writeVelocity(advected);
}`;

const FORCE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uVelocity;
uniform sampler2D uState;
uniform float uDt;
uniform float uTime;
uniform float uWind;
${BILERP}
${VELOCITY_CODEC}
${STATE_CODEC}

vec2 velocityAt(vec2 uv) { return readVelocity(uVelocity, uv); }
float curlAt(vec2 uv) {
  vec2 cell = 1.0 / uResolution;
  float rightY = velocityAt(uv + vec2(cell.x, 0.0)).y;
  float leftY = velocityAt(uv - vec2(cell.x, 0.0)).y;
  float topX = velocityAt(uv + vec2(0.0, cell.y)).x;
  float bottomX = velocityAt(uv - vec2(0.0, cell.y)).x;
  return 0.5 * ((rightY - leftY) - (topX - bottomX));
}

void main() {
  vec2 cell = 1.0 / uResolution;
  vec2 velocity = velocityAt(vUv);
  vec4 state = readState(uState, vUv);
  float temperature = state.r;
  float soot = state.b;

  velocity.y += uDt * max(0.0, temperature * 1.25 - soot * 0.05);
  float gust = 0.62 + 0.38 * sin(uTime * 0.55 + vUv.y * 5.0);
  velocity.x += uDt * uWind * (0.015 + temperature * 0.022) * gust;

  float curl = curlAt(vUv);
  vec2 curlGradient = vec2(
    abs(curlAt(vUv + vec2(cell.x, 0.0))) - abs(curlAt(vUv - vec2(cell.x, 0.0))),
    abs(curlAt(vUv + vec2(0.0, cell.y))) - abs(curlAt(vUv - vec2(0.0, cell.y)))
  );
  vec2 curlNormal = curlGradient / (length(curlGradient) + 0.0001);
  velocity += vec2(curlNormal.y, -curlNormal.x) * curl * uDt * 12.0;

  float phaseB = vUv.x * 23.3 - vUv.y * 16.1 + uTime * 1.13;
  vec2 curlNoise = vec2(
    8.9 * cos(vUv.y * 8.9 - uTime * 1.7) * sin(vUv.x * 12.7) - 16.1 * cos(phaseB),
    -12.7 * cos(vUv.x * 12.7) * sin(vUv.y * 8.9 - uTime * 1.7) - 23.3 * cos(phaseB)
  );
  float plume = smoothstep(0.015, 0.35, temperature + soot * 0.18);
  velocity += curlNoise * (0.0014 * plume * uDt * 30.0);

  if (vUv.x < cell.x || vUv.x > 1.0 - cell.x) velocity.x = 0.0;
  if (vUv.y < cell.y) velocity.y = max(0.0, velocity.y);
  outValue = writeVelocity(clamp(velocity, vec2(-0.7), vec2(0.7)));
}`;

const DIVERGENCE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uVelocity;
${BILERP}
${VELOCITY_CODEC}
${SCALAR_CODEC}
void main() {
  vec2 cell = 1.0 / uResolution;
  vec2 left = readVelocity(uVelocity, vUv - vec2(cell.x, 0.0));
  vec2 right = readVelocity(uVelocity, vUv + vec2(cell.x, 0.0));
  vec2 bottom = readVelocity(uVelocity, vUv - vec2(0.0, cell.y));
  vec2 top = readVelocity(uVelocity, vUv + vec2(0.0, cell.y));
  float divergence = 0.5 * ((right.x - left.x) + (top.y - bottom.y));
  outValue = writeScalar(divergence);
}`;

const PRESSURE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uResolution;
${SCALAR_CODEC}
void main() {
  vec2 cell = 1.0 / uResolution;
  float left = readScalar(uPressure, vUv - vec2(cell.x, 0.0));
  float right = readScalar(uPressure, vUv + vec2(cell.x, 0.0));
  float bottom = readScalar(uPressure, vUv - vec2(0.0, cell.y));
  float top = readScalar(uPressure, vUv + vec2(0.0, cell.y));
  float divergence = readScalar(uDivergence, vUv);
  outValue = writeScalar((left + right + bottom + top - divergence) * 0.25);
}`;

const PROJECT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uVelocity;
uniform sampler2D uPressure;
${BILERP}
${VELOCITY_CODEC}
${SCALAR_CODEC}
void main() {
  vec2 cell = 1.0 / uResolution;
  float left = readScalar(uPressure, vUv - vec2(cell.x, 0.0));
  float right = readScalar(uPressure, vUv + vec2(cell.x, 0.0));
  float bottom = readScalar(uPressure, vUv - vec2(0.0, cell.y));
  float top = readScalar(uPressure, vUv + vec2(0.0, cell.y));
  vec2 velocity = readVelocity(uVelocity, vUv) - 0.5 * vec2(right - left, top - bottom);
  if (vUv.x < cell.x || vUv.x > 1.0 - cell.x) velocity.x = 0.0;
  if (vUv.y < cell.y) velocity.y = max(0.0, velocity.y);
  outValue = writeVelocity(velocity);
}`;

const STATE_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outValue;
uniform sampler2D uState;
uniform sampler2D uVelocity;
uniform float uDt;
uniform float uTime;
uniform float uLogs;
uniform float uRain;
${BILERP}
${VELOCITY_CODEC}
${STATE_CODEC}

float hash(float value) { return fract(sin(value * 91.3458) * 47453.5453); }

void main() {
  vec2 velocity = readVelocity(uVelocity, vUv);
  vec2 previous = vUv - velocity * uDt;
  vec4 state = readState(uState, previous);
  vec2 cell = 1.0 / uResolution;
  vec4 neighbors = (
    readState(uState, vUv + vec2(cell.x, 0.0)) + readState(uState, vUv - vec2(cell.x, 0.0))
    + readState(uState, vUv + vec2(0.0, cell.y)) + readState(uState, vUv - vec2(0.0, cell.y))
  ) * 0.25;
  state = mix(state, neighbors, min(0.035, uDt * 0.36));

  float activeLogs = max(1.0, uLogs);
  float spacing = min(0.072, 0.54 / activeLogs);
  float source = 0.0;
  for (int i = 0; i < 12; i++) {
    float index = float(i);
    float enabled = 1.0 - step(activeLogs - 0.5, index);
    float centered = index - (activeLogs - 1.0) * 0.5;
    float sourceX = 0.5 + centered * spacing + sin(uTime * (2.3 + index * 0.07) + index * 2.17) * 0.009;
    float sourceY = 0.153 + mod(index, 3.0) * 0.011;
    vec2 delta = (vUv - vec2(sourceX, sourceY)) / vec2(0.036, 0.019);
    float flamePoint = exp(-dot(delta, delta) * 2.2);
    float flicker = 0.73 + 0.27 * sin(uTime * (5.1 + hash(index) * 2.0) + index * 4.7);
    source += enabled * flamePoint * flicker;
  }
  float bedWidth = 0.105 + min(uLogs, 8.0) * 0.018;
  vec2 bedDelta = (vUv - vec2(0.5, 0.15)) / vec2(bedWidth, 0.018);
  float emberBed = exp(-(pow(abs(bedDelta.x), 3.2) + bedDelta.y * bedDelta.y) * 2.0);
  source += emberBed * (0.34 + min(uLogs, 8.0) * 0.028) * (0.68 + 0.32 * sin(vUv.x * 83.0 - uTime * 3.7));
  source *= 1.0 - uRain * 0.18;

  float fuelPower = 0.58 + min(uLogs, 8.0) * 0.065;
  state.g = min(2.4, state.g + source * fuelPower * uDt * 2.8);
  state.r = min(3.2, state.r + source * (4.5 + min(uLogs, 8.0) * 0.22) * uDt);
  float ignition = smoothstep(0.22, 0.62, state.r);
  float burn = min(state.g, uDt * ignition * (0.8 + state.g * 1.8));
  state.g -= burn;
  state.r += burn * 4.1;
  state.b += burn * 1.55;

  state.r *= exp(-uDt * (0.43 + vUv.y * 0.82 + uRain * 0.7));
  state.g *= exp(-uDt * 0.08);
  state.b *= exp(-uDt * (0.22 + uRain * 0.12));
  float openTop = 1.0 - smoothstep(0.94, 1.0, vUv.y);
  float sideFade = smoothstep(0.0, 0.025, vUv.x) * (1.0 - smoothstep(0.975, 1.0, vUv.x));
  state.rgb *= openTop * sideFade;
  outValue = writeState(max(state.rgb, vec3(0.0)));
}`;

const RENDER_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform float uLogs;
uniform vec3 uPowderColor;
uniform float uPowderMix;
${BILERP}
${STATE_CODEC}

float heatAt(vec2 uv) {
  vec4 state = readState(uState, clamp(uv, vec2(0.0), vec2(1.0)));
  return state.r + state.b * 0.025;
}

float box(vec2 point, vec2 center, vec2 halfSize) {
  vec2 distance = abs(point - center) - halfSize;
  return 1.0 - step(0.0, max(distance.x, distance.y));
}

void main() {
  vec4 state = readState(uState, vUv);
  float temperature = state.r;
  float soot = state.b;
  vec2 cell = 1.0 / uResolution;
  float nearGlow = (
    heatAt(vUv + vec2(cell.x * 2.0, 0.0)) + heatAt(vUv - vec2(cell.x * 2.0, 0.0))
    + heatAt(vUv + vec2(0.0, cell.y * 2.0)) + heatAt(vUv - vec2(0.0, cell.y * 2.0))
  ) * 0.25;
  float farGlow = (
    heatAt(vUv + vec2(cell.x * 5.0, 0.0)) + heatAt(vUv - vec2(cell.x * 5.0, 0.0))
    + heatAt(vUv + vec2(0.0, cell.y * 5.0)) + heatAt(vUv - vec2(0.0, cell.y * 5.0))
  ) * 0.25;
  float aura = smoothstep(0.028, 0.34, nearGlow * 0.68 + farGlow * 0.32) * 0.1;

  float heat = clamp(temperature / 2.25, 0.0, 1.0);
  vec3 color = mix(vec3(0.18, 0.008, 0.002), vec3(1.0, 0.16, 0.005), smoothstep(0.03, 0.43, heat));
  color = mix(color, vec3(1.0, 0.72, 0.055), smoothstep(0.36, 0.76, heat));
  color = mix(color, vec3(1.0, 0.98, 0.78), smoothstep(0.72, 1.0, heat));
  float powderBand = uPowderMix * smoothstep(0.08, 0.46, heat) * (1.0 - smoothstep(0.9, 1.0, heat));
  color = mix(color, uPowderColor, powderBand * 0.78);
  float fireAlpha = smoothstep(0.055, 0.25, temperature) * clamp(0.18 + heat * 0.9 + soot * 0.02, 0.0, 1.0);
  vec3 powderAura = mix(vec3(1.0, 0.09, 0.01), uPowderColor, uPowderMix * 0.38);
  vec3 result = powderAura * aura + color * fireAlpha;

  float logMask = 0.0;
  float logEdge = 0.0;
  float visibleLogs = min(7.0, uLogs);
  for (int i = 0; i < 7; i++) {
    float index = float(i);
    float enabled = 1.0 - step(visibleLogs - 0.5, index);
    float row = mod(index, 3.0);
    float layer = floor(index / 3.0);
    vec2 center = vec2(0.5 + (mod(index, 2.0) - 0.5) * 0.045, 0.075 + row * 0.033 + layer * 0.004);
    vec2 halfSize = vec2(0.19 - row * 0.012, 0.014);
    float current = box(vUv, center, halfSize) * enabled;
    logMask = max(logMask, current);
    logEdge = max(logEdge, current * box(vUv, center - vec2(halfSize.x - 0.012, 0.0), vec2(0.012, halfSize.y)));
  }
  if (logMask > 0.5) {
    float grain = step(0.72, fract(vUv.x * 17.0 + floor(vUv.y * 190.0) * 0.31));
    vec3 bark = mix(vec3(0.25, 0.055, 0.025), vec3(0.46, 0.12, 0.052), grain * 0.42);
    result = mix(bark, vec3(1.0, 0.24, 0.045), logEdge * 0.72);
  }
  outColor = vec4(result, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('シェーダーを作成できませんでした。');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'シェーダーのコンパイルに失敗しました。';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string, packed: boolean): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const source = packed
    ? fragmentSource.replace('precision highp float;', '#define PACKED 1\nprecision highp float;')
    : fragmentSource;
  const fragment = compile(gl, gl.FRAGMENT_SHADER, source);
  const value = gl.createProgram();
  if (!value) throw new Error('描画プログラムを作成できませんでした。');
  gl.attachShader(value, vertex);
  gl.attachShader(value, fragment);
  gl.linkProgram(value);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(value) ?? '描画プログラムのリンクに失敗しました。';
    gl.deleteProgram(value);
    throw new Error(message);
  }
  return { value, uniforms: new Map() };
}

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  packed: boolean,
  kind: 'velocity' | 'state' | 'scalar',
): Target {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('流体バッファを作成できませんでした。');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    packed ? gl.RGBA8 : gl.RGBA16F,
    width,
    height,
    0,
    gl.RGBA,
    packed ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT,
    null,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('浮動小数点バッファに対応していません。');
  const encodedZero = packed && kind !== 'state' ? 0.5 : 0;
  gl.clearColor(encodedZero, kind === 'velocity' ? encodedZero : 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { texture, framebuffer, width, height };
}

function destroyTarget(gl: WebGL2RenderingContext, target: Target) {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

function powderColor(powder: Powder): [number, number, number] {
  if (powder === 'copper') return [0.15, 0.94, 0.67];
  if (powder === 'strontium') return [1, 0.08, 0.22];
  if (powder === 'sodium') return [1, 0.82, 0.1];
  return [1, 0.1, 0.01];
}

export function FluidFireCanvas({ size, logs, powder, weather }: FluidFireCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warningRef = useRef<HTMLSpanElement>(null);
  const settingsRef = useRef({ logs, powder, weather });

  useEffect(() => {
    settingsRef.current = { logs, powder, weather };
  }, [logs, powder, weather]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderSize = Math.max(256, size);
    canvas.width = renderSize;
    canvas.height = renderSize;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      if (warningRef.current) warningRef.current.hidden = false;
      return;
    }
    const packed = !gl.getExtension('EXT_color_buffer_float');
    if (warningRef.current) warningRef.current.hidden = true;

    let animation = 0;
    let destroyed = false;
    let velocityRead: Target | undefined;
    let velocityWrite: Target | undefined;
    let stateRead: Target | undefined;
    let stateWrite: Target | undefined;
    let pressureRead: Target | undefined;
    let pressureWrite: Target | undefined;
    let divergence: Target | undefined;
    const programs: Program[] = [];
    const vao = gl.createVertexArray();
    if (!vao) {
      if (warningRef.current) warningRef.current.hidden = false;
      return;
    }
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    const activateProgram = gl.useProgram.bind(gl);

    const uniform = (program: Program, name: string) => {
      if (!program.uniforms.has(name)) program.uniforms.set(name, gl.getUniformLocation(program.value, name));
      return program.uniforms.get(name) ?? null;
    };

    const draw = (
      program: Program,
      target: Target | null,
      textures: Array<[string, WebGLTexture]>,
      values: Record<string, number | [number, number] | [number, number, number]>,
    ) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, target?.width ?? canvas.width, target?.height ?? canvas.height);
      activateProgram(program.value);
      textures.forEach(([name, texture], index) => {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform(program, name), index);
      });
      for (const [name, value] of Object.entries(values)) {
        const location = uniform(program, name);
        if (typeof value === 'number') gl.uniform1f(location, value);
        else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
        else gl.uniform3f(location, value[0], value[1], value[2]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    try {
      const advectVelocity = createProgram(gl, ADVECT_VELOCITY_SHADER, packed);
      const applyForces = createProgram(gl, FORCE_SHADER, packed);
      const calculateDivergence = createProgram(gl, DIVERGENCE_SHADER, packed);
      const solvePressure = createProgram(gl, PRESSURE_SHADER, packed);
      const projectVelocity = createProgram(gl, PROJECT_SHADER, packed);
      const updateState = createProgram(gl, STATE_SHADER, packed);
      const render = createProgram(gl, RENDER_SHADER, packed);
      programs.push(advectVelocity, applyForces, calculateDivergence, solvePressure, projectVelocity, updateState, render);

      velocityRead = createTarget(gl, size, size, packed, 'velocity');
      velocityWrite = createTarget(gl, size, size, packed, 'velocity');
      stateRead = createTarget(gl, size, size, packed, 'state');
      stateWrite = createTarget(gl, size, size, packed, 'state');
      pressureRead = createTarget(gl, size, size, packed, 'scalar');
      pressureWrite = createTarget(gl, size, size, packed, 'scalar');
      divergence = createTarget(gl, size, size, packed, 'scalar');
      const resolution: [number, number] = [size, size];
      const pressureIterations = size <= 64 ? 18 : size <= 128 ? 15 : size <= 256 ? 11 : 8;

      const swapVelocity = () => { [velocityRead, velocityWrite] = [velocityWrite, velocityRead]; };
      const swapState = () => { [stateRead, stateWrite] = [stateWrite, stateRead]; };
      const swapPressure = () => { [pressureRead, pressureWrite] = [pressureWrite, pressureRead]; };

      const step = (dt: number, time: number) => {
        if (!velocityRead || !velocityWrite || !stateRead || !stateWrite || !pressureRead || !pressureWrite || !divergence) return;
        const current = settingsRef.current;
        draw(advectVelocity, velocityWrite, [['uVelocity', velocityRead.texture]], { uResolution: resolution, uDt: dt });
        swapVelocity();
        draw(applyForces, velocityWrite, [['uVelocity', velocityRead.texture], ['uState', stateRead.texture]], {
          uResolution: resolution,
          uDt: dt,
          uTime: time,
          uWind: current.weather === 'wind' ? 1 : 0,
        });
        swapVelocity();
        draw(calculateDivergence, divergence, [['uVelocity', velocityRead.texture]], { uResolution: resolution });
        for (let iteration = 0; iteration < pressureIterations; iteration += 1) {
          draw(solvePressure, pressureWrite, [['uPressure', pressureRead.texture], ['uDivergence', divergence.texture]], { uResolution: resolution });
          swapPressure();
        }
        draw(projectVelocity, velocityWrite, [['uVelocity', velocityRead.texture], ['uPressure', pressureRead.texture]], { uResolution: resolution });
        swapVelocity();
        draw(updateState, stateWrite, [['uState', stateRead.texture], ['uVelocity', velocityRead.texture]], {
          uResolution: resolution,
          uDt: dt,
          uTime: time,
          uLogs: current.logs,
          uRain: current.weather === 'rain' ? 1 : 0,
        });
        swapState();
      };

      const start = performance.now();
      let previous = start;
      let accumulator = 0;
      const fixedDt = size >= 512 ? 1 / 24 : size >= 256 ? 1 / 30 : 1 / 40;
      for (let warmup = 0; warmup < 5; warmup += 1) step(fixedDt, warmup * fixedDt);

      const frame = (now: number) => {
        if (destroyed || !stateRead) return;
        const elapsed = Math.min(0.08, (now - previous) / 1000);
        previous = now;
        accumulator = Math.min(fixedDt * 2, accumulator + elapsed);
        const time = (now - start) / 1000;
        let steps = 0;
        while (accumulator >= fixedDt && steps < 2) {
          step(fixedDt, time);
          accumulator -= fixedDt;
          steps += 1;
        }
        const current = settingsRef.current;
        draw(render, null, [['uState', stateRead.texture]], {
          uResolution: resolution,
          uLogs: current.logs,
          uPowderColor: powderColor(current.powder),
          uPowderMix: current.powder === 'none' ? 0 : 1,
        });
        animation = requestAnimationFrame(frame);
      };
      animation = requestAnimationFrame(frame);
    } catch (error) {
      console.error('Fluid fire initialization failed', error);
      if (warningRef.current) warningRef.current.hidden = false;
    }

    return () => {
      destroyed = true;
      cancelAnimationFrame(animation);
      for (const program of programs) gl.deleteProgram(program.value);
      for (const target of [velocityRead, velocityWrite, stateRead, stateWrite, pressureRead, pressureWrite, divergence]) {
        if (target) destroyTarget(gl, target);
      }
      gl.deleteVertexArray(vao);
    };
  }, [size]);

  return (
    <>
      <canvas ref={canvasRef} className="fire-canvas" aria-label={`${size}×${size} 格子のGPU流体で動く薪の炎`} />
      <span ref={warningRef} className="renderer-warning" hidden>この端末ではGPU流体を開始できません</span>
    </>
  );
}
