/* =========================================================
   Team SER+ · El club (club.html)
   Necesita water.js y script.js cargados antes.
   ========================================================= */

/* ---------------------------------------------------------
   Manifiesto: cada frase se enciende al llegar a ella
   --------------------------------------------------------- */
const manifestoLines = $$('#manifesto li');
if (manifestoLines.length) {
  if ('IntersectionObserver' in window && !reduceMotion) {
    const mio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-lit'); mio.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -38% 0px', threshold: .6 });
    manifestoLines.forEach((li) => mio.observe(li));
  } else {
    manifestoLines.forEach((li) => li.classList.add('is-lit'));
  }
}

/* escalonado al aparecer */
[$$('.why__list li'), $$('.ccard')].forEach((list) => {
  list.forEach((el, i) => el.style.setProperty('--rd', `${(i % 6) * .07}s`));
});

/* ---------------------------------------------------------
   Valores: un solo brillo ilumina los seis gorros y sigue
   al cursor, como si la luz de la piscina se moviera
   --------------------------------------------------------- */
const capDeck = $('#capDeck');
const capLight = $('#capLight');
if (capDeck && capLight && !reduceMotion && matchMedia('(hover: hover)').matches) {
  let raf = 0;
  let tx = .34, ty = .26, cx = .34, cy = .26;
  const step = () => {
    cx += (tx - cx) * .12;
    cy += (ty - cy) * .12;
    ['cx', 'fx'].forEach((a) => capLight.setAttribute(a, cx.toFixed(3)));
    ['cy', 'fy'].forEach((a) => capLight.setAttribute(a, cy.toFixed(3)));
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > .002 ? requestAnimationFrame(step) : 0;
  };
  const aim = (x, y) => {
    tx = x; ty = y;
    if (!raf) raf = requestAnimationFrame(step);
  };
  capDeck.addEventListener('pointermove', (e) => {
    const r = capDeck.getBoundingClientRect();
    // el brillo se corre hacia donde está la luz, sin salirse del gorro
    aim(clamp(.2 + (e.clientX - r.left) / r.width * .3, .18, .5), clamp(.14 + (e.clientY - r.top) / r.height * .3, .12, .42));
  }, { passive: true });
  capDeck.addEventListener('pointerleave', () => aim(.34, .26), { passive: true });
}

/* ---------------------------------------------------------
   Pilar 1: la superficie del agua sobre los escalones se mueve
   --------------------------------------------------------- */
const stSurface = $('#stSurface');
const stBody = $('#stBody');
if (stSurface && stBody && !reduceMotion) {
  let on = false;
  const wave = (ms) => {
    if (!on) return;
    const t = ms / 1000;
    let d = '';
    for (let x = 84; x <= 644; x += 16) {
      const y = 66 + Math.sin(x * .028 - t * 1.6) * 2.4 + Math.sin(x * .061 + t * 2.3) * 1.2;
      d += `${d ? 'L' : 'M'}${x} ${y.toFixed(2)} `;
    }
    stSurface.setAttribute('d', d);
    stBody.setAttribute('d', `${d}V400 H84 Z`);
    requestAnimationFrame(wave);
  };
  new IntersectionObserver(([e]) => {
    const was = on;
    on = e.isIntersecting;
    if (on && !was) requestAnimationFrame(wave);
  }).observe(stSurface.closest('.steps'));
}

/* ---------------------------------------------------------
   Pilar 2: cada habilidad se marca sobre el video
   --------------------------------------------------------- */
const vid = $('#vid');
const vidNote = $('#vidNote');
const skillNotes = {
  postura: 'Postura: el cuerpo largo y alineado, sin resistencia innecesaria.',
  patada: 'Patada: continua, desde la cadera y sin doblar de más las rodillas.',
  ritmo: 'Ritmo: cada brazada a su tiempo, ciclo tras ciclo.',
  sub: 'Subacuáticos: la profundidad y la distancia bajo el agua después de cada pared.',
  giros: 'Salidas y giros: los metros que se ganan desde la pared.',
  frec: 'Frecuencia y eficiencia: cuánta agua mueve cada brazada.',
};
const skillBtns = $$('#skills button');
if (vid && skillBtns.length) {
  const pick = (b) => {
    skillBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    vid.dataset.skill = b.dataset.skill;
    if (vidNote) vidNote.textContent = skillNotes[b.dataset.skill];
  };
  skillBtns.forEach((b) => {
    b.addEventListener('click', () => pick(b));
    b.addEventListener('pointerenter', () => { if (matchMedia('(hover: hover)').matches) pick(b); });
  });

  // código de tiempo de la toma (25 cuadros por segundo) mientras se ve
  const tc = $('#vidTc');
  if (tc && !reduceMotion) {
    let on = false;
    let start = 0;
    const pad = (n) => String(n).padStart(2, '0');
    const tick = (ms) => {
      if (!on) return;
      const f = Math.floor((ms - start) / 40) + 12 * 25 + 8;
      tc.textContent = `00:${pad(Math.floor(f / 1500) % 60)}:${pad(Math.floor(f / 25) % 60)}:${pad(f % 25)}`;
      requestAnimationFrame(tick);
    };
    new IntersectionObserver(([e]) => {
      const was = on;
      on = e.isIntersecting;
      if (on && !was) { start = performance.now(); requestAnimationFrame(tick); }
    }).observe(vid);
  }
}

/* ---------------------------------------------------------
   Pilar 3: lo que celebramos cambia la foto.
   Mientras el pilar se ve, las fotos pasan solas (sin depender
   del scroll); al pasar el cursor o tocar una frase, se queda
   en esa foto.
   --------------------------------------------------------- */
const joyItems = $$('#celebrate li');
const joyShots = $$('#joyFrame img');
const joyTag = $('#joyTag');
if (joyItems.length && joyShots.length) {
  let cur = 0;
  let paused = false;
  let timer = 0;
  const show = (i) => {
    cur = (i + joyItems.length) % joyItems.length;
    joyItems.forEach((li, k) => li.classList.toggle('is-on', k === cur));
    joyShots.forEach((img, k) => img.classList.toggle('is-on', k === cur));
    if (joyTag) joyTag.textContent = `+ ${joyItems[cur].textContent}`;
  };
  const play = () => {
    clearInterval(timer);
    if (!paused && !reduceMotion) timer = setInterval(() => show(cur + 1), 3200);
  };
  joyItems.forEach((li, i) => {
    li.addEventListener('pointerenter', () => { paused = true; clearInterval(timer); show(i); });
    li.addEventListener('click', () => { paused = true; clearInterval(timer); show(i); });
  });
  $('#celebrate').addEventListener('pointerleave', () => { paused = false; play(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting) play();
      else clearInterval(timer);
    }, { threshold: .35 }).observe($('#joyFrame'));
  }
}
