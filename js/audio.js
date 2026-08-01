/* ミッション・レッドプラネット — 効果音（Web Audio による合成・音声ファイル不要） */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});

  function Audio() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.ambientOn = true;
    this._ambient = null;
    this._noiseBuf = null;
  }

  Audio.prototype.init = function () {
    if (this.ctx) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  };

  Audio.prototype.resume = function () {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.ambientOn) this.startAmbient();
  };

  Audio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
    if (on) this.resume(); else this.stopAmbient();
  };

  Audio.prototype.noise = function () {
    if (this._noiseBuf) return this._noiseBuf;
    var len = this.ctx.sampleRate * 2;
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  };

  Audio.prototype._env = function (node, t0, a, d, peak) {
    var g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  };

  /** 単純なトーン */
  Audio.prototype.tone = function (freq, dur, opts) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    opts = opts || {};
    var t0 = this.ctx.currentTime + (opts.delay || 0);
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    this._env(gain, t0, opts.attack || 0.008, dur, opts.gain || 0.18);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.08);
  };

  /** ノイズバースト（フィルター付き） */
  Audio.prototype.burst = function (dur, opts) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    opts = opts || {};
    var t0 = this.ctx.currentTime + (opts.delay || 0);
    var src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    var filt = this.ctx.createBiquadFilter();
    filt.type = opts.filter || 'bandpass';
    filt.frequency.setValueAtTime(opts.from || 800, t0);
    filt.frequency.exponentialRampToValueAtTime(opts.toFreq || 200, t0 + dur);
    filt.Q.value = opts.q || 1.2;
    var gain = this.ctx.createGain();
    this._env(gain, t0, opts.attack || 0.01, dur, opts.gain || 0.16);
    src.connect(filt).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  };

  /* ---------- ゲーム内の効果音 ---------- */

  Audio.prototype.click = function () { this.tone(620, 0.05, { type: 'triangle', gain: 0.08 }); };
  Audio.prototype.hover = function () { this.tone(880, 0.03, { type: 'sine', gain: 0.03 }); };
  Audio.prototype.flip = function () {
    this.burst(0.09, { from: 2400, toFreq: 700, gain: 0.09, filter: 'bandpass', q: 0.9 });
  };
  Audio.prototype.place = function () {
    this.tone(320, 0.09, { type: 'triangle', to: 440, gain: 0.12 });
    this.tone(660, 0.06, { type: 'sine', gain: 0.05, delay: 0.03 });
  };
  Audio.prototype.launch = function () {
    this.burst(0.85, { from: 320, toFreq: 2600, gain: 0.2, filter: 'lowpass', q: 0.7 });
    this.tone(110, 0.7, { type: 'sawtooth', to: 420, gain: 0.09 });
  };
  Audio.prototype.land = function () {
    this.burst(0.35, { from: 1400, toFreq: 120, gain: 0.16, filter: 'lowpass' });
    this.tone(180, 0.25, { type: 'sine', to: 90, gain: 0.12 });
  };
  Audio.prototype.explode = function () {
    this.burst(0.6, { from: 1800, toFreq: 60, gain: 0.3, filter: 'lowpass', q: 0.5 });
    this.tone(70, 0.5, { type: 'square', to: 30, gain: 0.14 });
  };
  Audio.prototype.kill = function () {
    this.tone(420, 0.28, { type: 'sawtooth', to: 90, gain: 0.12 });
  };
  Audio.prototype.coin = function (i) {
    var base = [784, 988, 1175][(i || 0) % 3];
    this.tone(base, 0.16, { type: 'triangle', gain: 0.09, delay: (i || 0) * 0.055 });
  };
  Audio.prototype.phase = function () {
    var self = this;
    [392, 523, 659, 784].forEach(function (f, i) {
      self.tone(f, 0.34, { type: 'sine', gain: 0.09, delay: i * 0.085 });
    });
  };
  Audio.prototype.fanfare = function () {
    var self = this;
    [523, 659, 784, 1047, 1319].forEach(function (f, i) {
      self.tone(f, 0.5, { type: 'triangle', gain: 0.11, delay: i * 0.12 });
    });
  };
  Audio.prototype.bad = function () {
    this.tone(200, 0.45, { type: 'sawtooth', to: 70, gain: 0.1 });
  };

  /* ---------- 環境音（低いドローン） ---------- */

  Audio.prototype.startAmbient = function () {
    if (!this.enabled || this._ambient) return;
    this.init();
    if (!this.ctx) return;
    var ctx = this.ctx;
    var g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 3);
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 260;

    var oscs = [55, 82.5, 110.3].map(function (f) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(filt);
      o.start();
      return o;
    });
    /* ゆっくりしたうねり */
    var lfo = ctx.createOscillator();
    var lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(filt.frequency);
    lfo.start();

    filt.connect(g).connect(this.master);
    this._ambient = { oscs: oscs, lfo: lfo, gain: g };
  };

  Audio.prototype.stopAmbient = function () {
    if (!this._ambient) return;
    var a = this._ambient, ctx = this.ctx;
    try {
      a.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      a.oscs.forEach(function (o) { o.stop(ctx.currentTime + 0.8); });
      a.lfo.stop(ctx.currentTime + 0.8);
    } catch (e) { /* noop */ }
    this._ambient = null;
  };

  Audio.prototype.setAmbient = function (on) {
    this.ambientOn = on;
    if (on) this.startAmbient(); else this.stopAmbient();
  };

  MRP.audio = new Audio();
})(window);
