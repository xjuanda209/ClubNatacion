/* =========================================================
   Team SER+ · Páginas de programa
   (formacion.html · competitivo.html · master-triatlon.html)
   Necesita water.js y script.js cargados antes.
   ========================================================= */

/* ---------------------------------------------------------
   Portada: cada programa tiene su agua. Los colores vienen en
   data-water del lienzo; data-open="1" es agua abierta: sin
   baldosas a la vista, sin línea del fondo y sin corcheras.
   --------------------------------------------------------- */
const catHero = $('.cat-hero');
const catCanvas = $('#catWater');
let catWater = null;

if (catCanvas) {
  let tint = {};
  try { tint = JSON.parse(catCanvas.dataset.water || '{}'); } catch (err) { console.warn('[programa] data-water', err); }
  const open = catCanvas.dataset.open === '1';
  const deepK = clamp(((tint.absorb || .3) - .2) / .4, 0, 1); // 0 = parte baja, 1 = lo más hondo
  catWater = registerWater(createWater(catCanvas, Object.assign({
    tile: 24,
    wall: 0, ropeR: 9, depth: 100 + deepK * 40,
    motes: Math.round((lowPower ? 22 : 40) + deepK * (lowPower ? 20 : 40)),
    bubbles: 140, bubbleRate: lowPower ? 2 : 3.5,
    layout: (w, h) => ({
      lines: open ? [] : [h * .3],
      ropes: open ? [] : [h - 28],
      span: [-100, w + 100],
      lineW: clamp(h * .034, 16, 28),
      lineT: 0,
      swimL: 150,
    }),
  }, tint)));
  attachRipples(catHero, catWater);
}

// el título y la foto flotan sobre el agua: sus sombras caen, refractadas, en el fondo
const catTitle = $('#cat-title');
const catPhoto = $('.cat-hero__photo img');
// la foto solo proyecta sombra cuando flota como una tarjeta (no si va recortada
// en diagonal ni si se funde con el agua, como en la portada de alto rendimiento)
const photoFloats = catPhoto && getComputedStyle(catPhoto).clipPath === 'none' && getComputedStyle(catPhoto.parentElement).position !== 'absolute';
const drawCatShadow = titleShadow(catTitle, catWater, { boxes: [photoFloats ? catPhoto : null, $('.depth'), $('.buoy')] });
relayoutHooks.push(drawCatShadow);
whenLoaded(() => {
  drawCatShadow();
  if (catWater && !catWater.fallback && !reduceMotion) catWater.showMask(.35, 1.3);
  // la foto entra con una animación: se vuelve a medir cuando termina
  setTimeout(drawCatShadow, 1700);
});

/* ---------------------------------------------------------
   Categoría 3: el reloj de la final corre mientras se ve el
   tablero (vuelve a cero al llegar al minuto)
   --------------------------------------------------------- */
const boardClock = $('[data-clock]');
if (boardClock && !reduceMotion && 'IntersectionObserver' in window) {
  let on = false;
  let t0 = 0;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = (now) => {
    if (!on) return;
    const cs = Math.floor(((now - t0) % 60000) / 10);
    boardClock.textContent = `0:${pad(Math.floor(cs / 100))}.${pad(cs % 100)}`;
    requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    const was = on;
    on = e.isIntersecting;
    if (on && !was) { t0 = performance.now(); requestAnimationFrame(tick); }
  }).observe(boardClock.closest('.fboard'));
}
