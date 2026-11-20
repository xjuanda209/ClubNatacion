/* =========================================================
   Team SER+ · Academia +Natación
   Comportamiento del sitio. Necesita water.js cargado antes.
   ========================================================= */

// Contacto del club: WhatsApp (+57 323 438 0362, número oficial dado por el
// cliente) e Instagram por mensaje directo.
// EDITAR: el número va con código de país, sin + ni espacios. Si cambia,
// cambiar también el texto visible "+57 323 438 0362" en las páginas.
const CONFIG = {
  instagram: 'sermasnatacion',
  whatsapp: '573234380362',
  saludo: '¡Hola Team SER+! Quiero información sobre las clases de natación.',
};

// tareas que cada página agrega: al cambiar el tamaño y cuando el contenido ya se mostró
const relayoutHooks = [];
const loadedHooks = [];
let siteLoaded = false;
const safely = (fn) => { try { fn(); } catch (err) { console.warn('[sitio]', err); } };
const whenLoaded = (fn) => (siteLoaded ? safely(fn) : loadedHooks.push(fn));

/* =========================================================
   PORTADA (index.html)
   ========================================================= */
const heroEl = $('.hero');
const poolEl = $('#pool');

const heroWater = registerWater(createWater($('#heroWater'), {
  tile: 26,
  tileA: '#1a5cc4', tileB: '#1e64cc', grout: '#4f93e0', line: '#06173f',
  deep: '#041e5a', sky: '#d9f1ff',
  absorb: .45, depth: 110, caustic: .9, causticDepth: 330, wall: 0, ropeR: 10,
  motes: lowPower ? 36 : 70, bubbles: 180, bubbleRate: lowPower ? 3 : 5,
  layout: (w, h) => ({
    lines: [h * .5],
    ropes: [h - 30],
    span: [-100, w + 100],
    lineW: clamp(h * .036, 16, 30),
    lineT: 0,
    swimL: clamp(h * .22, 110, 190),
  }),
}));

const poolLayout = (w) => {
  const lanes = $$('.lane');
  const lines = [];
  const ropes = [];
  lanes.forEach((l, i) => {
    lines.push(l.offsetTop + l.offsetHeight / 2);
    if (i < lanes.length - 1) ropes.push(l.offsetTop + l.offsetHeight);
  });
  const laneH = lanes[0] ? lanes[0].offsetHeight : 240;
  return {
    lines,
    ropes,
    span: [Math.max(96, w * .08), w - Math.max(56, w * .045)],
    lineW: clamp(laneH * .085, 12, 22),
    lineT: laneH * .2,
    swimL: Math.min(laneH * .6, w * .36, 170),
  };
};

// un carril por categoría: el agua se hace más honda del carril 1 al 4
const poolWater = registerWater(createWater($('#poolWater'), {
  tile: 22,
  tileA: '#2479dc', tileB: '#2a84e6', grout: '#a6d6f7',
  absorb: .26, absorbB: .58, deep: '#0d63c4', deepB: '#04205f',
  caustic: .72, causticDepth: 280,
  ropeR: matchMedia('(max-width: 640px)').matches ? 6.5 : 8,
  motes: lowPower ? 10 : 20, bubbles: 110, bubbleRate: lowPower ? .8 : 1.4,
  layout: poolLayout,
}));

// sin WebGL2: corcheras en CSS entre los carriles
if (poolWater && poolWater.fallback) {
  poolEl.classList.add('pool--css');
  $$('.lane').slice(0, -1).forEach((lane) => {
    const r = document.createElement('div');
    r.className = 'rope';
    r.dataset.rope = '';
    r.setAttribute('aria-hidden', 'true');
    lane.after(r);
  });
}

attachRipples(heroEl, heroWater);
attachRipples($('#poolBasin'), poolWater, { move: .22, moveR: 16, tap: 1.2, tapR: 26 });

// el título de portada flota sobre el agua y su sombra cae, refractada, en el fondo
const heroTitle = $('#hero-title');
const drawHeroShadow = titleShadow(heroTitle, heroWater);
relayoutHooks.push(drawHeroShadow);

// "SER" sale a la superficie: una onda y un puñado de burbujas por letra
const heroSplash = () => {
  const ser = heroTitle && $('.ser', heroTitle);
  if (!ser || !heroWater || heroWater.fallback || reduceMotion) return;
  const box = heroWater.canvas.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(ser.firstChild);
  const r = range.getBoundingClientRect();
  const y = r.top - box.top + r.height * .55;
  heroWater.showMask(.62, 1.1);
  [.18, .5, .82].forEach((f, i) => setTimeout(() => {
    const x = r.left - box.left + r.width * f;
    heroWater.drop(x, y, r.height * .2, 1.2);
    heroWater.burst(x, y, 12, r.height * .25);
  }, 620 + i * 90));
};
// (las animaciones de entrada tienen retardo, así que las medidas aún no están transformadas)
whenLoaded(() => {
  drawHeroShadow();
  heroSplash();
  setTimeout(drawHeroShadow, 2400);
});

// nadadores que cruzan la portada sobre la línea del fondo, uno tras otro,
// mientras la portada esté a la vista
if (heroWater && !heroWater.fallback && !reduceMotion) {
  const lap = () => {
    let next = 1500;
    if (heroWater.live && heroWater.visible && document.visibilityState === 'visible') {
      const W = heroWater.cssW;
      const L = heroWater.layout.swimL;
      const speed = clamp(W * .2, 220, 360);
      heroWater.swim({ y: heroWater.layout.lines[0], speed, str: .95, fadeIn: .4 });
      // el siguiente sale cuando este va por la mitad: siempre hay alguien nadando
      next = ((W + L * 3.2) / speed) * 550 + Math.random() * 1200;
    }
    setTimeout(lap, next);
  };
  whenLoaded(() => setTimeout(lap, 1900));
}

// cada carril es una categoría: al pasar el cursor se enciende su luz de salida
// y una onda sale desde la plataforma (el nadador se reserva para la competición)
$$('.lane').forEach((lane) => {
  const wake = () => {
    if (!poolWater || poolWater.fallback || reduceMotion || lane.dataset.wake) return;
    lane.dataset.wake = '1';
    const y = lane.offsetTop + lane.offsetHeight / 2;
    const x = (poolWater.layout.span ? poolWater.layout.span[0] : 90) * .55;
    poolWater.drop(x, y, 34, 1.4);
    poolWater.burst(x, y, 10, 22);
    setTimeout(() => { delete lane.dataset.wake; }, 1600);
  };
  lane.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') wake(); });
  lane.addEventListener('focusin', wake);
});

/* ---------------------------------------------------------
   Galería: tres carriles de fotos que avanzan como nadadores.
   Cada carril va a su ritmo y en su sentido; con el cursor
   encima se frena, se puede arrastrar y cada foto se abre
   en grande en el visor.
   --------------------------------------------------------- */
const gLanes = $$('.glane').map((el) => ({
  el,
  view: $('.glane__view', el),
  track: $('.glane__track', el),
  speed: +el.dataset.speed || 30,
  dir: +el.dataset.dir || -1,
  x: 0, v: 1, period: 0, hold: false, drag: null, suppress: false,
}));
if (gLanes.length) {
  const wrapX = (L) => {
    if (!L.period) return;
    while (L.x <= -L.period) L.x += L.period;
    while (L.x > 0) L.x -= L.period;
  };
  const place = (L) => { L.track.style.transform = `translate3d(${L.x.toFixed(2)}px, 0, 0)`; };

  // copias de las fotos hasta cubrir el carril con holgura (las copias no se anuncian ni reciben foco)
  const fill = (L) => {
    $$('[data-clone]', L.track).forEach((li) => li.remove());
    const originals = [...L.track.children];
    if (!originals.length) return;
    let guard = 0;
    // siempre al menos una copia: el giro del carril necesita medir dónde empieza la segunda vuelta
    while (guard++ < 8 && (guard === 1 || L.track.scrollWidth < L.view.clientWidth * 2 + 200)) {
      originals.forEach((li) => {
        const c = li.cloneNode(true);
        c.dataset.clone = '';
        c.setAttribute('aria-hidden', 'true');
        $('button', c).tabIndex = -1;
        L.track.appendChild(c);
      });
    }
    L.period = L.track.children[originals.length].offsetLeft - originals[0].offsetLeft;
    if (L.dir > 0 && !L.x) L.x = -L.period / 2;
    wrapX(L);
    place(L);
  };
  gLanes.forEach(fill);
  relayoutHooks.push(() => gLanes.forEach(fill));

  gLanes.forEach((L) => {
    // se frena con el cursor o el foco; con el teclado, la foto enfocada entra a la vista
    L.view.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') L.hold = true; });
    L.view.addEventListener('pointerleave', () => { L.hold = false; });
    L.view.addEventListener('focusin', (e) => {
      L.hold = true;
      const li = e.target.closest('.gshot');
      if (!li) return;
      L.view.scrollLeft = 0;
      const left = li.offsetLeft + L.x;
      if (left < 40 || left + li.offsetWidth > L.view.clientWidth - 40) {
        L.x = -li.offsetLeft + Math.min(120, L.view.clientWidth * .1);
        wrapX(L);
        place(L);
      }
    });
    L.view.addEventListener('focusout', () => { L.hold = false; });

    // arrastrar con el ratón o el dedo (el desplazamiento vertical de la página sigue igual)
    L.view.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      L.drag = { x0: e.clientX, xs: L.x, moved: false, id: e.pointerId };
    });
    L.view.addEventListener('pointermove', (e) => {
      if (!L.drag || e.pointerId !== L.drag.id) return;
      const dx = e.clientX - L.drag.x0;
      if (!L.drag.moved && Math.abs(dx) > 6) {
        L.drag.moved = true;
        L.view.classList.add('is-drag');
        try { L.view.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      }
      if (L.drag.moved) {
        L.x = L.drag.xs + dx;
        wrapX(L);
        place(L);
      }
    });
    const end = () => {
      if (!L.drag) return;
      L.suppress = L.drag.moved;
      L.drag = null;
      L.view.classList.remove('is-drag');
    };
    L.view.addEventListener('pointerup', end);
    L.view.addEventListener('pointercancel', end);
    L.view.addEventListener('click', (e) => {
      if (L.suppress) { e.preventDefault(); e.stopPropagation(); L.suppress = false; }
    }, true);
    L.view.addEventListener('dragstart', (e) => e.preventDefault());
  });

  // movimiento continuo, solo mientras la galería se ve y el visor no la tapa
  let lanesPaused = false;
  let resumeLanes = () => {};
  if (!reduceMotion && 'IntersectionObserver' in window) {
    let on = false;
    let last = 0;
    let raf = 0;
    const tick = (ms) => {
      raf = 0;
      if (!on || lanesPaused) return;
      const dt = Math.min(.05, (ms - last) / 1000 || 0);
      last = ms;
      gLanes.forEach((L) => {
        if (L.drag && L.drag.moved) return;
        L.v += ((L.hold ? 0 : 1) - L.v) * Math.min(1, dt * 3.2);
        L.x += L.dir * L.speed * L.v * dt;
        wrapX(L);
        place(L);
      });
      raf = requestAnimationFrame(tick);
    };
    resumeLanes = () => {
      if (!on || lanesPaused || raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    new IntersectionObserver(([e]) => {
      on = e.isIntersecting;
      resumeLanes();
    }, { rootMargin: '80px' }).observe($('#glanes'));
  }
  const clearSelection = () => { try { window.getSelection().removeAllRanges(); } catch (err) { /* sin selección */ } };

  // visor
  const lb = $('#lightbox');
  const shots = $$('.gshot:not([data-clone]) button');
  if (lb && shots.length && typeof lb.showModal === 'function') {
    const lbImg = $('#lbImg');
    const lbCap = $('#lbCap');
    const lbNum = $('#lbNum');
    let cur = 0;
    const show = (i) => {
      cur = (i + shots.length) % shots.length;
      const img = $('img', shots[cur]);
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt;
      lbCap.textContent = $('.gshot__cap', shots[cur]).textContent;
      lbNum.textContent = `${String(cur + 1).padStart(2, '0')} / ${shots.length}`;
      // reinicia la entrada de la foto
      lbImg.style.animation = 'none';
      void lbImg.offsetWidth;
      lbImg.style.animation = '';
    };
    $('#glanes').addEventListener('click', (e) => {
      const b = e.target.closest('.gshot button');
      if (!b) return;
      show(+b.dataset.i);
      clearSelection();
      lanesPaused = true;
      lb.showModal();
    });
    // al cerrar (botón, clic fuera o Esc) no queda nada seleccionado y los carriles siguen
    lb.addEventListener('close', () => {
      clearSelection();
      lanesPaused = false;
      resumeLanes();
    });
    $('#lbPrev').addEventListener('click', () => show(cur - 1));
    $('#lbNext').addEventListener('click', () => show(cur + 1));
    $('#lbClose').addEventListener('click', () => lb.close());
    lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
    lb.addEventListener('dragstart', (e) => e.preventDefault());
    lb.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); }
    });
    // deslizar con el dedo para pasar de foto
    let sx = null;
    lb.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    lb.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) > 50 && e.pointerType !== 'mouse') show(cur + (dx < 0 ? 1 : -1));
    });
  }
}

/* ---------------------------------------------------------
   Competición: "tu rival es tu última marca".
   El nadador sale detrás de la línea de su marca personal,
   la alcanza con un parcial negativo y toca primero. Su nuevo
   tiempo pasa a ser la línea de la siguiente salida.
   --------------------------------------------------------- */
const pbEl = $('#pb');
const pbWater = registerWater(createWater($('#pbWater'), {
  tile: 24,
  tileA: '#1f6fd6', tileB: '#2479dc', grout: '#8cc6f2', line: '#06173f',
  deep: '#06276e', sky: '#d9f1ff',
  absorb: .4, caustic: .8, causticDepth: 300, wall: 1, ropeR: 8,
  motes: lowPower ? 8 : 16, bubbles: 70, bubbleRate: lowPower ? .4 : .8,
  layout: (w, h) => ({
    lines: [h * .5],
    ropes: [10, h - 10],
    span: [Math.max(80, w * .06), w - Math.max(56, w * .04)],
    lineW: clamp(h * .075, 12, 22),
    lineT: h * .2,
    swimL: clamp(h * .5, 90, 170),
  }),
}));

if (pbEl) {
  const PB_START = 31.42;  // marca de partida de la animación (ilustrativa)
  const tag = $('#pbTag');
  const tagTime = $('#pbTagTime');
  const clockEl = $('#pbClock');
  const resultEl = $('#pbResult');
  const newEl = $('#pbNew');
  const diffEl = $('#pbDiff');
  const live = pbWater && !pbWater.fallback && !reduceMotion;
  let pb = PB_START;
  let runs = 0;
  let busy = false;

  if (!live) {
    // sin animación: la escena queda congelada en el momento de la llegada
    pbEl.classList.add('is-static', 'is-done');
    tagTime.textContent = pb.toFixed(2);
    newEl.textContent = (pb - .37).toFixed(2);
    diffEl.textContent = '−0.37';
    clockEl.textContent = (pb - .37).toFixed(2);
  } else {
    const run = () => {
      if (busy) return;
      busy = true;
      const W = pbWater.cssW;
      const H = pbWater.cssH;
      const L = pbWater.layout.swimL;
      const x0 = L * .3;
      const x1 = W - L * .42;
      const lead = L * .34;                   // la línea marca la punta de la mano
      const lineDur = clamp((x1 - x0) / 250, 4.2, 7);
      const scale = pb / lineDur;             // segundos de prueba por segundo de animación
      const gain = .12 + Math.random() * .34; // lo que baja la marca esta vez
      const time = +(pb - gain).toFixed(2);
      const start = now() + .15;
      const y0 = 22;
      const y1 = H - 22;
      let touched = false;
      const tagW = tag.offsetWidth;

      pbEl.classList.remove('is-done', 'is-touch');
      tagTime.textContent = pb.toFixed(2);
      pbWater.drop(x0 + L * .2, H / 2, L * .35, 1.6);
      pbWater.burst(x0 + L * .2, H / 2, 18, L * .2);

      pbWater.swim({
        y: H / 2, x0, x1, dur: time / scale, fadeIn: .3, hold: 2.6,
        // parcial negativo: sale más lento que la línea y cierra más rápido
        profile: (k) => k - .26 * k * (1 - k),
        onTouch: () => {
          touched = true;
          clockEl.textContent = time.toFixed(2);
          newEl.textContent = time.toFixed(2);
          diffEl.textContent = `−${(pb - time).toFixed(2)}`;
          pbEl.classList.add('is-done', 'is-touch');
          pbWater.drop(W - 8, H / 2, L * .3, .8);
        },
        onEnd: () => {
          pb = time;
          runs += 1;
          // tras unas salidas, la temporada vuelve a empezar
          if (runs >= 4) { runs = 0; pb = PB_START; }
          setTimeout(() => {
            pbWater.setMark(0, 0, 0, 0);
            pbEl.classList.remove('is-touch');
            busy = false;
          }, 600);
        },
      });

      pbWater.onFrame = (t) => {
        const el = Math.max(0, t - start);
        const k = Math.min(1, el / lineDur);
        const x = x0 + (x1 - x0) * k + lead;
        const fade = busy ? 1 - clamp((el - lineDur - 1.2) / .8, 0, 1) : 0;
        pbWater.setMark(x, y0, y1, fade);
        // cerca de la pared la etiqueta pasa al otro lado de la línea
        const flip = x > W - tagW - 16;
        tag.classList.toggle('is-flip', flip);
        tag.style.transform = `translateX(${(flip ? x - tagW : x).toFixed(1)}px)`;
        tag.style.opacity = fade.toFixed(3);
        if (!touched) clockEl.textContent = Math.min(el * scale, 99.99).toFixed(2).padStart(5, '0');
      };
    };

    // sale cuando la sección está a la vista y repite mientras siga ahí
    let pbVisible = false;
    const tick = () => {
      if (pbVisible && !busy && pbWater.live && document.visibilityState === 'visible') run();
      setTimeout(tick, 1600);
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { pbVisible = e.isIntersecting; }, { threshold: .5 }).observe(pbEl);
    } else {
      pbVisible = true;
    }
    tick();
  }
}

/* ---------------------------------------------------------
   Corcheras en CSS (pie de página / respaldo)
   --------------------------------------------------------- */
const FLOAT_W = 25;
const buildRope = (rope) => {
  const count = Math.ceil(rope.offsetWidth / FLOAT_W) + 1;
  if (rope.childElementCount === count) return;
  const frag = document.createDocumentFragment();
  for (let n = 0; n < count; n++) {
    const i = document.createElement('i');
    const fromEdge = Math.min(n, count - 1 - n);
    i.dataset.c = fromEdge < 6 ? 'r' : Math.floor((n - 6) / 5) % 2 === 0 ? 'w' : 'b';
    i.style.setProperty('--n', n);
    frag.appendChild(i);
  }
  rope.replaceChildren(frag);
};
const ropes = () => $$('[data-rope]');
ropes().forEach(buildRope);

/* ---------------------------------------------------------
   Burbujas
   --------------------------------------------------------- */
// respaldo sin WebGL2: burbujas en CSS (con WebGL2 las burbujas viven en el agua)
const bubbles = $('#heroBubbles');
if (bubbles && !reduceMotion && (!heroWater || heroWater.fallback)) {
  const frag = document.createDocumentFragment();
  for (let n = 0; n < 18; n++) {
    const b = document.createElement('span');
    const s = 3 + Math.random() * 12;
    b.style.setProperty('--s', `${s.toFixed(1)}px`);
    b.style.setProperty('--x', `${(Math.random() * 100).toFixed(2)}%`);
    b.style.setProperty('--t', `${(7 + Math.random() * 9).toFixed(2)}s`);
    b.style.setProperty('--delay', `${(-Math.random() * 14).toFixed(2)}s`);
    b.style.setProperty('--sway', `${((Math.random() - .5) * 60).toFixed(1)}px`);
    frag.appendChild(b);
  }
  bubbles.appendChild(frag);
}

/* ---------------------------------------------------------
   Cintas (marquee): duplicar contenido para bucle continuo
   --------------------------------------------------------- */
$$('.tape__track').forEach((track) => {
  const original = [...track.children].map((n) => n.cloneNode(true));
  let guard = 0;
  while (track.scrollWidth < window.innerWidth * 1.3 && guard++ < 8) {
    original.forEach((n) => track.appendChild(n.cloneNode(true)));
  }
  [...track.children].forEach((n) => track.appendChild(n.cloneNode(true)));
  track.style.setProperty('--dur', `${Math.round(track.scrollWidth / 2 / 60)}s`);
});

/* ---------------------------------------------------------
   Nav: estado, menú móvil, enlace activo, metros nadados
   --------------------------------------------------------- */
const nav = $('#nav');
const toggle = $('#navToggle');
const menu = $('#mobileMenu');
const meterNum = $('#meterNum');
const ropeFill = $('#ropeFill');
const waFloat = $('.wa-float');

const setMenu = (open) => {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  document.body.classList.toggle('menu-open', open);
  if (open) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    document.body.style.overflow = 'hidden';
  } else {
    menu.classList.remove('is-open');
    document.body.style.overflow = '';
    const done = () => { if (!menu.classList.contains('is-open')) menu.hidden = true; };
    reduceMotion ? done() : setTimeout(done, 700);
  }
};
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
$$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); } });

const splitsWrap = $('#splitsWrap');
const splitItems = $$('.split');
const vertical = window.matchMedia('(max-width: 980px)');
const scrollHooks = [];

const onScroll = () => {
  const y = window.scrollY;
  const vh = window.innerHeight;
  nav.classList.toggle('is-scrolled', y > 24);
  if (waFloat) waFloat.classList.toggle('is-visible', y > vh * .6);

  const max = document.documentElement.scrollHeight - vh;
  const p = max > 0 ? clamp(y / max, 0, 1) : 0;
  ropeFill.style.setProperty('--progress', p.toFixed(4));
  meterNum.textContent = (p * 25).toFixed(1).padStart(4, '0');

  // parciales del método
  if (splitsWrap) {
    const r = splitsWrap.getBoundingClientRect();
    const span = vertical.matches ? r.height : Math.max(r.height, vh * .35);
    const sp = clamp((vh * .72 - r.top) / span, 0, 1);
    splitsWrap.style.setProperty('--p', sp.toFixed(4));
    splitItems.forEach((el) => {
      const pos = vertical.matches ? (el.offsetTop + 10) / r.height : el.offsetLeft / r.width;
      el.classList.toggle('is-on', sp >= pos + .015);
    });
  }
  scrollHooks.forEach((fn) => fn(y, vh));
};
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(() => { onScroll(); ticking = false; }); }
}, { passive: true });

// enlace activo (solo los que apuntan a secciones de esta misma página)
const links = $$('.nav__links a').filter((a) => a.getAttribute('href').startsWith('#'));
if ('IntersectionObserver' in window && links.length) {
  const sio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => {
        if (a.getAttribute('href') === `#${e.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach((s) => sio.observe(s));
}

/* ---------------------------------------------------------
   Revelados al hacer scroll
   --------------------------------------------------------- */
$$('.stats .stat').forEach((el, i) => el.style.setProperty('--rd', `${i * .08}s`));
$$('.compete__list li').forEach((el, i) => el.style.setProperty('--rd', `${i * .08}s`));
$$('.contact').forEach((el) => el.style.setProperty('--rd', '.15s'));

const revealIO = 'IntersectionObserver' in window && !reduceMotion
  ? new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); }
    });
  }, { threshold: .15, rootMargin: '0px 0px -8% 0px' })
  : null;
const reveal = (els) => els.forEach((el) => (revealIO ? revealIO.observe(el) : el.classList.add('is-in')));
reveal($$('.reveal'));

/* =========================================================
   TABLERO DE VALORES
   Una final de 100 m donde los seis valores llegan juntos.
   ========================================================= */
const board = $('#board');
if (board) {
  const rows = $$('.row', board);
  const tracks = rows.map((r) => $('.row__track', r));
  const names = rows.map((r) => $('.row__name .led', r));
  const posEls = rows.map((r) => $('.row__pos .led', r));
  const ticker = $('#ticker');
  const clock = $('#boardClock');
  const live = $('#boardLive');
  const replay = $('#boardReplay');
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+#';
  const FINAL_TIME = 49.87;

  let state = 'idle';
  let boardVisible = false;
  let cycleTimer = 0;
  let current = -1;
  let pauseUntil = 0;

  // efecto LED: las letras se "encienden" de forma aleatoria hasta fijarse
  const scramble = (el, text, { stagger = 18, base = 140 } = {}) => new Promise((resolve) => {
    if (reduceMotion) { el.textContent = text; resolve(); return; }
    const chars = [...text];
    const id = (el._scr = (el._scr || 0) + 1);
    const start = performance.now();
    const tick = (ms) => {
      if (el._scr !== id) { resolve(); return; }
      const dt = ms - start;
      let out = '';
      let done = true;
      chars.forEach((ch, i) => {
        if (ch === ' ' || dt >= base + i * stagger) out += ch;
        else { out += GLYPHS[(Math.random() * GLYPHS.length) | 0]; done = false; }
      });
      el.textContent = out;
      if (done) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${sec}`;
  };

  const select = (i, animate = true) => {
    current = i;
    rows.forEach((r, j) => r.setAttribute('aria-pressed', String(j === i)));
    const r = rows[i];
    const msg = `${r.dataset.name} · ${r.dataset.desc}`;
    if (animate) scramble(ticker, msg, { stagger: 8, base: 120 });
    else ticker.textContent = msg;
  };

  const startCycle = () => {
    clearInterval(cycleTimer);
    if (reduceMotion) return;
    cycleTimer = setInterval(() => {
      if (!boardVisible || performance.now() < pauseUntil || state !== 'done') return;
      select((current + 1) % rows.length);
    }, 5500);
  };

  const setFinal = () => {
    tracks.forEach((tr) => tr.style.setProperty('--p', 1));
    rows.forEach((r) => r.classList.add('is-done'));
    posEls.forEach((p) => (p.textContent = '1'));
    clock.textContent = fmt(FINAL_TIME);
  };

  const race = async () => {
    if (state === 'racing') return;
    state = 'racing';
    clearInterval(cycleTimer);
    replay.disabled = true;
    rows.forEach((r) => { r.classList.remove('is-done'); r.setAttribute('aria-pressed', 'false'); });
    tracks.forEach((tr) => tr.style.setProperty('--p', 0));
    posEls.forEach((p) => (p.textContent = '–'));
    clock.textContent = fmt(0);

    await Promise.all(names.map((el, i) => wait(i * 110).then(() => scramble(el, rows[i].dataset.name, { stagger: 34, base: 160 }))));
    await scramble(ticker, 'EN SUS MARCAS…', { stagger: 22 });
    await wait(650);
    await scramble(ticker, '¡SALIDA!', { stagger: 22, base: 60 });

    const offs = rows.map(() => (Math.random() * 2 - 1) * .09);
    const dur = 4800;
    const start = performance.now();
    let half = false;
    await new Promise((resolve) => {
      const tick = (ms) => {
        const k = Math.min(1, (ms - start) / dur);
        tracks.forEach((tr, i) => tr.style.setProperty('--p', (k + offs[i] * Math.sin(Math.PI * k)).toFixed(4)));
        clock.textContent = fmt(k * FINAL_TIME);
        if (!half && k >= .5) { half = true; scramble(ticker, 'PARCIAL 50 M · ¡NADIE SE QUEDA ATRÁS!', { stagger: 10 }); }
        if (k < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });

    setFinal();
    await scramble(ticker, 'RESULTADO OFICIAL: EMPATE · 6 VALORES, UN SOLO EQUIPO', { stagger: 12 });
    live.textContent = 'Resultado: empate. Seis valores, un solo equipo.';
    state = 'done';
    replay.disabled = false;
    await wait(2800);
    if (state === 'done') { select(0); startCycle(); }
  };

  rows.forEach((r, i) => r.addEventListener('click', () => {
    if (state === 'racing') return;
    pauseUntil = performance.now() + 14000;
    select(i);
    live.textContent = `${r.dataset.name}: ${r.dataset.desc}`;
  }));
  replay.addEventListener('click', race);

  if (reduceMotion || !('IntersectionObserver' in window)) {
    setFinal();
    state = 'done';
    select(0, false);
  } else {
    let started = false;
    new IntersectionObserver(([e]) => {
      boardVisible = e.isIntersecting;
      if (e.isIntersecting && !started) { started = true; race(); }
    }, { threshold: .35 }).observe(board);
  }
}

/* ---------------------------------------------------------
   Contacto + formularios
   Los botones de WhatsApp abren el chat con un saludo ya escrito;
   los de Instagram, el mensaje directo. Cada formulario con
   data-wa-form arma un mensaje con los campos marcados con
   data-wa="Etiqueta" y lo abre listo en WhatsApp.
   --------------------------------------------------------- */
const waUrl = (text) => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
const igChat = `https://ig.me/m/${CONFIG.instagram}`;

$$('[data-wa-link]').forEach((a) => {
  a.href = waUrl(a.dataset.waText || CONFIG.saludo);
  a.target = '_blank';
  a.rel = 'noopener';
});
$$('[data-ig-link]').forEach((a) => {
  a.href = igChat;
  a.target = '_blank';
  a.rel = 'noopener';
});

const programSelect = $('#fProgram');
if (programSelect) {
  $$('[data-program]').forEach((a) => {
    a.addEventListener('click', () => {
      programSelect.value = a.dataset.program;
      programSelect.closest('.field').classList.remove('has-error');
      programSelect.closest('.field').querySelector('.field__err').textContent = '';
    });
  });
}

const setError = (input, msg) => {
  const field = input.closest('.field');
  field.classList.toggle('has-error', !!msg);
  field.querySelector('.field__err').textContent = msg || '';
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
};

const validators = {
  nombre: (v) => (v.trim().length < 3 ? 'Escribe tu nombre completo.' : ''),
  celular: (v) => (v.replace(/\D/g, '').length < 7 ? 'Escribe un número de celular válido.' : ''),
  programa: (v) => (!v ? 'Elige el programa que te interesa.' : ''),
  edad: (v) => (!(+v >= 3 && +v <= 99) ? 'Escribe una edad entre 3 y 99 años.' : ''),
};

$$('form[data-wa-form]').forEach((form) => {
  const names = Object.keys(validators).filter((n) => form.elements[n]);

  names.forEach((name) => {
    const input = form.elements[name];
    input.addEventListener('blur', () => { if (input.value) setError(input, validators[name](input.value)); });
    input.addEventListener('input', () => { if (input.closest('.field').classList.contains('has-error')) setError(input, validators[name](input.value)); });
    input.addEventListener('change', () => setError(input, validators[name](input.value)));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let firstBad = null;
    names.forEach((name) => {
      const input = form.elements[name];
      const msg = validators[name](input.value);
      setError(input, msg);
      if (msg && !firstBad) firstBad = input;
    });
    if (firstBad) { firstBad.focus(); return; }

    const lines = [form.dataset.waForm, ''];
    $$('[data-wa]', form).forEach((el) => {
      const v = el.tagName === 'FIELDSET'
        ? ($('input:checked', el) || {}).value
        : el.value;
      if (v && v.trim()) lines.push(`• ${el.dataset.wa}: ${v.trim()}`);
    });

    window.open(waUrl(lines.join('\n')), '_blank', 'noopener');
    const note = $('.form__note', form);
    note.textContent = '¡Listo! Abrimos WhatsApp con tu mensaje: solo dale enviar.';
    note.classList.add('is-ok');
  });
});

/* ---------------------------------------------------------
   Varios
   --------------------------------------------------------- */
$('#year').textContent = new Date().getFullYear();

let resizeT;
const relayout = () => {
  waters.forEach((w) => w.resize());
  relayoutHooks.forEach(safely);
  ropes().forEach(buildRope);
  onScroll();
};
const queueRelayout = () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(relayout, 120);
};
window.addEventListener('resize', queueRelayout);
// las fuentes cambian la altura de los carriles: recalcular la piscina
if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
if ('ResizeObserver' in window && poolEl) {
  let first = true;
  new ResizeObserver(() => {
    if (first) { first = false; return; }
    queueRelayout();
  }).observe(poolEl);
}

// primero se muestra el contenido; el agua es un extra y nunca debe impedirlo
const markLoaded = () => {
  document.documentElement.classList.add('is-loaded');
  siteLoaded = true;
  loadedHooks.splice(0).forEach(safely);
};
if (document.fonts && document.fonts.ready) {
  Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 900))]).then(markLoaded);
} else {
  markLoaded();
}
onScroll();
