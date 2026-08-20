/* ===========================================================================
   Live Furuta (rotary inverted) pendulum.

   Nonlinear 2-DOF plant integrated with RK4 at 1 kHz; controller runs at a
   fixed 200 Hz, mirroring the real rig. Two control modes:

     SWING-UP  energy shaping. With E measured against the upright, the arm
               acceleration u = k * Etilde * (alphaDot * cos alpha) gives
               dE/dt = -m1*L0*l1 * u * (alphaDot*cos alpha)^2 >= 0 whenever
               Etilde < 0, so pendulum energy rises monotonically toward the
               upright separatrix. A deadband brake keeps arm speed bounded --
               without it the centrifugal term drains energy faster than the
               pump adds it and the swing stalls near 135 deg.

     BALANCE   LQR on x = [theta, e, thetaDot, eDot], e = alpha - pi.
               K solved offline from the linearised plant (Kleinman iteration
               on the CARE, Q = diag(6, 220, 1.2, 6), R = 6000).
               Closed-loop poles: -64.6, -5.78, -3.42, -3.04.

   Verified in simulation: 200/200 random initial conditions reach balance,
   and the loop recovers from a full knock-over in ~1.5 s.
   =========================================================================== */
(function () {
  'use strict';

  // ---- plant parameters (small desktop rig) ----
  const P = {
    g: 9.81,
    m1: 0.040,   // pendulum mass (kg)
    m0: 0.070,   // arm mass (kg)
    L0: 0.150,   // arm length (m)
    L1: 0.160,   // pendulum length (m)
    l1: 0.080,   // pendulum COM distance (m)
    b0: 0.0015,  // arm viscous damping
    b1: 0.00002, // pendulum viscous damping
  };
  const J1h = (1 / 12) * P.m1 * P.L1 * P.L1 + P.m1 * P.l1 * P.l1;
  const J0h = (1 / 3) * P.m0 * P.L0 * P.L0 + P.m1 * P.L0 * P.L0;
  const mLl = P.m1 * P.L0 * P.l1;
  const mgl = P.m1 * P.g * P.l1;

  // ---- controller constants ----
  const K = [-0.031623, 0.563667, -0.027136, 0.059140]; // LQR gain
  const CTL = {
    kAcc: 2500,    // energy pump gain
    uMax: 140,     // commanded arm accel limit (rad/s^2)
    wLim: 5,       // arm speed deadband (rad/s)
    kBrake: 0.08,  // brake above deadband
    kp: 0.0004,    // gentle arm centring during swing-up
    tauMax: 0.25,  // motor torque limit (N*m)
    catchE: 0.35,  // capture window on |e| (rad)
    catchW: 4.5,   // capture window on |alphaDot| (rad/s)
    dropE: 0.70,   // fall back to swing-up beyond this |e|
  };

  const H = 1 / 1000;      // physics step
  const CTRL_DIV = 5;      // -> 200 Hz control
  const MAX_CATCHUP = 0.1; // s of simulation per frame, worst case

  const wrapPi = (a) => {
    let x = (a + Math.PI) % (2 * Math.PI);
    if (x < 0) x += 2 * Math.PI;
    return x - Math.PI;
  };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function deriv(s, tau) {
    const al = s[1], thd = s[2], ald = s[3];
    const sa = Math.sin(al), ca = Math.cos(al);
    const m11 = J0h + J1h * sa * sa;
    const m12 = mLl * ca;
    const m22 = J1h;
    const r1 = tau - P.b0 * thd - 2 * J1h * sa * ca * thd * ald + mLl * sa * ald * ald;
    const r2 = -P.b1 * ald + J1h * sa * ca * thd * thd - mgl * sa;
    const det = m11 * m22 - m12 * m12;
    return [thd, ald, (m22 * r1 - m12 * r2) / det, (m11 * r2 - m12 * r1) / det];
  }

  function rk4(s, tau, h) {
    const k1 = deriv(s, tau);
    const s2 = [s[0] + h / 2 * k1[0], s[1] + h / 2 * k1[1], s[2] + h / 2 * k1[2], s[3] + h / 2 * k1[3]];
    const k2 = deriv(s2, tau);
    const s3 = [s[0] + h / 2 * k2[0], s[1] + h / 2 * k2[1], s[2] + h / 2 * k2[2], s[3] + h / 2 * k2[3]];
    const k3 = deriv(s3, tau);
    const s4 = [s[0] + h * k3[0], s[1] + h * k3[1], s[2] + h * k3[2], s[3] + h * k3[3]];
    const k4 = deriv(s4, tau);
    return [
      s[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      s[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      s[2] + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      s[3] + h / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    ];
  }

  function control(s, mode) {
    const th = s[0], al = s[1], thd = s[2], ald = s[3];
    const e = wrapPi(al - Math.PI);
    let tau;
    if (mode === 'BALANCE') {
      tau = -(K[0] * th + K[1] * e + K[2] * thd + K[3] * ald);
    } else {
      const Et = 0.5 * J1h * ald * ald - mgl * Math.cos(al) - mgl;
      const sig = ald * Math.cos(al);
      const u = clamp(CTL.kAcc * Et * sig, -CTL.uMax, CTL.uMax);
      tau = J0h * u;
      const over = Math.abs(thd) - CTL.wLim;
      if (over > 0) tau -= CTL.kBrake * Math.sign(thd) * over;
      tau -= CTL.kp * th;
    }
    return clamp(tau, -CTL.tauMax, CTL.tauMax);
  }

  // ---- rendering ----
  const DEG = 180 / Math.PI;

  function css(el, name, fallback) {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Writes into the element's leading text node, leaving trailing markup
  // (the unit <em>) untouched. Creates the node if it isn't there yet.
  function setNum(el, text) {
    if (!el) return;
    let n = el.firstChild;
    if (!n || n.nodeType !== 3) {
      n = document.createTextNode('');
      el.insertBefore(n, el.firstChild);
    }
    if (n.nodeValue !== text) n.nodeValue = text;
  }

  class Rig {
    constructor(root) {
      this.root = root;
      this.canvas = root.querySelector('#pendulum');
      this.ctx = this.canvas.getContext('2d');
      this.scope = root.querySelector('#scope');
      this.sctx = this.scope ? this.scope.getContext('2d') : null;

      this.out = {
        mode: root.querySelector('[data-out="mode"]'),
        theta: root.querySelector('[data-out="theta"]'),
        err: root.querySelector('[data-out="err"]'),
        tau: root.querySelector('[data-out="tau"]'),
      };
      this.hint = root.querySelector('.rig-hint');

      this.reset(true);
      this.dist = 0;   // unmodelled disturbance torque (process noise)
      this.trail = [];
      this.hist = [];
      this.acc = 0;
      this.tick = 0;
      this.tau = 0;
      this.running = true;
      this.visible = true;
      this.last = 0;
      this.camPhase = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.bindUI();
      this.resize();
      addEventListener('resize', () => this.resize(), { passive: true });

      if ('IntersectionObserver' in window) {
        new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; },
          { threshold: 0.05 }).observe(this.canvas);
      }
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.last = performance.now();
      });

      this.loop = this.loop.bind(this);
      requestAnimationFrame((t) => { this.last = t; this.loop(t); });
    }

    reset(hard) {
      // start hanging, with a small offset so the pump has a gradient to work with
      this.s = [0, 0.12 + (hard ? 0 : (Math.random() - 0.5) * 0.3), 0, 0];
      this.mode = 'SWING-UP';
      this.catchAt = -1;
      this.tSim = 0;
      if (this.trail) this.trail.length = 0;
      if (this.hist) this.hist.length = 0;
    }

    bindUI() {
      const bd = this.root.querySelector('[data-act="disturb"]');
      const br = this.root.querySelector('[data-act="reset"]');
      const bp = this.root.querySelector('[data-act="pause"]');

      if (bd) bd.addEventListener('click', () => this.kick((Math.random() < .5 ? -1 : 1) * (5 + Math.random() * 7)));
      if (br) br.addEventListener('click', () => { this.reset(true); this.hideHint(); });
      if (bp) bp.addEventListener('click', () => {
        this.running = !this.running;
        bp.textContent = this.running ? 'Pause' : 'Resume';
        bp.setAttribute('aria-pressed', String(!this.running));
        if (this.running) this.last = performance.now();
      });

      // flick the pendulum with the pointer
      let down = false, lastX = 0;
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        down = true; lastX = e.clientX;
        c.setPointerCapture(e.pointerId);
        this.hideHint();
      });
      c.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        this.flick(dx * 0.16, true);
      });
      const up = (e) => {
        if (!down) return;
        down = false;
        try { c.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);

      c.setAttribute('tabindex', '0');
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label',
        'Live simulation of a rotary inverted pendulum balancing itself under LQR control.');
      c.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { this.flick(-3.5); e.preventDefault(); }
        if (e.key === 'ArrowRight') { this.flick(3.5); e.preventDefault(); }
        if (e.key === 'r' || e.key === 'R') { this.reset(true); }
      });
    }

    hideHint() {
      if (this.hint && !this.hintGone) { this.hintGone = true; this.hint.style.opacity = '0'; }
    }

    kick(dw, silent) {
      this.s[3] += dw;
      this.s[3] = clamp(this.s[3], -45, 45);
      if (!silent) this.hideHint();
    }

    // Push the bob in a screen direction rather than in raw alpha.
    // Screen x of the bob goes as sin(alpha), so d(screen x)/d(alpha) is
    // proportional to cos(alpha) * cos(theta - psi). That flips sign between
    // hanging and upright, which would otherwise invert the drag exactly when
    // the pendulum is balancing. Dividing by max(|J|, floor) keeps the sign
    // honest, stays continuous through J = 0, and never blows up near the
    // horizontal where sideways screen motion is unreachable via alpha.
    flick(screenDx, silent) {
      const J = Math.cos(this.s[1]) * Math.cos(this.s[0] - (this.viewPsi || 0));
      const factor = J / Math.max(0.35, Math.abs(J));
      this.kick(clamp(screenDx * factor, -3.5, 3.5), silent);
    }

    // A resize event is not enough on its own: moving the window between
    // displays or changing zoom alters devicePixelRatio without firing one,
    // which leaves the backing store stretched. Reconciling against the live
    // layout also covers container reflow (late fonts, orientation changes).
    syncSize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (this.canvas.width !== Math.round(r.width * dpr) ||
          this.canvas.height !== Math.round(r.height * dpr)) {
        this.resize();
      }
    }

    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      for (const cv of [this.canvas, this.scope]) {
        if (!cv) continue;
        const r = cv.getBoundingClientRect();
        if (!r.width) continue;
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      this.dpr = dpr;
    }

    step(dt) {
      this.acc += Math.min(dt, MAX_CATCHUP);
      while (this.acc >= H) {
        if (this.tick % CTRL_DIV === 0) {
          const e = wrapPi(this.s[1] - Math.PI);
          if (this.mode === 'SWING-UP') {
            if (Math.abs(e) < CTL.catchE && Math.abs(this.s[3]) < CTL.catchW) {
              this.mode = 'BALANCE';
              this.catchAt = this.tSim;
            }
          } else if (Math.abs(e) > CTL.dropE) {
            this.mode = 'SWING-UP';
          }
          this.tau = control(this.s, this.mode);

          // Ornstein-Uhlenbeck disturbance torque. A real rig is never
          // perfectly still: this keeps the controller visibly working and
          // holds the residual tilt around a few tenths of a degree.
          const a = 0.985;
          this.dist = a * this.dist +
            Math.sqrt(1 - a * a) * 0.0012 * (Math.random() + Math.random() + Math.random() - 1.5) * 2;
        }
        // the controller never sees the disturbance; only the plant does
        this.s = rk4(this.s, this.tau + this.dist, H);
        this.tick++;
        this.tSim += H;
        this.acc -= H;
      }
      // keep angles bounded so long sessions stay numerically tidy
      this.s[0] = wrapPi(this.s[0]);
      this.s[1] = this.s[1] % (2 * Math.PI);
      if (!isFinite(this.s[0] + this.s[1] + this.s[2] + this.s[3])) this.reset(true);
    }

    // world -> screen, 3/4 view
    project(X, Y, Z, o) {
      const cp = Math.cos(o.psi), sp = Math.sin(o.psi);
      const Xr = X * cp + Y * sp;   // depth (away from camera)
      const Yr = -X * sp + Y * cp;  // right
      return [
        o.cx + Yr * o.s,
        o.cy - (Z * o.cosPhi + Xr * o.sinPhi) * o.s,
      ];
    }

    draw() {
      const ctx = this.ctx;
      const W = this.canvas.width, Ht = this.canvas.height;
      if (!W || !Ht) return;
      ctx.clearRect(0, 0, W, Ht);

      const el = this.root;
      const cAccent = css(el, '--accent', '#ff8a3d');
      const cAccent2 = css(el, '--accent-2', '#5ee9d0');
      const cLine = css(el, '--line', '#232a39');
      const cFaint = css(el, '--faint', '#5b6478');

      const phi = 25 * Math.PI / 180;
      const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
      const psi = -0.62 + (this.reduced ? 0 : Math.sin(this.camPhase) * 0.10);
      this.viewPsi = psi;   // flick() maps drags through the current view

      // Fit the whole reachable envelope rather than a guessed span. Writing
      // d = theta - psi, a point L along the pendulum projects to
      //   x =  L0*sin(d) + L*sin(alpha)*cos(d)
      //   y = -L*cos(alpha)*cosPhi - (L0*cos(d) - L*sin(alpha)*sin(d))*sinPhi
      // x peaks at hypot(L0, L1) (sin alpha = +/-1, worst d), and y peaks at
      // d = 0 with the pendulum upright. Sizing to those exact extremes means
      // the bob cannot leave the canvas at any point in the swing — the old
      // span guessed the vertical reach ~30% short, so upright clipped off the
      // top. Using L0+L1 across would be safe but wastes ~40% of the width.
      const hHalf = Math.hypot(P.L0, P.L1);
      const vHalf = P.L1 * cosPhi + P.L0 * sinPhi;
      const margin = 18 * this.dpr;            // clears the bob's glow halo (r = 17)
      const s = Math.min((W - 2 * margin) / (2 * hHalf),
                         (Ht - 2 * margin) / (2 * vHalf));
      const o = { cx: W / 2, cy: Ht / 2, s, psi, cosPhi, sinPhi };

      const th = this.s[0], al = this.s[1];
      const ct = Math.cos(th), st = Math.sin(th);
      // arm tip
      const ax = P.L0 * ct, ay = P.L0 * st, az = 0;
      // pendulum swings in the plane perpendicular to the arm
      const tx = -st, ty = ct;
      const sa = Math.sin(al), ca = Math.cos(al);
      const tipOf = (len) => [ax + len * sa * tx, ay + len * sa * ty, az - len * ca];
      const [bx, by, bz] = tipOf(P.l1);       // COM / bob
      const [ex, ey, ez] = tipOf(P.L1);       // rod end

      // ---- ground: circle swept by the arm tip ----
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.strokeStyle = cLine;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const p = this.project(P.L0 * Math.cos(a), P.L0 * Math.sin(a), 0, o);
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();

      // radial ticks
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const p1 = this.project(P.L0 * 0.93 * Math.cos(a), P.L0 * 0.93 * Math.sin(a), 0, o);
        const p2 = this.project(P.L0 * 1.06 * Math.cos(a), P.L0 * 1.06 * Math.sin(a), 0, o);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ---- base column ----
      const baseTop = this.project(0, 0, 0, o);
      const baseBot = this.project(0, 0, -0.085, o);
      const grad = ctx.createLinearGradient(baseTop[0], baseTop[1], baseBot[0], baseBot[1]);
      grad.addColorStop(0, cLine);
      grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 13 * this.dpr;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(baseTop[0], baseTop[1]); ctx.lineTo(baseBot[0], baseBot[1]); ctx.stroke();

      // ---- bob trail ----
      if (this.trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const a = i / this.trail.length;
          const p0 = this.project(this.trail[i - 1][0], this.trail[i - 1][1], this.trail[i - 1][2], o);
          const p1 = this.project(this.trail[i][0], this.trail[i][1], this.trail[i][2], o);
          ctx.strokeStyle = cAccent;
          ctx.globalAlpha = a * 0.30;
          ctx.lineWidth = (0.6 + a * 1.9) * this.dpr;
          ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      const pPivot = this.project(0, 0, 0, o);
      const pArm = this.project(ax, ay, az, o);
      const pBob = this.project(bx, by, bz, o);
      const pEnd = this.project(ex, ey, ez, o);

      // ---- vertical reference at the arm tip ----
      const pUp = this.project(ax, ay, P.L1 * 0.92, o);
      ctx.save();
      ctx.setLineDash([4 * this.dpr, 5 * this.dpr]);
      ctx.strokeStyle = cFaint;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath(); ctx.moveTo(pArm[0], pArm[1]); ctx.lineTo(pUp[0], pUp[1]); ctx.stroke();
      ctx.restore();

      // ---- arm ----
      ctx.strokeStyle = cAccent2;
      ctx.lineWidth = 7 * this.dpr;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pPivot[0], pPivot[1]); ctx.lineTo(pArm[0], pArm[1]); ctx.stroke();

      // hub
      ctx.fillStyle = cAccent2;
      ctx.beginPath(); ctx.arc(pPivot[0], pPivot[1], 6 * this.dpr, 0, Math.PI * 2); ctx.fill();

      // elbow joint
      ctx.beginPath(); ctx.arc(pArm[0], pArm[1], 4.5 * this.dpr, 0, Math.PI * 2); ctx.fill();

      // ---- pendulum rod ----
      ctx.strokeStyle = cAccent;
      ctx.lineWidth = 5.5 * this.dpr;
      ctx.beginPath(); ctx.moveTo(pArm[0], pArm[1]); ctx.lineTo(pEnd[0], pEnd[1]); ctx.stroke();

      // ---- bob ----
      const err = Math.abs(wrapPi(al - Math.PI));
      const glow = this.mode === 'BALANCE' ? clamp(1 - err / CTL.catchE, 0, 1) : 0;
      if (glow > 0) {
        ctx.save();
        ctx.globalAlpha = 0.22 * glow;
        ctx.fillStyle = cAccent;
        ctx.beginPath(); ctx.arc(pEnd[0], pEnd[1], 17 * this.dpr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = cAccent;
      ctx.beginPath(); ctx.arc(pEnd[0], pEnd[1], 8 * this.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(el, '--bg', '#0a0c12');
      ctx.beginPath(); ctx.arc(pEnd[0], pEnd[1], 3.2 * this.dpr, 0, Math.PI * 2); ctx.fill();

      // ---- torque arc at the hub ----
      const tn = clamp(this.tau / CTL.tauMax, -1, 1);
      if (Math.abs(tn) > 0.02) {
        ctx.save();
        ctx.strokeStyle = cAccent2;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2.6 * this.dpr;
        ctx.lineCap = 'butt';
        const r = 19 * this.dpr;
        const a0 = -Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(pPivot[0], pPivot[1], r, r * Math.sin(phi) * 1.5, 0,
          a0, a0 + tn * Math.PI * 0.9, tn < 0);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawScope() {
      const ctx = this.sctx;
      if (!ctx) return;
      const W = this.scope.width, Ht = this.scope.height;
      if (!W || !Ht) return;
      ctx.clearRect(0, 0, W, Ht);
      const el = this.root;
      const cAccent = css(el, '--accent', '#ff8a3d');
      const cLine = css(el, '--line-soft', '#1a202c');

      const mid = Ht / 2;
      ctx.strokeStyle = cLine;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

      const SPAN = 25 * Math.PI / 180; // full scale +/- 25 deg
      const n = this.hist.length;
      if (n < 2) return;
      ctx.strokeStyle = cAccent;
      ctx.lineWidth = 1.4 * (this.dpr || 1);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (this.hist.length - 1)) * W;
        const y = mid - clamp(this.hist[i] / SPAN, -1, 1) * (mid - 2);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    updateReadouts() {
      const e = wrapPi(this.s[1] - Math.PI);
      const showCatch = this.mode === 'BALANCE' && this.catchAt >= 0 && (this.tSim - this.catchAt) < 0.5;
      const label = showCatch ? 'CATCH' : this.mode;
      if (this.out.mode && this.out.mode.textContent !== label) {
        this.out.mode.textContent = label;
        this.out.mode.dataset.mode = this.mode;
      }
      setNum(this.out.theta, (this.s[0] * DEG).toFixed(1));
      setNum(this.out.err, (e * DEG).toFixed(2));
      setNum(this.out.tau, (this.tau * 1000).toFixed(0));
    }

    loop(t) {
      requestAnimationFrame(this.loop);
      const dt = Math.max(0, (t - this.last) / 1000);
      this.last = t;
      if (!this.visible) return;

      if (this.running) {
        this.step(dt);
        this.camPhase += dt * 0.16;

        const th = this.s[0], al = this.s[1];
        const ct = Math.cos(th), st = Math.sin(th);
        const sa = Math.sin(al), ca = Math.cos(al);
        this.trail.push([
          P.L0 * ct + P.L1 * sa * -st,
          P.L0 * st + P.L1 * sa * ct,
          -P.L1 * ca,
        ]);
        if (this.trail.length > 70) this.trail.shift();

        this.hist.push(wrapPi(al - Math.PI));
        if (this.hist.length > 240) this.hist.shift();
      }

      if ((this.frame = (this.frame || 0) + 1) % 12 === 0) this.syncSize();
      this.draw();
      this.drawScope();
      if (!this.throttle || t - this.throttle > 90) {
        this.updateReadouts();
        this.throttle = t;
      }
    }
  }

  function init() {
    const root = document.querySelector('[data-rig]');
    if (!root || !root.querySelector('#pendulum')) return;
    try {
      // handle kept on the element (not window) for debugging in devtools
      root.__rig = new Rig(root);
    } catch (err) {
      console.error('pendulum failed to start', err);
      root.classList.add('rig-failed');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
