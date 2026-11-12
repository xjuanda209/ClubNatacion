/* =========================================================
   Team SER+ · motor del agua (compartido por todas las páginas)
   ========================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;

/* =========================================================
   AGUA
   Simulación de ondas en GPU (WebGL2): las olas se propagan,
   rebotan en las paredes y las corcheras las absorben.
   El render refracta el fondo de baldosas, dibuja cáusticas,
   destellos de sol y las corcheras flotando con su sombra.
   Encima, partículas suspendidas y burbujas que el agua
   arrastra y que se mueven al pasar el cursor o un nadador.
   ========================================================= */

// pasos de simulación por segundo: siempre un número entero de pasos por cuadro
const SIM_HZ = 120;

// oleaje compartido por el agua y las partículas
const WAVE_GLSL = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// pendiente (g) y curvatura (hs = xx, yy, xy) de una onda
void addWave(vec2 p, vec2 d, float wl, float amp, float sp, float t, inout vec2 g, inout vec3 hs) {
  d = normalize(d);
  float k = 6.2831853 / wl;
  float ph = dot(d, p) * k - t * sp;
  g += d * (amp * k * cos(ph));
  hs += vec3(d.x * d.x, d.y * d.y, d.x * d.y) * (-amp * k * k * sin(ph));
}

void waveField(vec2 p, float t, float amp, out vec2 g, out vec3 hs) {
  // el dominio deriva despacio: el oleaje se deforma y fluye en vez de repetirse
  p += (vec2(noise(p * 0.0032 + vec2(t * 0.05, 0.0)), noise(p * 0.0032 + vec2(7.3, t * 0.043))) - 0.5) * 110.0;
  g = vec2(0.0);
  hs = vec3(0.0);
  addWave(p, vec2(1.0, 0.35), 263.0, 2.0, 0.9, t, g, hs);
  addWave(p, vec2(-0.6, 1.0), 171.0, 1.3, 1.15, t, g, hs);
  addWave(p, vec2(0.8, -0.9), 107.0, 0.75, 1.6, t, g, hs);
  addWave(p, vec2(-1.0, -0.25), 73.0, 0.45, 2.05, t, g, hs);
  addWave(p, vec2(0.25, 1.0), 53.0, 0.28, 2.5, t, g, hs);
  addWave(p, vec2(-0.85, 0.6), 41.0, 0.19, 2.9, t, g, hs);
  addWave(p, vec2(0.95, 0.15), 31.0, 0.07, 3.4, t, g, hs);
  addWave(p, vec2(-0.3, -1.0), 23.0, 0.035, 4.1, t, g, hs);
  g *= amp;
  hs *= amp;
}`;

const SIM_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SIM_UPDATE = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uRopes[6];
uniform int uRopeN;
uniform float uRopeBand;
uniform float uC;
uniform vec2 uDamp;
uniform float uRopeAbs;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 info = texture(uState, vUv);
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  // laplaciano de 9 puntos: ondas redondas (no cuadradas)
  float edge = texture(uState, vUv - dx).r + texture(uState, vUv + dx).r +
               texture(uState, vUv - dy).r + texture(uState, vUv + dy).r;
  float diag = texture(uState, vUv - dx - dy).r + texture(uState, vUv + dx - dy).r +
               texture(uState, vUv - dx + dy).r + texture(uState, vUv + dx + dy).r;
  float avg = (edge * 4.0 + diag) / 20.0;
  info.g += (avg - info.r) * uC;
  info.g *= uDamp.x;
  info.r += info.g;
  info.r *= uDamp.y;
  for (int i = 0; i < 6; i++) {
    if (i >= uRopeN) break;
    float d = abs(vUv.y - uRopes[i]);
    float k = 1.0 - smoothstep(0.0, uRopeBand, d);
    info.rg *= 1.0 - k * uRopeAbs;
  }
  o = info;
}`;

const SIM_DROP = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec4 uDrops[8];
uniform int uDropN;
uniform float uAspect;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 info = texture(uState, vUv);
  for (int i = 0; i < 8; i++) {
    if (i >= uDropN) break;
    vec4 d = uDrops[i];
    vec2 q = (vUv - d.xy) * vec2(uAspect, 1.0);
    float x = max(0.0, 1.0 - length(q) / d.z);
    x = 0.5 - cos(x * 3.14159265) * 0.5;
    info.r += x * d.w;
  }
  o = info;
}`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;

uniform sampler2D uState;
uniform vec2 uSimTexel;
uniform vec2 uCss;
uniform float uTime;
uniform float uSimGain;

uniform float uTile;
uniform vec3 uTileA;
uniform vec3 uTileB;
uniform vec3 uGrout;
uniform vec3 uLineCol;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform float uAbsorb;
// el agua puede ir haciéndose más honda de arriba abajo (absorción y color del fondo)
uniform float uAbsorbB;
uniform vec3 uDeepB;
uniform float uDepth;
uniform float uCaustic;
uniform float uCausticDepth;
uniform float uWave;
uniform float uWall;

uniform float uLines[6];
uniform int uLineN;
uniform float uLineW;
uniform vec2 uLineSpan;
uniform float uLineT;

uniform float uRopes[6];
uniform int uRopeN;
uniform float uRopeR;

uniform vec4 uSwim[4];
uniform vec4 uSwimB[4];  // color del gorro (rgb) y espuma (w)
uniform int uSwimN;
uniform float uSwimL;

// línea de marca (como la del récord en las transmisiones): pintada en el fondo
uniform vec4 uMark;  // x, y desde, y hasta (px CSS), intensidad
uniform vec3 uMarkCol;

// silueta difuminada del título que flota sobre el agua
uniform sampler2D uMask;
uniform float uMaskK;
uniform vec2 uMaskOff;

const vec3 SUN = vec3(-0.122, -0.207, 0.971);
${WAVE_GLSL}

float sdCap(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// brazada de crol de un brazo, vista desde arriba. u = 0..1 del ciclo:
// tracción bajo el agua (0–0.62), de la mano estirada adelante hasta el muslo
// con una S suave; recobro por fuera (0.62–1), el codo alto y la mano abierta.
// up = 1 mientras el brazo va fuera del agua.
float armSdf(vec2 q, float L, float side, float u, float narrow, out float up) {
  vec2 sh = vec2(-0.15 * L, side * 0.1 * L * narrow);
  vec2 hand;
  vec2 elbow;
  if (u < 0.62) {
    float s = u / 0.62;
    float e = s * s * (3.0 - 2.0 * s);
    hand = vec2(mix(0.46 * L, -0.44 * L, e), side * L * (0.07 - 0.04 * sin(3.14159265 * s) + 0.05 * s));
    elbow = mix(sh, hand, 0.5) + vec2(0.0, side * 0.075 * L * sin(3.14159265 * s));
    up = 0.0;
  } else {
    float s = (u - 0.62) / 0.38;
    float e = s * s * (3.0 - 2.0 * s);
    float a = sin(3.14159265 * s);
    // la mano vuelve cerca del cuerpo; el codo, alto, apunta hacia afuera
    hand = vec2(mix(-0.44 * L, 0.46 * L, e), side * L * (mix(0.12, 0.07, e) + 0.035 * a));
    elbow = mix(sh, hand, 0.5) + vec2(-0.06 * L * a, side * 0.13 * L * a);
    up = smoothstep(0.0, 0.14, s) * smoothstep(1.0, 0.86, s);
  }
  return min(sdCap(q, sh, elbow, 0.037 * L), sdCap(q, elbow, hand, 0.029 * L));
}

// nadador de crol visto desde arriba: gorro, tronco con el giro de la brazada,
// bañador, piernas con patada de seis tiempos y los dos brazos.
// a: gorro, tronco, bañador, piernas · b: brazo bajo el agua, brazo fuera, giro (-1..1)
void swimmerSdf(vec2 q, float L, float ph, out vec4 a, out vec3 b) {
  float roll = sin(ph + 0.6);
  float narrow = 1.0 - 0.2 * abs(roll);
  float head = length((q - vec2(0.0, roll * 0.012 * L)) * vec2(0.9, 1.0)) - 0.066 * L;
  float neck = sdCap(q, vec2(-0.05 * L, 0.0), vec2(-0.12 * L, 0.0), 0.038 * L);
  float sw = 0.088 * L * narrow;
  float shoulders = sdCap(q, vec2(-0.16 * L, -sw), vec2(-0.16 * L, sw), 0.052 * L);
  // la espalda se estrecha hacia la cintura
  float back = sdCap(q, vec2(-0.17 * L, 0.0), vec2(-0.4 * L, 0.0), mix(0.092, 0.064, clamp((-q.x / L - 0.17) / 0.23, 0.0, 1.0)) * L * mix(1.0, narrow, 0.6));
  float torso = min(min(neck, shoulders), back);
  float suit = sdCap(q, vec2(-0.41 * L, 0.0), vec2(-0.52 * L, 0.0), mix(0.07, 0.082, clamp((-q.x / L - 0.41) / 0.11, 0.0, 1.0)) * L);
  // piernas: muslo, pantorrilla y pie. En la patada (seis tiempos) cada pie
  // sube y baja: desde arriba la pantorrilla se acorta y se alarga
  float k = sin(ph * 3.0);
  vec2 kneeL = vec2(-0.76 * L, 0.048 * L);
  vec2 kneeR = vec2(-0.76 * L, -0.048 * L);
  vec2 ankL = vec2(-0.96 * L + k * 0.03 * L, 0.036 * L);
  vec2 ankR = vec2(-0.96 * L - k * 0.03 * L, -0.036 * L);
  float legL = min(sdCap(q, vec2(-0.53 * L, 0.05 * L), kneeL, 0.046 * L), sdCap(q, kneeL, ankL, 0.03 * L - max(0.0, -q.x - 0.78 * L) * 0.05));
  float legR = min(sdCap(q, vec2(-0.53 * L, -0.05 * L), kneeR, 0.046 * L), sdCap(q, kneeR, ankR, 0.03 * L - max(0.0, -q.x - 0.78 * L) * 0.05));
  float feet = min(length((q - ankL - vec2(-0.04 * L, 0.004 * L)) * vec2(0.6, 1.0)) - 0.022 * L,
                   length((q - ankR - vec2(-0.04 * L, -0.004 * L)) * vec2(0.6, 1.0)) - 0.022 * L);
  float upA;
  float upB;
  float armA = armSdf(q, L, 1.0, fract(ph / 6.2831853), narrow, upA);
  float armB = armSdf(q, L, -1.0, fract(ph / 6.2831853 + 0.5), narrow, upB);
  // el brazo en recobro va por encima; el otro, bajo el agua
  float under = min(mix(armA, 1e4, step(0.5, upA)), mix(armB, 1e4, step(0.5, upB)));
  float above = min(mix(1e4, armA, step(0.5, upA)), mix(1e4, armB, step(0.5, upB)));
  a = vec4(head, torso, suit, min(min(legL, legR), feet));
  b = vec3(under, above, roll);
}

// sombra del nadador en el fondo: va desenfocada, basta con su silueta gruesa
float swimmerShadow(vec2 q, float L) {
  float body = sdCap(q, vec2(0.0, 0.0), vec2(-0.55 * L, 0.0), 0.085 * L);
  float legs = sdCap(q, vec2(-0.55 * L, 0.0), vec2(-0.98 * L, 0.0), 0.05 * L);
  float arms = sdCap(q, vec2(-0.16 * L, -0.12 * L), vec2(-0.16 * L, 0.12 * L), 0.05 * L);
  return min(min(body, legs), arms);
}

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uCss;  // px CSS, y hacia abajo
  float t = uTime;

  // ---- superficie: simulación + oleaje suave
  vec2 e = uSimTexel;
  float hC = texture(uState, vUv).r;
  float hL = texture(uState, vUv - vec2(e.x, 0.0)).r;
  float hR = texture(uState, vUv + vec2(e.x, 0.0)).r;
  float hU = texture(uState, vUv + vec2(0.0, e.y)).r;
  float hD = texture(uState, vUv - vec2(0.0, e.y)).r;
  vec2 cell = uCss * uSimTexel;
  vec2 gSim = vec2((hR - hL) / (2.0 * cell.x), (hD - hU) / (2.0 * cell.y)) * uSimGain;
  vec2 gw;
  vec3 hs;
  waveField(p, t, uWave, gw, hs);
  vec2 g = gSim + gw;
  vec3 n = normalize(vec3(-g, 1.0));

  // ---- refracción: el fondo se ve desplazado por la pendiente del agua
  vec2 fp = p + g * uDepth * 0.25;

  // ---- sombra del título: en el fondo (refractada) y sobre la superficie
  float tm = 0.0;
  float ts = 0.0;
  if (uMaskK > 0.0) {
    tm = texture(uMask, (fp - uMaskOff) / uCss).r * uMaskK;
    ts = texture(uMask, (p - uMaskOff * 0.4) / uCss).r * uMaskK;
  }

  // ---- fondo: baldosas tipo gresite + líneas de carril
  vec2 tc = fp / uTile;
  vec2 ti = floor(tc);
  vec2 tf = fract(tc);
  float hv = hash(ti);

  float line = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uLineN) break;
    float dy = abs(fp.y - uLines[i]);
    float body = (1.0 - smoothstep(uLineW * 0.5 - 0.8, uLineW * 0.5 + 0.8, dy))
               * smoothstep(uLineSpan.x - 0.8, uLineSpan.x + 0.8, fp.x)
               * (1.0 - smoothstep(uLineSpan.y - 0.8, uLineSpan.y + 0.8, fp.x));
    float tb = 0.0;
    if (uLineT > 0.0) {
      float dx = min(abs(fp.x - uLineSpan.x), abs(fp.x - uLineSpan.y));
      tb = (1.0 - smoothstep(uLineW * 0.5 - 0.8, uLineW * 0.5 + 0.8, dx))
         * (1.0 - smoothstep(uLineT - 0.8, uLineT + 0.8, dy));
    }
    line = max(line, max(body, tb));
  }

  vec3 tile = mix(uTileA, uTileB, hv);
  tile = mix(tile, uLineCol * (0.85 + 0.3 * hv), line);
  tile *= 1.0 + ((tf.x - 0.5) - (tf.y - 0.5)) * 0.06;
  float aa = fwidth(tc.x) * 1.5;
  vec2 gd = min(tf, 1.0 - tf);
  float grout = 1.0 - smoothstep(0.035, 0.035 + aa + 0.015, min(gd.x, gd.y));
  vec3 floorCol = mix(tile, mix(uGrout, uLineCol * 1.7, line * 0.75), grout * 0.85);

  // ---- sombras de las corcheras sobre el fondo
  vec2 shOff = -SUN.xy / SUN.z * uDepth;
  float shadow = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uRopeN) break;
    float dy = abs(fp.y - (uRopes[i] + shOff.y));
    shadow = max(shadow, 1.0 - smoothstep(uRopeR * 0.3, uRopeR * 1.9, dy));
  }
  floorCol *= (1.0 - shadow * 0.45) * (1.0 - tm * 0.68);

  // ---- cáusticas (luz enfocada por las olas)
  vec2 e2 = e * 2.0;
  float sxx = (texture(uState, vUv - vec2(e2.x, 0.0)).r + texture(uState, vUv + vec2(e2.x, 0.0)).r - 2.0 * hC) / (4.0 * cell.x * cell.x) * uSimGain * 0.45;
  float syy = (texture(uState, vUv - vec2(0.0, e2.y)).r + texture(uState, vUv + vec2(0.0, e2.y)).r - 2.0 * hC) / (4.0 * cell.y * cell.y) * uSimGain * 0.45;
  float cd = uCausticDepth * 0.25;
  float jxx = 1.0 + cd * (hs.x + sxx);
  float jyy = 1.0 + cd * (hs.y + syy);
  float jxy = cd * hs.z;
  float det = jxx * jyy - jxy * jxy;
  float caus = min(1.0 / max(abs(det), 0.09), 6.0);
  float lit = uCaustic * (1.0 - shadow * 0.85) * (1.0 - tm * 0.9);
  floorCol *= mix(1.0, 0.68 + 0.32 * caus, lit);
  floorCol += vec3(0.6, 0.88, 1.0) * max(caus - 1.4, 0.0) * 0.11 * lit;

  // ---- absorción del agua
  float fy = clamp(p.y / uCss.y, 0.0, 1.0);
  vec3 col = mix(floorCol, mix(uDeep, uDeepB, fy), mix(uAbsorb, uAbsorbB, fy));

  // ---- línea de marca: se dibuja en el fondo, así que las olas la ondulan
  if (uMark.w > 0.0) {
    float mx = abs(fp.x - uMark.x);
    float my = smoothstep(uMark.y - 2.0, uMark.y + 2.0, fp.y) * (1.0 - smoothstep(uMark.z - 2.0, uMark.z + 2.0, fp.y));
    float core = 1.0 - smoothstep(1.4, 3.0, mx);
    float glow = exp(-mx * mx / 260.0);
    col = mix(col, uMarkCol * 1.15, core * my * uMark.w * 0.92);
    col += uMarkCol * glow * my * uMark.w * 0.32;
  }

  // ---- nadadores: sombra en el fondo, cuerpo bajo la superficie, el brazo
  // que vuelve por fuera del agua y la espuma
  float body = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uSwimN) break;
    vec4 s = uSwim[i];
    float L = uSwimL;
    vec2 q = p - s.xy;
    if (q.x > L * 0.7 || q.x < -L * 2.3 || abs(q.y) > L * 0.6) continue;

    // sombra proyectada en el fondo (difusa)
    float dsh = swimmerShadow(q - shOff * 0.85, L);
    col *= 1.0 - (1.0 - smoothstep(-8.0, 16.0, dsh)) * 0.32 * s.z;

    // cuerpo justo bajo la superficie, refractado por las olas
    vec4 d;
    vec3 da;
    swimmerSdf(q + g * 5.0, L, s.w, d, da);
    float aw = 1.4;
    float aCap = 1.0 - smoothstep(-aw, aw, d.x);
    float aTorso = 1.0 - smoothstep(-aw, aw, d.y);
    float aSuit = 1.0 - smoothstep(-aw, aw, d.z);
    float aLegs = 1.0 - smoothstep(-aw, aw, d.w);
    float aUnder = 1.0 - smoothstep(-aw * 1.6, aw * 1.6, da.x);
    float aAbove = 1.0 - smoothstep(-1.1, 1.1, da.y);
    // volumen: más claro en el centro de cada pieza y del lado que el giro deja arriba
    float lit = 1.0 + 0.16 * da.z * clamp(q.y / (0.1 * L), -1.0, 1.0);
    float rnd = smoothstep(0.0, -0.045 * L, min(d.y, d.w));
    vec3 skin = vec3(0.93, 0.62, 0.46);
    vec3 water = col;
    // cada pieza va a su hondura: el agua tiñe más las piernas y el brazo que tira
    vec3 legC = mix(skin * (0.66 + 0.3 * smoothstep(0.0, -0.03 * L, d.w)), water, 0.3);
    vec3 armC = mix(skin * (0.66 + 0.24 * smoothstep(0.0, -0.025 * L, da.x)), water, 0.36);
    vec3 torsoC = mix(skin * (0.62 + 0.42 * rnd) * lit, water, 0.14);
    vec3 suitC = mix(vec3(0.05, 0.1, 0.28) * (0.75 + 0.35 * smoothstep(0.0, -0.04 * L, d.z)) * lit, water, 0.12);
    col = mix(col, legC, aLegs * s.z);
    col = mix(col, armC, aUnder * s.z);
    col = mix(col, torsoC, aTorso * s.z);
    col = mix(col, suitC, aSuit * s.z);
    // gorro: cúpula con brillo y la tira de las gafas por detrás
    float dome = smoothstep(0.0, -0.06 * L, d.x);
    vec3 capC = uSwimB[i].rgb * (0.7 + 0.32 * dome);
    vec2 hq = q + g * 5.0;
    capC += vec3(0.35) * exp(-dot(hq - vec2(0.02 * L, 0.02 * L), hq - vec2(0.02 * L, 0.02 * L)) / (0.0006 * L * L));
    capC = mix(capC, vec3(0.04, 0.05, 0.08), (1.0 - smoothstep(0.004 * L, 0.009 * L, abs(hq.x + 0.035 * L))) * 0.85);
    col = mix(col, capC, aCap * s.z);
    // el brazo que vuelve por fuera: nítido, seco y con su sombra sobre el agua
    float dUp = da.y;
    col *= 1.0 - (1.0 - smoothstep(-2.0, 10.0, dUp + 4.0)) * 0.22 * s.z;
    col = mix(col, skin * (0.86 + 0.2 * smoothstep(0.0, -0.025 * L, dUp)), aAbove * s.z);
    body = max(body, max(max(aTorso, aSuit), max(aCap, aLegs)) * s.z);

    // espuma: ola de proa, entrada de cada mano, patada y estela en V
    float bub = noise(p * 0.3 + vec2(t * 5.0, 0.0)) * noise(p * 0.7 - vec2(t * 8.0, t * 3.0));
    float bow = exp(-pow(length((q - vec2(0.02 * L, 0.0)) * vec2(1.0, 0.8)) - 0.11 * L, 2.0) / (0.0011 * L * L)) * step(-0.05 * L, q.x);
    float splash = 0.0;
    for (int k = 0; k < 2; k++) {
      float side = k == 0 ? 1.0 : -1.0;
      float u = fract(s.w / 6.2831853 + float(k) * 0.5);
      vec2 hp = q - vec2((0.46 - u * 0.5) * L, side * 0.07 * L);
      splash += exp(-dot(hp, hp) / (0.005 * L * L)) * smoothstep(0.22, 0.0, u);
      // gotas que caen de la mano al final del recobro
      splash += exp(-dot(hp - vec2(-0.06 * L, 0.0), hp - vec2(-0.06 * L, 0.0)) / (0.004 * L * L)) * smoothstep(0.86, 1.0, u) * 0.6;
    }
    float kq = q.x + 1.0 * L;
    float kick = exp(-kq * kq / (0.012 * L * L) - q.y * q.y / (0.006 * L * L)) * (0.65 + 0.35 * abs(sin(s.w * 3.0)));
    float a = -q.x - 0.08 * L;
    float vArm = abs(abs(q.y) - a * 0.36);
    float vWake = step(0.0, a) * exp(-vArm * vArm / pow(0.018 * L + a * 0.03, 2.0)) * exp(-a / (0.9 * L)) * 0.55;
    float behind = clamp((-q.x - 1.0 * L) / (1.3 * L), 0.0, 1.0);
    float trail = step(0.0, -q.x - 1.0 * L) * (1.0 - behind) * exp(-q.y * q.y / pow(0.06 * L + behind * 0.14 * L, 2.0));
    float foam = bow * 0.5 + splash * 1.1 + kick * 1.1 + trail * 0.75 + vWake;
    col = mix(col, vec3(0.94, 0.98, 1.0), clamp(foam * (0.3 + bub * 1.9) * s.z * uSwimB[i].w, 0.0, 0.9));
  }
  // el nadador también pasa bajo la sombra del título
  col *= 1.0 - ts * 0.42 * body;

  // ---- reflejos: cielo (Fresnel) y destellos de sol
  // micro-ondas para los destellos
  vec2 mq = p * 0.13 + vec2(t * 1.7, -t * 1.3);
  vec2 micro = vec2(noise(mq) - 0.5, noise(mq + 17.3) - 0.5) * 0.4;
  vec3 ns = normalize(vec3(-g - micro, 1.0));
  vec3 H = normalize(normalize(vec3(-0.32, -0.46, 0.83)) + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(ns, H), 0.0), 2200.0) * 1.4 * (1.0 - ts);
  float fres = 0.02 + 0.98 * pow(1.0 - n.z, 5.0);
  col += uSky * fres * 1.6 + vec3(1.0, 0.98, 0.94) * spec;

  // ---- corcheras flotando
  for (int i = 0; i < 6; i++) {
    if (i >= uRopeN) break;
    float sway = sin(p.x * 0.012 + t * 1.1 + float(i) * 1.7) * 1.4 + hC * uSimGain * 0.5;
    float y = p.y - (uRopes[i] + sway);
    if (abs(y) > uRopeR * 2.4) continue;
    float segL = uRopeR * 2.5;
    float si = floor(p.x / segL);
    float lx = (fract(p.x / segL) - 0.5) * segL;

    // sombra de contacto sobre el agua
    col *= 1.0 - (1.0 - smoothstep(uRopeR * 0.7, uRopeR * 2.3, abs(y - 3.0))) * 0.32;
    // cable
    float cable = 1.0 - smoothstep(1.0, 2.0, abs(y));
    col = mix(col, vec3(0.1, 0.12, 0.18), cable * 0.85);

    float sd = sdBox(vec2(lx, y), vec2(segL * 0.44, uRopeR), uRopeR * 0.62);
    float a = 1.0 - smoothstep(-0.7, 0.7, sd);
    if (a <= 0.0) continue;

    float total = floor(uCss.x / segL);
    float edge = min(si, total - 1.0 - si);
    vec3 base;
    if (edge < 6.0) base = vec3(0.89, 0.14, 0.11);
    else base = mod(floor((si - 6.0) / 5.0), 2.0) < 1.0 ? vec3(0.95, 0.96, 1.0) : vec3(0.1, 0.35, 0.88);

    float ny = clamp(y / uRopeR, -1.0, 1.0);
    float nx = clamp(lx / (segL * 0.44), -1.0, 1.0);
    nx = sign(nx) * pow(abs(nx), 6.0) * 0.8;
    vec3 rn = normalize(vec3(nx, ny, sqrt(max(0.0, 1.0 - ny * ny))));
    float dif = 0.32 + 0.78 * max(dot(rn, SUN), 0.0);
    float rib = 0.84 + 0.16 * cos(lx / segL * 6.2831853 * 5.0);
    float sp = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), rn), SUN), 0.0), 28.0) * 0.5;
    col = mix(col, base * dif * rib + sp, a);
  }

  // ---- oclusión junto a las paredes
  vec2 ed = min(p, uCss - p);
  col *= mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 30.0, min(ed.x, ed.y))), uWall);

  o = vec4(col, 1.0);
}`;

// partículas y burbujas: se ven a través de la superficie (refractadas) y las ondas las empujan
const PART_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;  // x, y (px CSS), z (0 superficie – 1 fondo), tamaño
layout(location = 1) in vec4 aB;  // tipo (0 partícula, 1 burbuja), semilla, alfa
uniform sampler2D uState;
uniform sampler2D uMask;
uniform float uMaskK;
uniform vec2 uMaskOff;
uniform vec2 uSimTexel;
uniform vec2 uCss;
uniform float uSimGain;
uniform float uDepth;
uniform float uWave;
uniform float uTime;
uniform float uPx;
uniform float uRopes[6];
uniform int uRopeN;
uniform float uRopeR;
out float vKind;
out float vA;
out vec3 vCol;
${WAVE_GLSL}
void main() {
  vec2 p = aA.xy;
  float z = aA.z;
  vec2 uv = vec2(p.x / uCss.x, 1.0 - p.y / uCss.y);
  vec2 e = uSimTexel;
  float hL = textureLod(uState, uv - vec2(e.x, 0.0), 0.0).r;
  float hR = textureLod(uState, uv + vec2(e.x, 0.0), 0.0).r;
  float hU = textureLod(uState, uv + vec2(0.0, e.y), 0.0).r;
  float hD = textureLod(uState, uv - vec2(0.0, e.y), 0.0).r;
  vec2 cell = uCss * uSimTexel;
  vec2 gSim = vec2((hR - hL) / (2.0 * cell.x), (hD - hU) / (2.0 * cell.y)) * uSimGain;
  vec2 gw;
  vec3 hs;
  waveField(p, uTime, uWave, gw, hs);
  vec2 q = p + (gSim + gw) * uDepth * 0.25 * z + gSim * 22.0 * (1.0 - z);
  gl_Position = vec4(q.x / uCss.x * 2.0 - 1.0, 1.0 - q.y / uCss.y * 2.0, 0.0, 1.0);

  float kind = aB.x;
  float seed = aB.y;
  float a = aB.z * mix(1.0, 0.55, z);
  float size = aA.w * mix(1.25, 0.75, z);
  if (kind < 0.5) {
    // destello ocasional: la partícula atrapa un rayo de sol
    float tw = pow(0.5 + 0.5 * sin(uTime * (0.9 + seed * 2.3) + seed * 61.0), 24.0);
    a += tw * 0.55;
    size += tw * 1.4;
  }
  for (int i = 0; i < 6; i++) {
    if (i >= uRopeN) break;
    a *= smoothstep(uRopeR * 0.8, uRopeR * 1.5, abs(q.y - uRopes[i]));
  }
  if (uMaskK > 0.0) a *= 1.0 - textureLod(uMask, (q - uMaskOff * mix(0.4, 1.0, z)) / uCss, 0.0).r * uMaskK * 0.6;
  // por debajo de 2 px se dibuja a 2 px pero más tenue (sin parpadeo de píxeles)
  float px = size * uPx;
  vKind = kind;
  vA = a * min(1.0, px / 2.0);
  vCol = mix(vec3(0.94, 0.99, 1.0), vec3(0.62, 0.84, 1.0), z * 0.6);
  gl_PointSize = max(px, 2.0);
}`;

const PART_FS = `#version 300 es
precision highp float;
in float vKind;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float a;
  if (vKind > 0.5) {
    // burbuja: borde brillante, centro transparente y reflejo arriba a la izquierda
    vec2 h = c - vec2(-0.32, -0.36);
    a = smoothstep(0.5, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) * 0.75 + (1.0 - r) * 0.08 + exp(-dot(h, h) * 30.0);
  } else {
    // núcleo brillante con un halo suave
    a = (1.0 - smoothstep(0.2, 0.6, r)) * 0.8 + (1.0 - smoothstep(0.3, 1.0, r)) * 0.4;
  }
  a = clamp(a * vA, 0.0, 1.0);
  o = vec4(vCol * a, a);
}`;

const CAP_RED = [0.9, 0.13, 0.1];

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

const WATER_DEFAULTS = {
  quality: lowPower ? .55 : .8,
  cell: 5,
  tile: 22,
  tileA: '#2a84e6', tileB: '#3390ee', grout: '#cdeeff', line: '#0a1d4f',
  deep: '#0a4bbd', sky: '#e8f7ff',
  absorb: .3, depth: 90, caustic: 1, causticDepth: 300, wave: 1, simGain: 4, wall: 1, ropeR: 8,
  rain: 0,
  markCol: '#ffd23a',
  motes: 0,       // partículas suspendidas por cada 100.000 px²
  bubbles: 0,     // burbujas simultáneas como máximo
  bubbleRate: 0,  // burbujas que suben del fondo por segundo
  layout: null,
};

// corriente lenta del agua (px/s): remolinos suaves que arrastran las partículas
const currentX = (x, y, z, t) => 7 * Math.sin(y * 0.0042 + t * 0.21 + z * 2.1) + 4 * Math.sin((x + y) * 0.0021 - t * 0.13) + 2.5;
const currentY = (x, y, z, t) => 6 * Math.cos(x * 0.0037 - t * 0.17 + z * 3.3) + 3 * Math.cos((x - y) * 0.0027 + t * 0.11);

const MOTE = 8;    // x, y, z, vx, vy, tamaño, semilla, alfa
const BUBBLE = 9;  // x, y, z, vx, vy, subida, tamaño, semilla, edad · z < 0 = libre

class Particles {
  constructor(water) {
    const gl = water.gl;
    this.water = water;
    this.gl = gl;
    this.density = water.o.motes;
    this.rate = water.o.bubbleRate;
    this.nb = water.o.bubbles;
    this.b = new Float32Array(this.nb * BUBBLE).fill(-1);
    this.nm = 0;
    this.m = new Float32Array(0);
    this.acc = 0;
    this.p = null;  // el programa se compila en water.warm()
    this.ok = true;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
  }

  seedMote(i, W, H) {
    const m = this.m;
    const o = i * MOTE;
    m[o] = Math.random() * W;
    m[o + 1] = Math.random() * H;
    m[o + 2] = 0.08 + Math.random() * 0.92;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = 2.6 + Math.random() ** 2.5 * 7;
    m[o + 6] = Math.random();
    m[o + 7] = 0.3 + Math.random() * 0.45;
  }

  resize(W, H, prevW, prevH) {
    const n = Math.min(1400, Math.round((W * H) / 1e5 * this.density));
    const old = this.m;
    const kept = Math.min(n, this.nm);
    this.m = new Float32Array(n * MOTE);
    this.m.set(old.subarray(0, kept * MOTE));
    for (let i = 0; i < kept; i++) {
      this.m[i * MOTE] *= W / prevW;
      this.m[i * MOTE + 1] *= H / prevH;
    }
    for (let i = kept; i < n; i++) this.seedMote(i, W, H);
    this.nm = n;
    const gl = this.gl;
    this.data = new Float32Array((this.nm + this.nb) * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  bubble(x, y, z, vx, vy, rise, size) {
    const b = this.b;
    for (let i = 0; i < this.nb; i++) {
      const o = i * BUBBLE;
      if (b[o + 2] >= 0) continue;
      b[o] = x; b[o + 1] = y; b[o + 2] = z;
      b[o + 3] = vx; b[o + 4] = vy;
      b[o + 5] = rise; b[o + 6] = size;
      b[o + 7] = Math.random(); b[o + 8] = 0;
      return;
    }
  }

  // aire que entra con la mano o con un golpe: burbujas que salen hacia afuera
  burst(x, y, n, r) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const sp = 20 + Math.random() * 50;
      this.bubble(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.15 + Math.random() * 0.4,
        Math.cos(a) * sp, Math.sin(a) * sp, 0.45 + Math.random() * 0.5, 2.5 + Math.random() * 5);
    }
  }

  // el cursor arrastra el agua: las partículas lo siguen y se abren en remolinos a los lados
  stir(x, y, vx, vy) {
    const sp = Math.hypot(vx, vy);
    if (sp < 1) return;
    const cap = Math.min(1, 900 / sp);
    vx *= cap;
    vy *= cap;
    const R = 110;
    const m = this.m;
    for (let i = 0; i < this.nm; i++) {
      const o = i * MOTE;
      const dx = m[o] - x;
      const dy = m[o + 1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const f = (1 - Math.sqrt(d2) / R) ** 2 * (1 - m[o + 2] * 0.6);
      const side = Math.sign(vx * dy - vy * dx) || 1;
      m[o + 3] += (vx - m[o + 3]) * f * 0.3 - vy * side * f * 0.1;
      m[o + 4] += (vy - m[o + 4]) * f * 0.3 + vx * side * f * 0.1;
    }
  }

  update(t, dt, swimmers) {
    const W = this.water.cssW;
    const H = this.water.cssH;
    const L = this.water.layout.swimL || 150;
    const m = this.m;
    const b = this.b;
    const relax = 1 - Math.exp(-dt * 1.4);
    const pull = 1 - Math.exp(-dt * 5);

    for (let i = 0; i < this.nm; i++) {
      const o = i * MOTE;
      let x = m[o];
      let y = m[o + 1];
      const z = m[o + 2];
      m[o + 3] += (currentX(x, y, z, t) - m[o + 3]) * relax;
      m[o + 4] += (currentY(x, y, z, t) - m[o + 4]) * relax;
      // los nadadores arrastran el agua a su paso
      for (const s of swimmers) {
        if (!(s.foam > 0) || !s.moving) continue;
        const dx = x - s.x;
        const dy = y - s.y;
        if (dx > 0.4 * L || dx < -1.3 * L || Math.abs(dy) > 0.45 * L) continue;
        const f = (1 - Math.abs(dy) / (0.45 * L)) * (1 - z * 0.5) * s.foam;
        m[o + 3] += (s.speed * 0.55 - m[o + 3]) * f * pull;
        m[o + 4] += Math.sign(dy) * f * 160 * pull;
      }
      x += m[o + 3] * dt;
      y += m[o + 4] * dt;
      if (x < -20) x += W + 40; else if (x > W + 20) x -= W + 40;
      if (y < -20) y += H + 40; else if (y > H + 20) y -= H + 40;
      m[o] = x;
      m[o + 1] = y;
    }

    // burbujas: exhalación junto a la cabeza y en la patada de cada nadador
    for (const s of swimmers) {
      if (!(s.foam > 0) || !s.moving) continue;
      s.bub = (s.bub || 0) + dt;
      while (s.bub > 0.07) {
        s.bub -= 0.07;
        const head = Math.random() < 0.55;
        const r = (Math.random() - 0.5) * 0.12 * L;
        this.bubble(s.x + (head ? 0.1 : -0.95) * L, s.y + r, 0.05 + Math.random() * 0.18,
          (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.5 + Math.random() * 0.5,
          (head ? 2 : 1.5) + Math.random() * 2);
      }
    }

    // burbujas que suben del fondo, a veces en grupo
    this.acc += dt * this.rate;
    while (this.acc >= 1) {
      this.acc -= 1;
      const x = Math.random() * W;
      const y = Math.random() * H;
      const n = Math.random() < 0.3 ? 2 + ((Math.random() * 3) | 0) : 1;
      for (let k = 0; k < n; k++) {
        this.bubble(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16, 0.7 + Math.random() * 0.3,
          0, 0, 0.11 + Math.random() * 0.14, 3.5 + Math.random() * 5);
      }
    }

    for (let i = 0; i < this.nb; i++) {
      const o = i * BUBBLE;
      if (b[o + 2] < 0) continue;
      const age = (b[o + 8] += dt);
      const damp = 1 - Math.min(1, dt * 2.5);
      b[o + 3] *= damp;
      b[o + 4] *= damp;
      b[o] += (b[o + 3] + Math.sin(age * 8 + b[o + 7] * 40) * 10 + currentX(b[o], b[o + 1], b[o + 2], t) * 0.5) * dt;
      b[o + 1] += (b[o + 4] + Math.cos(age * 7 + b[o + 7] * 23) * 6) * dt;
      b[o + 2] -= b[o + 5] * dt;
      // al llegar a la superficie revienta y deja una onda pequeña
      if (b[o + 2] <= 0) {
        this.water.drop(b[o], b[o + 1], 5 + b[o + 6] * 1.1, 0.03 + b[o + 6] * 0.008);
        b[o + 2] = -1;
      }
    }
  }

  draw(t) {
    const gl = this.gl;
    const d = this.data;
    const m = this.m;
    const b = this.b;
    let n = 0;
    for (let i = 0; i < this.nm; i++, n++) {
      const o = i * MOTE;
      const k = n * 8;
      d[k] = m[o]; d[k + 1] = m[o + 1]; d[k + 2] = m[o + 2]; d[k + 3] = m[o + 5];
      d[k + 4] = 0; d[k + 5] = m[o + 6]; d[k + 6] = m[o + 7]; d[k + 7] = 0;
    }
    for (let i = 0; i < this.nb; i++) {
      const o = i * BUBBLE;
      if (b[o + 2] < 0) continue;
      const k = n * 8;
      d[k] = b[o]; d[k + 1] = b[o + 1]; d[k + 2] = b[o + 2];
      d[k + 3] = b[o + 6] * (1 + (1 - b[o + 2]) * 0.5);
      d[k + 4] = 1; d[k + 5] = b[o + 7]; d[k + 6] = Math.min(1, b[o + 8] * 4) * 0.9; d[k + 7] = 0;
      n++;
    }
    if (!n) return;
    const p = this.p;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 8);
    gl.useProgram(p.p);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(p.u('uTime'), t);
    gl.uniform1f(p.u('uMaskK'), this.water.maskK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
  }
}

class PoolWater {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.o = Object.assign({}, WATER_DEFAULTS, opts);
    this.drops = [];
    this.swimmers = [];
    this.layout = { lines: [], ropes: [], span: [-1e4, 1e4], lineW: 20, lineT: 0 };
    this.visible = false;
    this.dtAvg = 1 / 60;
    this.simW = 0;
    this.simH = 0;
    this.hasMask = false;
    this.maskK = 0;
    this.maskT0 = 0;
    this.maskDur = 0;
    this.mark = null;
    this.onFrame = null;
    this.ok = false;
    try { this.ok = this.init(); } catch (err) { console.warn('[agua]', err); this.ok = false; }
  }

  // compilar el shader del agua tarda más de un segundo en gráficas integradas.
  // Con KHR_parallel_shader_compile se compila en segundo plano (la página no se
  // congela) y el estado se consulta en ready(); sin la extensión, se espera aquí.
  program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!this.par && !gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!this.par && !gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return null; }
    const cache = {};
    const pr = { p, u: (name) => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(p, name))) };
    this.pending.push(pr);
    return pr;
  }

  // compila los shaders (una sola vez)
  warm() {
    if (this.warmed) return;
    this.warmed = true;
    this.pUpdate = this.program(SIM_VS, SIM_UPDATE);
    this.pDrop = this.program(SIM_VS, SIM_DROP);
    this.pRender = this.program(SIM_VS, RENDER_FS);
    if (this.fx) {
      this.fx.p = this.program(PART_VS, PART_FS);
      if (!this.fx.p) this.fx = null;
    }
    if (!this.pUpdate || !this.pDrop || !this.pRender) this.failed = true;
  }

  // ¿terminaron de compilar los shaders? (no bloquea mientras siguen en curso)
  ready() {
    if (this.live) return true;
    if (this.failed || !this.warmed) return false;
    const gl = this.gl;
    if (this.par && this.pending.some((pr) => !gl.getProgramParameter(pr.p, this.par.COMPLETION_STATUS_KHR))) return false;
    if (this.pending.some((pr) => !gl.getProgramParameter(pr.p, gl.LINK_STATUS))) {
      this.pending.forEach((pr) => console.warn('[agua]', gl.getProgramInfoLog(pr.p)));
      this.failed = true;
      return false;
    }
    this.live = true;
    this.applyStatic();
    this.canvas.classList.add('is-live');
    return true;
  }

  init() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return false;
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    this.par = gl.getExtension('KHR_parallel_shader_compile');
    this.pending = [];
    this.live = false;
    this.failed = false;
    this.warmed = false;

    // los shaders se compilan en warm(): cuando el agua se va a ver, o en cola

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // máscara del título (vacía hasta que se dibuja)
    this.maskTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);

    if (this.o.motes || this.o.bubbles) {
      const fx = new Particles(this);
      if (fx.ok) this.fx = fx;
    }

    this.resize();
    if (!this.simOk) return false;
    return true;
  }

  makeTargets(w, h) {
    const gl = this.gl;
    (this.targets || []).forEach((tg) => { gl.deleteTexture(tg.tex); gl.deleteFramebuffer(tg.fb); });
    this.targets = [0, 1].map(() => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    this.simOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 0;
    this.simW = w;
    this.simH = h;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const prevW = this.cssW || r.width;
    const prevH = this.cssH || r.height;
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    const q = this.o.quality * Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(this.cssW * q);
    const ch = Math.round(this.cssH * q);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const sw = clamp(Math.round(this.cssW / this.o.cell), 16, 512);
    const sh = clamp(Math.round(this.cssH / this.o.cell), 16, 512);
    if (sw !== this.simW || sh !== this.simH) this.makeTargets(sw, sh);
    if (this.o.layout) this.layout = this.o.layout(this.cssW, this.cssH);
    if (this.fx) this.fx.resize(this.cssW, this.cssH, Math.max(1, prevW), Math.max(1, prevH));
    if (this.live) this.applyStatic();
  }

  applyStatic() {
    const gl = this.gl;
    const o = this.o;
    const L = this.layout;
    const pr = this.pRender;
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u('uCss'), this.cssW, this.cssH);
    gl.uniform2f(pr.u('uSimTexel'), 1 / this.simW, 1 / this.simH);
    gl.uniform1f(pr.u('uSimGain'), o.simGain);
    gl.uniform1f(pr.u('uTile'), o.tile);
    gl.uniform3fv(pr.u('uTileA'), hex(o.tileA));
    gl.uniform3fv(pr.u('uTileB'), hex(o.tileB));
    gl.uniform3fv(pr.u('uGrout'), hex(o.grout));
    gl.uniform3fv(pr.u('uLineCol'), hex(o.line));
    gl.uniform3fv(pr.u('uDeep'), hex(o.deep));
    gl.uniform3fv(pr.u('uSky'), hex(o.sky));
    gl.uniform1f(pr.u('uAbsorb'), o.absorb);
    gl.uniform1f(pr.u('uAbsorbB'), o.absorbB != null ? o.absorbB : o.absorb);
    gl.uniform3fv(pr.u('uDeepB'), hex(o.deepB || o.deep));
    gl.uniform1f(pr.u('uDepth'), o.depth);
    gl.uniform1f(pr.u('uCaustic'), o.caustic);
    gl.uniform1f(pr.u('uCausticDepth'), o.causticDepth);
    gl.uniform1f(pr.u('uWave'), o.wave);
    gl.uniform1f(pr.u('uWall'), o.wall);
    gl.uniform3fv(pr.u('uMarkCol'), hex(o.markCol));

    const lines = new Float32Array(6);
    lines.set(L.lines.slice(0, 6));
    gl.uniform1fv(pr.u('uLines'), lines);
    gl.uniform1i(pr.u('uLineN'), Math.min(6, L.lines.length));
    gl.uniform1f(pr.u('uLineW'), L.lineW);
    gl.uniform2f(pr.u('uLineSpan'), L.span[0], L.span[1]);
    gl.uniform1f(pr.u('uLineT'), L.lineT);

    const ropes = new Float32Array(6);
    ropes.set(L.ropes.slice(0, 6));
    gl.uniform1fv(pr.u('uRopes'), ropes);
    gl.uniform1i(pr.u('uRopeN'), Math.min(6, L.ropes.length));
    gl.uniform1f(pr.u('uRopeR'), o.ropeR);
    gl.uniform1f(pr.u('uSwimL'), L.swimL || 150);

    // la sombra del título cae más lejos que la de las corcheras: flota sobre el agua
    const maskOff = [0.1256 * o.depth * 1.8, 0.2132 * o.depth * 1.8];
    gl.uniform1i(pr.u('uState'), 0);
    gl.uniform1i(pr.u('uMask'), 1);
    gl.uniform2fv(pr.u('uMaskOff'), maskOff);

    this.ropeUv = new Float32Array(6);
    this.ropeUv.set(L.ropes.slice(0, 6).map((y) => 1 - y / this.cssH));

    if (this.fx) {
      const pp = this.fx.p;
      gl.useProgram(pp.p);
      gl.uniform1i(pp.u('uState'), 0);
      gl.uniform1i(pp.u('uMask'), 1);
      gl.uniform2fv(pp.u('uMaskOff'), maskOff);
      gl.uniform2f(pp.u('uCss'), this.cssW, this.cssH);
      gl.uniform2f(pp.u('uSimTexel'), 1 / this.simW, 1 / this.simH);
      gl.uniform1f(pp.u('uSimGain'), o.simGain);
      gl.uniform1f(pp.u('uDepth'), o.depth);
      gl.uniform1f(pp.u('uWave'), o.wave);
      gl.uniform1f(pp.u('uPx'), this.canvas.width / this.cssW);
      gl.uniform1fv(pp.u('uRopes'), ropes);
      gl.uniform1i(pp.u('uRopeN'), Math.min(6, L.ropes.length));
      gl.uniform1f(pp.u('uRopeR'), o.ropeR);
    }
  }

  // silueta del título (lienzo 2D) para su sombra en el fondo
  setMask(src) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, src);
    gl.activeTexture(gl.TEXTURE0);
    this.hasMask = true;
  }

  showMask(delay, dur) {
    this.maskT0 = now() + delay;
    this.maskDur = dur;
  }

  stir(x, y, vx, vy) {
    if (this.fx) this.fx.stir(x, y, vx, vy);
  }

  burst(x, y, n, r) {
    if (this.fx) this.fx.burst(x, y, n, r);
  }

  drop(x, y, r, strength) {
    if (!this.ok) return;
    this.drops.push([x / this.cssW, 1 - y / this.cssH, r / this.cssH, strength]);
    if (this.drops.length > 64) this.drops.splice(0, this.drops.length - 64);
  }

  pass(pr, setup) {
    const gl = this.gl;
    const src = this.targets[this.cur];
    const dst = this.targets[1 - this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, this.simW, this.simH);
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(pr.u('uState'), 0);
    setup(pr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
  }

  updateSwimmers(t) {
    const L = this.layout.swimL || 150;
    this.swimmers = this.swimmers.filter((s) => {
      const el = t - s.t0;
      const k = el / s.dur;
      if (k < 0) return true;
      if (k >= 1) {
        // toca la pared: se queda un momento (hold) mientras el agua se calma
        if (!s.touched) {
          s.touched = true;
          s.x = s.x1;
          if (s.onTouch) s.onTouch(s);
        }
        const h = s.hold ? (el - s.dur) / s.hold : 1;
        if (h >= 1) { if (s.onEnd) s.onEnd(); return false; }
        s.moving = false;
        s.wake = Math.max(0, s.wake - 0.04);
        s.foam = Math.min(1, (1 - h) * 3) * s.str;
        return true;
      }
      s.moving = true;
      // cada brazada empuja: el avance late un poco con la tracción de cada mano
      const base = s.x0 + (s.x1 - s.x0) * (s.profile ? s.profile(k) : k);
      s.phase = el * s.freq * Math.PI * 2;
      const surge = Math.sin(s.phase * 2 - 1.2) * 0.012 * L * Math.min(1, k * 8, (1 - k) * 8);
      s.x = base + Math.sign(s.x1 - s.x0) * surge;
      // el empuje sobre el agua no depende de cuántos cuadros por segundo haya
      const f = clamp((t - (s.lastT || t - 1 / 60)) * 60, 0.25, 3);
      s.lastT = t;
      // entrada de cada mano en el agua
      for (let a = 0; a < 2; a++) {
        const n = Math.floor((s.phase + a * Math.PI) / (Math.PI * 2));
        if (n !== s.entry[a]) {
          s.entry[a] = n;
          this.drop(s.x + 0.44 * L, s.y + (a ? -1 : 1) * 0.07 * L, 0.09 * L, 1.1 * s.str);
        }
      }
      this.drop(s.x + 0.05 * L, s.y, 0.11 * L, 0.3 * s.str * f);
      // patada de seis tiempos: tres golpes por brazada, alternando los pies
      const kick = Math.sin(s.phase * 3) > 0 ? 1 : -1;
      this.drop(s.x - 0.98 * L, s.y + kick * 0.035 * L, 0.07 * L, -0.35 * s.str * f);
      const fin = s.hold ? 1 : Math.min(1, (1 - k) * 12);
      s.foam = Math.min(1, s.fadeIn ? el / s.fadeIn : k * 12) * fin * s.str;
      s.wake = 1;
      return true;
    });
  }

  // nada de x0 a x1. Opcional: dur (s) en vez de speed, profile(k) → avance 0..1,
  // cap (color del gorro), fadeIn (s), hold (s quieto en la pared), onTouch, onEnd
  swim({ y, x0, x1, speed = 440, dur, str = 1, profile, cap, fadeIn, hold = 0, onTouch, onEnd }) {
    const L = this.layout.swimL || 150;
    if (x0 === undefined) x0 = -L * 2.2;
    if (x1 === undefined) x1 = this.cssW + L;
    if (dur) speed = Math.abs(x1 - x0) / dur;
    const s = {
      y, x0, x1, x: x0, t0: now(), dur: Math.abs(x1 - x0) / speed, speed: Math.sign(x1 - x0) * speed,
      freq: speed / (1.65 * L), phase: 0, entry: [-1, -1], foam: 0, wake: 1, moving: false, str,
      profile, cap: cap ? hex(cap) : CAP_RED, fadeIn, hold, onTouch, onEnd,
    };
    this.swimmers.push(s);
    return s;
  }

  step(dt) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    while (this.drops.length) {
      const batch = this.drops.splice(0, 8);
      const arr = this.dropBuf || (this.dropBuf = new Float32Array(32));
      batch.forEach((d, i) => arr.set(d, i * 4));
      this.pass(this.pDrop, (pr) => {
        gl.uniform4fv(pr.u('uDrops'), arr);
        gl.uniform1i(pr.u('uDropN'), batch.length);
        gl.uniform1f(pr.u('uAspect'), this.cssW / this.cssH);
      });
    }
    // un número entero y estable de pasos por cuadro (según el ritmo medio de la
    // pantalla): las ondas avanzan parejas, sin alternar 1-2-1-2 pasos
    this.dtAvg += (dt - this.dtAvg) * 0.08;
    const steps = clamp(Math.round(this.dtAvg * SIM_HZ), 1, 4);
    for (let i = 0; i < steps; i++) {
      this.pass(this.pUpdate, (pr) => {
        gl.uniform2f(pr.u('uTexel'), 1 / this.simW, 1 / this.simH);
        gl.uniform1fv(pr.u('uRopes'), this.ropeUv);
        gl.uniform1i(pr.u('uRopeN'), Math.min(6, this.layout.ropes.length));
        gl.uniform1f(pr.u('uRopeBand'), (this.o.ropeR * 1.4) / this.cssH);
        gl.uniform1f(pr.u('uC'), 1.4);
        gl.uniform2f(pr.u('uDamp'), 0.99475, 0.99887);
        gl.uniform1f(pr.u('uRopeAbs'), 0.1226);
      });
    }
  }

  render(t) {
    const gl = this.gl;
    const pr = this.pRender;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[this.cur].tex);
    let mk = 0;
    if (this.hasMask) mk = this.maskDur > 0 ? clamp((t - this.maskT0) / this.maskDur, 0, 1) : 1;
    this.maskK = mk * mk * (3 - 2 * mk);
    gl.uniform1f(pr.u('uMaskK'), this.maskK);
    gl.uniform1f(pr.u('uTime'), t);
    // búferes reutilizados: nada de basura nueva en cada cuadro
    const sw = this.swBuf || (this.swBuf = new Float32Array(16));
    const sb = this.sbBuf || (this.sbBuf = new Float32Array(16));
    sw.fill(0);
    sb.fill(0);
    const active = this.swimmers.filter((s) => s.foam > 0).slice(0, 4);
    active.forEach((s, i) => {
      sw.set([s.x, s.y, s.foam, s.phase], i * 4);
      sb.set([s.cap[0], s.cap[1], s.cap[2], s.wake], i * 4);
    });
    gl.uniform4fv(pr.u('uSwim'), sw);
    gl.uniform4fv(pr.u('uSwimB'), sb);
    const m = this.mark;
    gl.uniform4f(pr.u('uMark'), m ? m[0] : 0, m ? m[1] : 0, m ? m[2] : 0, m ? m[3] : 0);
    gl.uniform1i(pr.u('uSwimN'), active.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  frame(t, dt) {
    if (!this.ready()) { this.warm(); return; }
    if (!reduceMotion) {
      if (this.o.rain && Math.random() < dt * this.o.rain) {
        this.drop(Math.random() * this.cssW, Math.random() * this.cssH, 10 + Math.random() * 8, 0.04 + Math.random() * 0.06);
      }
      this.updateSwimmers(t);
      if (this.fx) this.fx.update(t, dt, this.swimmers);
      this.step(dt);
    }
    this.render(t);
    if (this.fx) this.fx.draw(t);
    if (this.onFrame) this.onFrame(t, dt);
  }

  // línea de marca en el fondo: x, y desde, y hasta (px CSS) e intensidad 0..1 (null la quita)
  setMark(x, y0, y1, a = 1) {
    this.mark = a > 0 ? [x, y0, y1, a] : null;
  }
}

/* ---- respaldo: cáusticas procedurales en WebGL1 ---- */
const FB_VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
const FB_FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uLight;
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0; vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; vec2 st = vec2(uv.x * uRes.x / uRes.y, uv.y);
  float t = uTime * 0.38;
  float c = caustic(st * 1.4, t + 23.0) * 0.75 + caustic(st * 2.2 + 3.1, t * 1.15 + 11.0) * 0.4;
  vec3 col = mix(uDeep, uMid, uv.y * 0.85 + 0.15) + uLight * c * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

class ProceduralWater {
  constructor(canvas, o) {
    this.canvas = canvas;
    this.o = o;
    this.visible = false;
    this.swimmers = [];
    const gl = canvas.getContext('webgl');
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, FB_VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FB_FRAG));
    gl.linkProgram(p);
    gl.useProgram(p);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = (n) => gl.getUniformLocation(p, n);
    gl.uniform3fv(this.u('uDeep'), hex(o.deep));
    gl.uniform3fv(this.u('uMid'), hex(o.tileB));
    gl.uniform3fv(this.u('uLight'), hex(o.sky));
    this.resize();
    canvas.classList.add('is-live');
  }
  resize() {
    if (!this.ok) return;
    const r = this.canvas.getBoundingClientRect();
    this.cssW = r.width; this.cssH = r.height;
    this.canvas.width = Math.round(r.width * .6);
    this.canvas.height = Math.round(r.height * .6);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height);
  }
  drop() {}
  swim() {}
  stir() {}
  burst() {}
  setMask() {}
  showMask() {}
  setMark() {}
  frame(t) {
    if (!this.ok) return;
    this.gl.uniform1f(this.u('uTime'), t);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
}

const createWater = (canvas, opts) => {
  if (!canvas) return null;
  const w = new PoolWater(canvas, opts);
  if (w.ok) return w;
  // el contexto webgl2 fallido "ocupa" el canvas: usamos uno nuevo
  const fresh = canvas.cloneNode(false);
  canvas.replaceWith(fresh);
  const fb = new ProceduralWater(fresh, Object.assign({}, WATER_DEFAULTS, opts));
  fb.fallback = true;
  return fb.ok ? fb : null;
};

/* ---------------------------------------------------------
   Registro: cada piscina se anima solo mientras se ve
   --------------------------------------------------------- */
const waters = [];
let waterIO = null;
let waterLoop = false;

// compilar varias piscinas a la vez satura la gráfica y congela la página:
// se compilan de a una (la visible primero, vía frame) y el resto en cola
let warmT = 0;
const warmQueue = () => {
  clearTimeout(warmT);
  if (!waters.some((w) => w.warm && !w.warmed)) return;
  warmT = setTimeout(() => {
    const busy = waters.some((w) => w.warmed && !w.failed && !w.ready());
    const next = waters.find((w) => w.warm && !w.warmed);
    if (!busy && next) next.warm();
    warmQueue();
  }, 700);
};

const registerWater = (w) => {
  if (!w) return null;
  waters.push(w);
  if ('IntersectionObserver' in window) {
    waterIO = waterIO || new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const x = waters.find((v) => v.canvas === e.target);
        if (x) x.visible = e.isIntersecting;
      });
    }, { rootMargin: '120px' });
    waterIO.observe(w.canvas);
  } else {
    w.visible = true;
  }
  warmQueue();
  if (reduceMotion) {
    // un solo cuadro quieto, en cuanto los shaders estén listos
    const still = () => {
      if (w.warm) w.warm();
      if (!w.ready || w.ready()) w.frame(12, 0);
      else if (!w.failed) setTimeout(still, 150);
    };
    still();
  } else if (!waterLoop) {
    waterLoop = true;
    let last = performance.now();
    const loop = (ms) => {
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      const t = (ms - t0) / 1000;
      for (const v of waters) if (v.visible) v.frame(t, dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return w;
};

// ondas con el cursor o el dedo: una estela continua que además arrastra las partículas
const attachRipples = (zone, water, { move = .35, moveR = 18, tap = 1.6, tapR = 30 } = {}) => {
  if (!zone || !water || water.fallback || reduceMotion) return;
  let lx = 0, ly = 0, lt = 0, live = false;
  const local = (e) => {
    const r = water.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  zone.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    const t = e.timeStamp / 1000;
    if (!live || t - lt > .25) { lx = x; ly = y; lt = t; live = true; return; }
    const d = Math.hypot(x - lx, y - ly);
    if (d < 4) return;
    const dt = Math.max(t - lt, 1 / 240);
    water.stir(x, y, (x - lx) / dt, (y - ly) / dt);
    // gotas cada ~8 px a lo largo del recorrido: estela continua, no un collar de ondas
    const n = Math.min(12, Math.ceil(d / 8));
    const s = move * clamp(d / dt / 900, .3, 1) * (d / n) / 14;
    for (let i = 1; i <= n; i++) water.drop(lx + (x - lx) * i / n, ly + (y - ly) * i / n, moveR, s);
    lx = x; ly = y; lt = t;
  }, { passive: true });
  zone.addEventListener('pointerleave', () => { live = false; }, { passive: true });
  zone.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    water.drop(x, y, tapR, tap);
    water.burst(x, y, 14, tapR * .7);
  }, { passive: true });
};

/* ---------------------------------------------------------
   Sombra de un título que flota sobre el agua: su silueta
   (lienzo 2D, solo texto y trazos) cae refractada en el fondo
   --------------------------------------------------------- */
// boxes: otros elementos que también flotan (una foto, una tarjeta) y proyectan
// su sombra como un rectángulo redondeado
const titleShadow = (titleEl, water, { boxes = [] } = {}) => {
  if (!titleEl || !water || water.fallback) return () => {};
  const mask = document.createElement('canvas');
  return () => {
    const S = .5;
    const box = water.canvas.getBoundingClientRect();
    mask.width = Math.max(1, Math.round(box.width * S));
    mask.height = Math.max(1, Math.round(box.height * S));
    const ctx = mask.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.filter = 'blur(4px)';
    ctx.fillStyle = '#fff';
    // cada palabra se dibuja donde está en la página, ajustada a su ancho real
    const range = document.createRange();
    const walker = document.createTreeWalker(titleEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim().toUpperCase();
      if (!text) continue;
      const cs = getComputedStyle(node.parentElement);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ('fontStretch' in ctx) ctx.fontStretch = parseFloat(cs.fontStretch) > 100 ? 'expanded' : 'extra-condensed';
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      const m = ctx.measureText(text);
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      const asc = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * .88;
      ctx.setTransform(S * (m.width ? r.width / m.width : 1), 0, 0, S, (r.left - box.left) * S, (r.top - box.top + asc) * S);
      ctx.fillText(text, 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // el + del logo como dos trazos de pincel: dibujar la imagen "ensuciaría" el lienzo
    // al abrir el sitio desde file:// y WebGL lo rechazaría
    const plus = $('.ser__plus', titleEl);
    if (plus) {
      const r = plus.getBoundingClientRect();
      const x = (r.left - box.left) * S;
      const y = (r.top - box.top) * S;
      const w = r.width * S;
      const h = r.height * S;
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineWidth = w * .19;
      ctx.beginPath();
      ctx.moveTo(x + w * .55, y + h * .1);
      ctx.lineTo(x + w * .37, y + h * .9);
      ctx.moveTo(x + w * .08, y + h * .44);
      ctx.lineTo(x + w * .92, y + h * .4);
      ctx.stroke();
    }
    boxes.forEach((el) => {
      if (!el || !el.offsetWidth) return;
      const r = el.getBoundingClientRect();
      const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const x = (r.left - box.left) * S;
      const y = (r.top - box.top) * S;
      const w = r.width * S;
      const h = r.height * S;
      const k = Math.min(rad * S, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + k, y);
      ctx.arcTo(x + w, y, x + w, y + h, k);
      ctx.arcTo(x + w, y + h, x, y + h, k);
      ctx.arcTo(x, y + h, x, y, k);
      ctx.arcTo(x, y, x + w, y, k);
      ctx.closePath();
      ctx.fill();
    });
    try {
      water.setMask(mask);
    } catch (err) {
      console.warn('[agua] sombra del título', err);
      return;
    }
    if (reduceMotion) water.frame(12, 0);
  };
};
