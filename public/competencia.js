/* =========================================================
   Team SER+ · Equipo competitivo (competencia.html)
   Necesita water.js y script.js cargados antes.
   ========================================================= */

const pad2 = (n) => String(n).padStart(2, '0');
// 15.58 · 1:05.00 · 16:42.10
const fmtTime = (s, dec = 2) => {
  s = Math.round(s * 10 ** dec) / 10 ** dec;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const ss = sec.toFixed(dec).padStart(dec ? dec + 3 : 2, '0');
  return m ? `${m}:${ss}` : sec.toFixed(dec);
};

/* =========================================================
   PORTADA — final de 50 m libre en los carriles 3 a 6.
   El carril 4 (Team SER+) sale detrás, remonta con un
   parcial negativo y toca primero por centésimas.
   ========================================================= */
const raceEl = $('.race');
const raceLanesEl = $('#raceLanes');
const laneEls = $$('.rl', raceLanesEl || document);

const raceLayout = (w) => {
  const top = raceLanesEl.offsetTop;
  const lh = raceLanesEl.offsetHeight / laneEls.length;
  const lines = [];
  const ropes = [top];
  laneEls.forEach((_, i) => {
    lines.push(top + lh * (i + .5));
    if (i < laneEls.length - 1) ropes.push(top + lh * (i + 1));
  });
  return {
    lines,
    ropes,
    span: [Math.max(70, w * .05), w - Math.max(50, w * .035)],
    lineW: clamp(lh * .085, 10, 20),
    lineT: lh * .2,
    swimL: Math.min(lh * .62, w * .3, 170),
  };
};

const raceWater = raceEl ? registerWater(createWater($('#raceWater'), {
  // cuatro nadadores a pantalla completa: se dibuja a algo menos de resolución
  // (el agua es suave y no se nota) para que la carrera vaya fluida
  quality: lowPower ? .46 : .64,
  tile: 24,
  tileA: '#1a5cc4', tileB: '#1e64cc', grout: '#4f93e0', line: '#06173f',
  deep: '#041e5a', sky: '#d9f1ff',
  absorb: .42, depth: 100, caustic: .9, causticDepth: 320, wall: 0, ropeR: 9,
  motes: lowPower ? 24 : 50, bubbles: 170, bubbleRate: lowPower ? 1.5 : 3,
  layout: raceLayout,
})) : null;

if (raceEl) {
  attachRipples(raceEl, raceWater, { move: .3, moveR: 16, tap: 1.4, tapR: 26 });

  // el título flota y su sombra cae en el fondo de la piscina
  const drawRaceShadow = titleShadow($('#race-title'), raceWater);
  relayoutHooks.push(drawRaceShadow);
  whenLoaded(() => {
    drawRaceShadow();
    if (raceWater) raceWater.showMask(.5, 1.2);
    setTimeout(drawRaceShadow, 2400);
  });

  const clockEl = $('#raceClock');
  const statusEl = $('#raceStatus');
  const flashEl = $('#raceFlash');
  const US = laneEls.findIndex((l) => l.classList.contains('rl--us'));
  const live = raceWater && !raceWater.fallback && !reduceMotion;

  const setStatus = (text, cls = '') => {
    statusEl.textContent = text;
    statusEl.className = `race__status ${cls}`;
  };

  // tiempos de una final: el nuestro gana; un rival pelea hasta el final
  const drawTimes = () => {
    const win = 24.3 + Math.random() * .7;
    const rival = [0, 2, 3].filter((i) => i !== US)[(Math.random() * 3) | 0];
    return laneEls.map((_, i) => {
      if (i === US) return win;
      if (i === rival) return win + .02 + Math.random() * .2;
      return win + .35 + Math.random() * .9;
    }).map((t) => Math.round(t * 100) / 100);
  };

  const showResult = (lane, place, time, best) => {
    lane.dataset.place = place;
    $('.rl__pos', lane).textContent = place;
    $('.rl__time', lane).textContent = time.toFixed(2);
    let gap = $('.rl__gap', lane);
    if (place > 1) {
      if (!gap) { gap = document.createElement('span'); gap.className = 'rl__gap'; $('.rl__res', lane).appendChild(gap); }
      gap.textContent = `+${(time - best).toFixed(2)}`;
    } else if (gap) {
      gap.remove();
    }
    lane.classList.add('is-done', 'is-touch');
  };

  const finalMessage = (times) => {
    const sorted = [...times].sort((a, b) => a - b);
    return `¡Carril 4 gana por ${(sorted[1] - sorted[0]).toFixed(2)}!`;
  };

  if (!live) {
    // sin animación: el resultado oficial de la final
    const times = [24.71, 24.52, 24.56, 25.33];
    const order = [...times].sort((a, b) => a - b);
    laneEls.forEach((l, i) => showResult(l, order.indexOf(times[i]) + 1, times[i], order[0]));
    clockEl.textContent = times[US].toFixed(2);
    setStatus(finalMessage(times), 'is-win');
  } else {
    let racing = false;

    const race = async () => {
      racing = true;
      const W = raceWater.cssW;
      const L = raceWater.layout.swimL;
      raceLanesEl.style.setProperty('--sl', `${L.toFixed(0)}px`);
      laneEls.forEach((l) => { l.classList.remove('is-done', 'is-touch'); delete l.dataset.place; });
      clockEl.textContent = '00.00';
      setStatus('En sus marcas');
      raceWater.onFrame = null;
      await wait(1500);

      const times = drawTimes();
      const best = Math.min(...times);
      const worst = Math.max(...times);
      const x0 = L * .3;
      const x1 = W - L * .42;
      // el ganador cruza en 6 a 8,5 s: a ese ritmo el avance por cuadro es corto y se ve fluido
      const scale = best / clamp((x1 - x0) / 185, 6, 8.5);  // segundos de prueba por segundo real
      const start = now();
      // el puesto sale del tiempo, no del orden en que se procesan los toques
      const order = [...times].sort((a, b) => a - b);
      let winner = false;

      setStatus('¡Salida!', 'is-go');
      flashEl.classList.remove('is-on');
      void flashEl.offsetWidth;
      flashEl.classList.add('is-on');

      laneEls.forEach((lane, i) => {
        const y = raceWater.layout.lines[i];
        // entrada al agua
        raceWater.drop(x0 + L * .2, y, L * .3, 1.5);
        raceWater.burst(x0 + L * .2, y, 14, L * .18);
        const rival = i !== US && times[i] - best < .3;
        // el estilo de carrera de cada uno se sortea una vez por prueba, no en cada cuadro
        // (sortearlo en cada cuadro hacía saltar al nadador hacia adelante y hacia atrás)
        const pace = Math.random() * .1 - .02;
        raceWater.swim({
          y, x0, x1,
          dur: times[i] / scale,
          cap: lane.dataset.cap,
          fadeIn: .25,
          hold: (worst - times[i]) / scale + 4.6,
          str: .9,
          // el nuestro cierra fuerte; el rival sale muy rápido y se apaga
          profile: i === US ? (k) => k - .24 * k * (1 - k)
            : rival ? (k) => k + .16 * k * (1 - k)
              : (k) => k + pace * k * (1 - k),
          onTouch: () => {
            showResult(lane, order.indexOf(times[i]) + 1, times[i], best);
            raceWater.drop(W - 6, y, L * .25, .7);
            if (times[i] === best) {
              winner = true;
              clockEl.textContent = best.toFixed(2);
            }
          },
        });
      });

      // el reloj cambia unas 20 veces por segundo: repintar el LED en cada cuadro no aporta
      let lastClock = 0;
      raceWater.onFrame = (t) => {
        if (winner || t - lastClock < .05) return;
        lastClock = t;
        clockEl.textContent = Math.min((t - start) * scale, 99.99).toFixed(2).padStart(5, '0');
      };

      await wait(((worst / scale) + .2) * 1000);
      setStatus(finalMessage(times), 'is-win');
      await wait(4400);
      laneEls.forEach((l) => l.classList.remove('is-done', 'is-touch'));
      await wait(900);
      racing = false;
    };

    const loop = () => {
      if (!racing && raceWater.live && raceWater.visible && document.visibilityState === 'visible') race();
      setTimeout(loop, 1500);
    };
    whenLoaded(() => setTimeout(loop, 1400));
  }
}

/* =========================================================
   RUTA AL PODIO — los bloques suben al entrar
   ========================================================= */
const podium = $('#podium');
if (podium) {
  if ('IntersectionObserver' in window && !reduceMotion) {
    const pio = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { podium.classList.add('is-in'); pio.disconnect(); }
    }, { threshold: .25 });
    pio.observe(podium);
  } else {
    podium.classList.add('is-in');
  }
}

/* =========================================================
   ENTRENAMIENTO — reloj de ritmo
   Cada serie "@ m:ss" sale cada tantos segundos: en el reloj
   el nadador lee en qué número le toca salir.
   ========================================================= */
const pcSvg = $('#pcSvg');
if (pcSvg) {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  };
  const polar = (deg, r) => {
    const a = (deg - 90) * Math.PI / 180;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };

  // esfera: 60 marcas y números de 5 en 5 (el 60 arriba)
  const ticks = $('#pcTicks');
  for (let i = 0; i < 60; i++) {
    const long = i % 5 === 0;
    const [x1, y1] = polar(i * 6, 172);
    const [x2, y2] = polar(i * 6, long ? 150 : 162);
    svgEl('line', { x1, y1, x2, y2, class: 'pc__tick', 'stroke-width': long ? 4.5 : 1.8 }, ticks);
  }
  const nums = $('#pcNums');
  for (let i = 1; i <= 12; i++) {
    const [x, y] = polar(i * 30, 126);
    const t = svgEl('text', { x, y: y + 9.5, class: 'pc__num', 'text-anchor': 'middle' }, nums);
    t.textContent = i * 5;
  }

  const secHand = $('#pcSec');
  const minHand = $('#pcMin');
  const deps = $('#pcDeps');
  const arcs = $('#pcArcs');
  const setLbl = $('#pcSet');
  const departsEl = $('#pcDeparts');
  const nextEl = $('#pcNext');
  const noteEl = $('#pcNote');
  const sets = $$('.set');
  let cur = null;

  const arcPath = (a0, a1, r) => {
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const arc = svgEl('path', { class: 'pc__arc', d: '' }, arcs);

  // círculo a mano alzada alrededor de la serie elegida
  sets.forEach((b) => {
    b.insertAdjacentHTML('beforeend', '<svg class="set__ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M10 24C6 10 36 4 60 4c24 0 37 8 35 19-2 11-30 15-54 14C16 36 3 31 6 19c2-6 9-10 18-12"/></svg>');
  });

  const select = (btn) => {
    sets.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const reps = +btn.dataset.reps;
    const int = +btn.dataset.int;
    const label = btn.textContent.replace(/\s+/g, ' ').trim();
    const nowS = Date.now() / 1000;
    cur = { reps, int, anchor: Math.floor(nowS / 60) * 60 };
    setLbl.textContent = label;
    noteEl.textContent = btn.dataset.note || '';
    deps.replaceChildren();
    if (!int) {
      departsEl.textContent = 'Nado continuo: no hay salidas que marcar en el reloj.';
      nextEl.textContent = '—';
      arc.setAttribute('d', '');
      cur = null;
      return;
    }
    const seq = [];
    const seen = new Map();
    for (let k = 0; k < reps; k++) {
      const s = (k * int) % 60;
      seq.push(s);
      if (!seen.has(s)) {
        const [x, y] = polar(s * 6, 161);
        const g = svgEl('g', { class: 'pc__dep' }, deps);
        svgEl('circle', { cx: x, cy: y, r: 8.5 }, g);
        seen.set(s, g);
      }
    }
    cur.dots = seen;
    departsEl.innerHTML = `Sales en el ${seq.map((s) => `<b>${s || 60}</b>`).join(' · ')}`;
  };

  const tickClock = () => {
    const ms = Date.now();
    const sec = (ms / 1000) % 60;
    secHand.setAttribute('transform', `rotate(${(sec * 6).toFixed(2)})`);
    minHand.setAttribute('transform', `rotate(${(((ms / 60000) % 60) * 6).toFixed(2)})`);
    if (!cur) return;
    const nowS = ms / 1000;
    const el = nowS - cur.anchor;
    const k = Math.floor(el / cur.int);              // salidas ya hechas desde el ancla
    const rep = k % cur.reps;                        // repetición en curso (0..reps-1)
    const depAt = cur.anchor + k * cur.int;          // última salida
    const next = depAt + cur.int;
    const pos = (s) => Math.round((s - cur.anchor) % 60 + 60) % 60;
    // arco: lo que falta para la próxima salida, desde la aguja
    // (si falta más de un minuto, el reloj aún tiene que dar la vuelta: sin arco)
    const left = next - nowS;
    const a0 = sec * 6;
    arc.setAttribute('d', left < 60 ? arcPath(a0, a0 + left * 6, 161) : '');
    const nextPos = pos(next);
    cur.dots.forEach((g, s) => g.classList.toggle('is-next', s === nextPos));
    const wait = Math.ceil(left);
    nextEl.textContent = `Rep. ${rep + 1}/${cur.reps} · en el ${nextPos || 60} · faltan ${wait >= 60 ? fmtTime(wait, 0) : `${pad2(wait)} s`}`;
  };

  sets.forEach((b) => b.addEventListener('click', () => { select(b); tickClock(); }));
  select(sets.find((b) => b.dataset.int === '100') || sets[0]);
  tickClock();

  // el reloj corre solo mientras se ve
  let pcVisible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { pcVisible = e.isIntersecting; }, { rootMargin: '100px' }).observe(pcSvg);
  }
  const pcLoop = () => {
    if (pcVisible) tickClock();
    if (reduceMotion) setTimeout(pcLoop, 1000); else requestAnimationFrame(pcLoop);
  };
  pcLoop();
}

/* =========================================================
   DÍA DE COMPETENCIA — la cuenta regresiva se enciende al bajar
   ========================================================= */
const countdown = $('#countdown');
if (countdown) {
  const items = $$('.cd', countdown);
  const update = (y, vh) => {
    const r = countdown.getBoundingClientRect();
    const p = clamp((vh * .62 - r.top) / r.height, 0, 1);
    countdown.style.setProperty('--p', p.toFixed(4));
    items.forEach((el) => el.classList.toggle('is-on', reduceMotion || (el.offsetTop + 14) / r.height <= p));
  };
  scrollHooks.push(update);
  update(window.scrollY, window.innerHeight);
}

/* =========================================================
   LA CARRERA — una final de 100 m, foto a foto.
   En escritorio la sección se fija y el scroll vertical
   desplaza las fotos de lado; el reloj y el carril avanzan
   con ellas. En el teléfono las fotos se deslizan con el dedo.
   ========================================================= */
const runEl = $('#carrera');
const runTrack = $('#runTrack');
if (runEl && runTrack) {
  const shots = $$('.run__shot', runTrack);
  const clock = $('#runClock');
  const fill = $('#runFill');
  const desk = matchMedia('(min-width: 981px)');
  let pinned = false;
  let dist = 0;

  const paint = (p) => {
    const f = clamp(p, 0, 1) * (shots.length - 1);
    const i = Math.min(shots.length - 2, Math.floor(f));
    const k = f - i;
    const a = shots[i].dataset;
    const b = shots[i + 1].dataset;
    const t = +a.t + (+b.t - +a.t) * k;
    const m = +a.m + (+b.m - +a.m) * k;
    if (clock) clock.textContent = fmtTime(t).padStart(5, '0');
    if (fill) fill.style.transform = `scaleX(${(m / 100).toFixed(4)})`;
    const on = Math.round(f);
    shots.forEach((el, n) => el.classList.toggle('is-on', n === on));
  };

  const setup = () => {
    pinned = desk.matches && !reduceMotion;
    runEl.classList.toggle('is-pinned', pinned);
    runTrack.style.transform = '';
    if (pinned) {
      dist = Math.max(0, runTrack.scrollWidth - window.innerWidth);
      runEl.style.height = `${Math.round(dist + window.innerHeight)}px`;
    } else {
      runEl.style.height = '';
    }
  };

  const update = () => {
    if (!pinned) return;
    const p = clamp(-runEl.getBoundingClientRect().top / Math.max(1, dist), 0, 1);
    runTrack.style.transform = `translate3d(${(-p * dist).toFixed(1)}px, 0, 0)`;
    paint(p);
  };

  runTrack.addEventListener('scroll', () => {
    if (!pinned) paint(runTrack.scrollLeft / Math.max(1, runTrack.scrollWidth - runTrack.clientWidth));
  }, { passive: true });

  setup();
  paint(0);
  relayoutHooks.push(() => { setup(); update(); });
  scrollHooks.push(update);
}

/* ---------------------------------------------------------
   Día de competencia: la foto cambia con cada paso encendido
   --------------------------------------------------------- */
const meetShot = $('#meetShot');
if (meetShot && countdown) {
  const imgs = $$('img', meetShot);
  const lbl = $('#meetShotT');
  const steps = $$('.cd', countdown);
  let cur = 0;
  scrollHooks.push(() => {
    let i = 0;
    steps.forEach((el, k) => { if (el.classList.contains('is-on')) i = k; });
    if (i === cur) return;
    cur = i;
    imgs.forEach((img, k) => img.classList.toggle('is-on', k === i));
    if (lbl) lbl.textContent = $('.led', steps[i]).textContent;
  });
}
