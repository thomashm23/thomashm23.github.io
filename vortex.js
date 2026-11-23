// Wind particles over the north polar stratosphere.
// Plays ERA5 10 hPa winds from data/vortex/ (made by scripts/prep_vortex_data.py),
// looping through the frames in time. If the data can't be loaded, it falls
// back to an idealized wavy polar jet.
(function () {
  const canvas = document.getElementById("vortex");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const label = document.getElementById("vortex-date");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const DAYS_PER_SECOND = 2.5; // playback speed for daily data
  let w, h, cx, cy, R, particles = [], t = 0, running = true;
  let field = null; // set by the data or the fallback

  // ---------- Fallback: idealized jet from a streamfunction ----------
  const ideal = {
    psi(x, y) {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      const r0 = 0.55 * (1 + 0.16 * Math.cos(2 * th - 0.25 * t) + 0.07 * Math.cos(3 * th + 0.4 * t + 1));
      return Math.tanh((r - r0) / 0.09) + 0.35 * r * r;
    },
    velocity(x, y) {
      const e = 1.5, k = R * 0.9 * 0.14;
      return [
        (this.psi(x, y + e) - this.psi(x, y - e)) / (2 * e) * k,
        -(this.psi(x + e, y) - this.psi(x - e, y)) / (2 * e) * k,
      ];
    },
    refSpeed: 9 * 0.14,
    inDomain: () => true,
    advance() { t += 0.016; },
  };

  // ---------- Real data ----------
  function makeDataField(meta, bytes) {
    const N = meta.size, F = meta.frames, q = new Int8Array(bytes);
    const frameLen = N * N * 2;
    const toPx = 0.025;            // screen pixels per frame per (m/s) at R = 400px
    let time = 0;                  // fractional frame index
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

    function sample(f, gx, gy, c) {
      const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
      const base = f * frameLen;
      const at = (ii, jj) => q[base + ((Math.min(jj, N - 1) * N) + Math.min(ii, N - 1)) * 2 + c];
      return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) +
             (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
    }

    return {
      velocity(x, y) {
        const gx = ((x - cx) / R + 1) / 2 * (N - 1), gy = ((y - cy) / R + 1) / 2 * (N - 1);
        if (gx < 0 || gy < 0 || gx > N - 1 || gy > N - 1) return [0, 0];
        const f0 = Math.floor(time) % F, f1 = (f0 + 1) % F, a = time - Math.floor(time);
        const k = meta.scale * toPx * R / 400;
        const u = sample(f0, gx, gy, 0) * (1 - a) + sample(f1, gx, gy, 0) * a;
        const v = sample(f0, gx, gy, 1) * (1 - a) + sample(f1, gx, gy, 1) * a;
        return [u * k, v * k];
      },
      refSpeed: 60 * toPx,         // 60 m/s draws at full brightness
      scaleRef: () => R / 400,
      inDomain: (x, y) => Math.hypot(x - cx, y - cy) < R,
      advance() {
        time = (time + DAYS_PER_SECOND * (24 / meta.hours) / 60) % F;
        if (label) {
          const d = meta.dates[Math.floor(time)];
          label.textContent = fmt.format(new Date(d + "Z"));
        }
      },
    };
  }

  // ---------- Particle engine ----------
  function spawn(p) {
    do {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
    } while (!field.inDomain(p.x, p.y));
    p.age = 0;
    p.life = 60 + Math.random() * 140;
    return p;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h / 2;
    R = field === ideal ? Math.min(w, h) * 0.62 : Math.max(Math.min(w, h) * 0.62, Math.max(w, h) * 0.42);
    const n = Math.round(Math.min(2600, (w * h) / 380));
    particles = Array.from({ length: n }, () => spawn({}));
    ctx.clearRect(0, 0, w, h);
  }

  function step() {
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0,0,0,0.955)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;

    const ref = field.refSpeed * (field.scaleRef ? field.scaleRef() : 1);
    for (const p of particles) {
      const [u, v] = field.velocity(p.x, p.y);
      const nx = p.x + u, ny = p.y + v;
      const a = Math.min(1, Math.hypot(u, v) / ref) * Math.sin(Math.PI * p.age / p.life);
      ctx.strokeStyle = `rgba(${200 + 55 * a | 0}, ${225 + 30 * a | 0}, 255, ${0.12 + 0.63 * a})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      p.x = nx; p.y = ny;
      if (++p.age > p.life || !field.inDomain(nx, ny) || nx < 0 || ny < 0 || nx > w || ny > h) spawn(p);
    }
    field.advance();
  }

  function loop() {
    if (running) step();
    requestAnimationFrame(loop);
  }

  function start(f) {
    field = f;
    resize();
    window.addEventListener("resize", resize);
    if (reduceMotion) {
      for (let i = 0; i < 120; i++) step();
      return;
    }
    new IntersectionObserver(([e]) => { running = e.isIntersecting; }).observe(canvas);
    document.addEventListener("visibilitychange", () => { running = !document.hidden; });
    loop();
  }

  Promise.all([
    fetch("data/vortex/meta.json").then(r => { if (!r.ok) throw r.status; return r.json(); }),
    fetch("data/vortex/winds.bin").then(r => { if (!r.ok) throw r.status; return r.arrayBuffer(); }),
  ]).then(([meta, bytes]) => {
    document.body.classList.add("has-vortex-data");
    start(makeDataField(meta, bytes));
  }).catch(() => start(ideal));
})();
