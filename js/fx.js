/* ミッション・レッドプラネット — 演出（星空・パーティクル・バナー） */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});
  var U = MRP.util;

  var layer = null;
  function fxLayer() {
    if (!layer) layer = document.getElementById('fxLayer');
    return layer;
  }

  /* ==================== 星空 ==================== */

  function Starfield(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.shooting = null;
    this.raf = null;
    this.last = 0;
    this.resize();
    var self = this;
    global.addEventListener('resize', function () { self.resize(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) self.stop(); else self.start();
    });
  }

  Starfield.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = this.c.clientWidth || global.innerWidth;
    var h = this.c.clientHeight || global.innerHeight;
    this.c.width = w * dpr;
    this.c.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    var n = U.reduceMotion ? 90 : Math.min(190, Math.round((w * h) / 9000));
    this.stars = [];
    for (var i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.25 + 0.35,
        a: Math.random() * 0.6 + 0.25,
        tw: Math.random() * Math.PI * 2,
        sp: Math.random() * 0.5 + 0.12,
        hue: Math.random() < 0.15 ? 20 : (Math.random() < 0.2 ? 200 : 45)
      });
    }
  };

  Starfield.prototype.start = function () {
    if (this.raf) return;
    var self = this;
    this.last = performance.now();
    var loop = function (t) {
      var dt = Math.min(64, t - self.last);
      self.last = t;
      self.draw(dt);
      self.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  };

  Starfield.prototype.stop = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  Starfield.prototype.draw = function (dt) {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      s.tw += dt * 0.0016 * s.sp;
      s.y += dt * 0.004 * s.sp;
      if (s.y > h + 2) { s.y = -2; s.x = Math.random() * w; }
      var a = s.a * (0.62 + 0.38 * Math.sin(s.tw));
      ctx.beginPath();
      ctx.fillStyle = 'hsla(' + s.hue + ',70%,88%,' + a.toFixed(3) + ')';
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
    }
    if (!U.reduceMotion) {
      if (!this.shooting && Math.random() < 0.0016) {
        this.shooting = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.35, life: 1 };
      }
      if (this.shooting) {
        var sh = this.shooting;
        sh.x += dt * 0.75; sh.y += dt * 0.28; sh.life -= dt * 0.0013;
        if (sh.life <= 0 || sh.x > w) this.shooting = null;
        else {
          var grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - 90, sh.y - 34);
          grad.addColorStop(0, 'rgba(255,235,200,' + (0.85 * sh.life).toFixed(3) + ')');
          grad.addColorStop(1, 'rgba(255,235,200,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(sh.x, sh.y);
          ctx.lineTo(sh.x - 90, sh.y - 34);
          ctx.stroke();
        }
      }
    }
  };

  /* ==================== パーティクル ==================== */

  function burst(x, y, color, count, opts) {
    if (U.reduceMotion) return;
    opts = opts || {};
    var L = fxLayer();
    if (!L) return;
    var n = Math.min(count || 10, 16);
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.className = 'particle';
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var dist = (opts.dist || 46) * (0.5 + Math.random());
      var size = (opts.size || 6) * (0.6 + Math.random() * 0.8);
      p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size +
        'px;background:' + color + ';--dx:' + (Math.cos(ang) * dist).toFixed(1) +
        'px;--dy:' + (Math.sin(ang) * dist).toFixed(1) + 'px;--dur:' + (opts.dur || 620) + 'ms';
      L.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, (opts.dur || 620) + 60); })(p);
    }
  }

  /** 要素／座標から座標へ小さな光点を飛ばす */
  function fly(from, to, color, opts) {
    opts = opts || {};
    var L = fxLayer();
    var dur = U.reduceMotion ? 1 : (opts.dur || 620);
    if (!L) return U.sleep(dur);
    var e = document.createElement('i');
    e.className = 'flyer' + (opts.cls ? ' ' + opts.cls : '');
    var s = opts.size || 14;
    e.style.cssText = 'left:' + from.x + 'px;top:' + from.y + 'px;width:' + s + 'px;height:' + s +
      'px;background:' + color + ';transition-duration:' + dur + 'ms';
    if (opts.glyph) e.textContent = opts.glyph;
    L.appendChild(e);
    /* reflow を挟んでからトランジションを開始 */
    void e.offsetWidth;
    e.style.transform = 'translate(' + (to.x - from.x) + 'px,' + (to.y - from.y) + 'px) scale(' + (opts.scale || 1) + ')';
    e.style.opacity = opts.fade === false ? '1' : '0.15';
    return U.sleep(dur).then(function () { e.remove(); });
  }

  function floatText(x, y, text, cls) {
    var L = fxLayer();
    if (!L) return;
    var e = document.createElement('div');
    e.className = 'floattext ' + (cls || '');
    e.textContent = text;
    e.style.left = x + 'px';
    e.style.top = y + 'px';
    L.appendChild(e);
    setTimeout(function () { e.remove(); }, 1300);
  }

  function banner(title, sub, ms) {
    var L = fxLayer();
    var dur = U.reduceMotion ? 260 : (ms || 1150);
    if (!L) return U.sleep(dur);
    var e = document.createElement('div');
    e.className = 'banner';
    var h = document.createElement('div');
    h.className = 'banner-title';
    h.textContent = title;
    e.appendChild(h);
    if (sub) {
      var s = document.createElement('div');
      s.className = 'banner-sub';
      s.textContent = sub;
      e.appendChild(s);
    }
    L.appendChild(e);
    return U.sleep(dur).then(function () {
      e.classList.add('out');
      setTimeout(function () { e.remove(); }, 320);
    });
  }

  function shake(el) {
    if (!el || U.reduceMotion) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(function () { el.classList.remove('shake'); }, 500);
  }

  /** 要素の中心座標（ビューポート基準） */
  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** SVG 内の座標をビューポート座標へ変換 */
  function svgPoint(svg, x, y) {
    var pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    var m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    var p = pt.matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  MRP.fx = {
    Starfield: Starfield, burst: burst, fly: fly, floatText: floatText,
    banner: banner, shake: shake, centerOf: centerOf, svgPoint: svgPoint
  };
})(window);
