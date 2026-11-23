// Animated wind particles circling a wavy polar jet, viewed from above the pole.
// Velocity comes from a streamfunction psi = tanh((r - r0(theta, t)) / sigma),
// where r0 wobbles with slowly drifting wavenumber-2 and -3 planetary waves.
(function () {
  const canvas = document.getElementById("vortex");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w, h, cx, cy, scale, dpr, particles = [], t = 0, running = true;

  function psi(x, y) {
    const dx = (x - cx) / scale, dy = (y - cy) / scale;
    const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const r0 = 0.55 * (1 + 0.16 * Math.cos(2 * th - 0.25 * t) + 0.07 * Math.cos(3 * th + 0.4 * t + 1));
    return Math.tanh((r - r0) / 0.09) + 0.35 * r * r;
  }

  function velocity(x, y) {
    const e = 1.5;
    const u = (psi(x, y + e) - psi(x, y - e)) / (2 * e);
    const v = -(psi(x + e, y) - psi(x - e, y)) / (2 * e);
    return [u * scale * 0.9, v * scale * 0.9];
  }

  function spawn(p) {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
    p.age = 0;
    p.life = 60 + Math.random() * 140;
    return p;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h / 2;
    scale = Math.min(w, h) * 0.62;
    const n = Math.round(Math.min(2200, (w * h) / 450));
    particles = Array.from({ length: n }, () => spawn({}));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  function step() {
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.955)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;

    for (const p of particles) {
      const [u, v] = velocity(p.x, p.y);
      const speed = Math.hypot(u, v);
      const nx = p.x + u * 0.14, ny = p.y + v * 0.14;
      const a = Math.min(1, speed / 9) * Math.sin(Math.PI * p.age / p.life);
      ctx.strokeStyle = `rgba(${200 + 55 * a | 0}, ${225 + 30 * a | 0}, 255, ${0.15 + 0.6 * a})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      p.x = nx; p.y = ny;
      if (++p.age > p.life || nx < 0 || ny < 0 || nx > w || ny > h) spawn(p);
    }
    t += 0.016;
  }

  function loop() {
    if (running) step();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);

  if (reduceMotion) {
    for (let i = 0; i < 120; i++) step();
    return;
  }

  new IntersectionObserver(([e]) => { running = e.isIntersecting; }).observe(canvas);
  document.addEventListener("visibilitychange", () => { running = !document.hidden; });
  loop();
})();
