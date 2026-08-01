/* ミッション・レッドプラネット — 汎用ユーティリティ */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});

  /* --- 決定論的乱数 (mulberry32) --- */
  function makeRng(seed) {
    var a = seed >>> 0;
    function rnd() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    rnd.int = function (n) { return Math.floor(rnd() * n); };
    rnd.pick = function (arr) { return arr[rnd.int(arr.length)]; };
    rnd.shuffle = function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = rnd.int(i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    return rnd;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function sum(obj) {
    var s = 0; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) s += obj[k];
    return s;
  }

  /** オブジェクト {key: number} の最大値を取るキー群 */
  function argMaxKeys(obj) {
    var best = -Infinity, keys = [];
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v <= 0) continue;
      if (v > best) { best = v; keys = [k]; }
      else if (v === best) keys.push(k);
    }
    return { value: best === -Infinity ? 0 : best, keys: keys };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function polar(cx, cy, r, deg) {
    var a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  /** ドーナツ状セクターのパス */
  function ringSectorPath(cx, cy, r0, r1, a0, a1) {
    var p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, a1);
    var p2 = polar(cx, cy, r0, a1), p3 = polar(cx, cy, r0, a0);
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) +
      'A' + r1 + ',' + r1 + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) +
      'L' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2) +
      'A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + p3[0].toFixed(2) + ',' + p3[1].toFixed(2) + 'Z';
  }

  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  MRP.util = {
    makeRng: makeRng, sleep: sleep, clamp: clamp, sum: sum, argMaxKeys: argMaxKeys,
    el: el, svgEl: svgEl, polar: polar, ringSectorPath: ringSectorPath,
    reduceMotion: reduceMotion
  };
})(window);
