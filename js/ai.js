/* ミッション・レッドプラネット — ルールベース AI（初級） */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});
  var D = MRP.data, U = MRP.util;

  function AIAgent(pid, rng, opts) {
    this.pid = pid;
    this.rng = rng;
    this.delay = (opts && opts.delay != null) ? opts.delay : 260;
  }

  /* ---------- 評価用の小道具 ---------- */

  /** 残り生産フェイズの重み（早い段階ほどエリアの価値が高い） */
  function phaseWeight(st) {
    if (st.trackIndex <= 4) return 6;   // 生産 1・2・3 が残っている
    if (st.trackIndex <= 8) return 5;   // 生産 2・3
    return 3;                           // 生産 3 のみ
  }

  function zoneValue(st, zid) {
    var z = st.zones[zid];
    var base = z.revealed ? D.RESOURCES[z.resource].value : 1.73;
    var pend = z.pending.ice + z.pending.sylvanite * 2 + z.pending.celerium * 3;
    return base * phaseWeight(st) + pend;
  }

  /** counts の中で pid が得るトークンの割合（0 / 1/t / 1） */
  function share(counts, pid) {
    var best = 0, tied = 0, mine = counts[pid] || 0;
    for (var k in counts) if (counts[k] > best) best = counts[k];
    if (!best || mine < best) return 0;
    for (var k2 in counts) if (counts[k2] === best) tied++;
    return 1 / tied;
  }

  function zoneCounts(st, zid) {
    var out = {};
    var a = st.zones[zid].astronauts;
    for (var k in a) if (a[k] > 0) out[k] = a[k];
    return out;
  }

  /** エリアに delta 体を足したときの期待利得 */
  function deltaValue(st, zid, pid, delta, extraCounts) {
    var c = zoneCounts(st, zid);
    if (extraCounts) for (var k in extraCounts) c[k] = (c[k] || 0) + extraCounts[k];
    var before = share(c, pid);
    c[pid] = (c[pid] || 0) + delta;
    if (c[pid] <= 0) delete c[pid];
    var after = share(c, pid);
    return zoneValue(st, zid) * (after - before);
  }

  function seatCounts(ship, exclude) {
    var out = {};
    ship.seats.forEach(function (o) { if (o !== exclude) out[o] = (out[o] || 0) + 1; });
    return out;
  }

  function effDest(ship) { return ship.destToken || ship.dest; }

  /** ドック中の宇宙船に 1 体乗せたときの評価値 */
  function shipGain(st, pid, ship) {
    var dest = effDest(ship);
    var best;
    if (dest) {
      best = deltaValue(st, dest, pid, 1, seatCounts(ship));
    } else {
      /* 目的地未定：最も都合のよい行き先を選べる分だけ価値が高い */
      best = -Infinity;
      D.ZONE_ORDER.forEach(function (z) {
        if ((st.destTokensUsed[z] || 0) >= 2) return;
        var v = deltaValue(st, z, pid, 1, seatCounts(ship));
        if (v > best) best = v;
      });
      if (best === -Infinity) best = 0;
      best += 1.2; // 行き先を自分で決められるボーナス
    }
    var left = ship.cap - ship.seats.length - 1;
    if (left <= 0) best *= 1.18;                 // すぐ発射＝早く着陸できる
    else best *= 1 - Math.min(0.35, left * 0.09); // 満席まで遠いほど不確実
    if (st.round >= 10 && left > 0) best *= 0.15; // 最終ラウンドは飛ばない船に意味がない
    return best;
  }

  function bestShip(st, pid, ships) {
    var best = null, bv = -Infinity;
    ships.forEach(function (s) {
      var v = shipGain(st, pid, s);
      if (v > bv) { bv = v; best = s; }
    });
    return { ship: best, value: bv === -Infinity ? 0 : bv };
  }

  /* ---------- キャラクター選択 ---------- */

  AIAgent.prototype.scoreCharacter = function (st, pid, num) {
    var me = st.players[pid];
    var docked = st.docks.filter(Boolean);
    var b = bestShip(st, pid, docked);
    var place = function (n) {
      if (!docked.length || me.astronautsLeft <= 0) return 0;
      /* 2 体目以降はやや逓減する */
      var v = 0;
      for (var i = 0; i < n; i++) v += b.value * Math.pow(0.82, i);
      return v;
    };
    var self = this;

    switch (num) {
      case 9: { // リクルーター
        var refresh = me.played.length >= 5 ? 7 : me.played.length * 0.9;
        if (me.hand.length <= 2) refresh += 6;
        return place(1) + refresh;
      }
      case 8: { // 探検家
        return place(1) + this.bestMoveChain(st, pid, 3);
      }
      case 7: // 科学者
        return place(2) + 2.6;
      case 6: { // 秘密諜報員
        var force = 0;
        docked.forEach(function (s) {
          var dest = effDest(s);
          if (!dest || !s.seats.length) return;
          var mine = s.seats.filter(function (o) { return o === pid; }).length;
          if (!mine) return;
          var g = deltaValue(st, dest, pid, mine, seatCounts(s, pid));
          if (g > force) force = g * 0.65;
        });
        return place(2) + force;
      }
      case 5: { // 工作員
        var sab = 0;
        docked.forEach(function (s) {
          var mine = s.seats.filter(function (o) { return o === pid; }).length;
          var theirs = s.seats.length - mine;
          var dest = effDest(s);
          var threat = theirs * 1.6 - mine * 3.0;
          if (dest) threat += Math.max(0, -deltaValue(st, dest, pid, 0, seatCounts(s))) ;
          if (threat > sab) sab = threat;
        });
        return place(1) + sab;
      }
      case 4: { // ファム・ファタール
        return place(1) + this.bestReplaceValue(st, pid);
      }
      case 3: { // 旅行代理店
        var big = docked.filter(function (s) { return s.cap - s.seats.length >= 3; });
        if (!big.length || me.astronautsLeft < 3) return -3;
        var bb = bestShip(st, pid, big);
        return bb.value * 2.4;
      }
      case 2: { // 軍人
        var pair = docked.filter(function (s) { return s.cap - s.seats.length >= 2; });
        var pv = pair.length ? bestShip(st, pid, pair).value * 1.75 : place(1);
        return pv + this.bestKillValue(st, pid);
      }
      case 1: { // パイロット
        return place(2) + this.bestRetargetValue(st, pid) + 0.5;
      }
    }
    return 0;
  };

  /** 探検家：貪欲に最大 n 回移動したときの合計利得 */
  AIAgent.prototype.bestMoveChain = function (st, pid, n) {
    var total = 0;
    var sim = {};
    D.ZONE_ORDER.forEach(function (z) { sim[z] = (st.zones[z].astronauts[pid] || 0); });
    for (var i = 0; i < n; i++) {
      var best = null, bv = 0.35;
      D.ZONE_ORDER.forEach(function (from) {
        if (D.ZONES[from].phobos || sim[from] <= 0) return;
        D.ZONES[from].adj.forEach(function (to) {
          var v = deltaValue(st, to, pid, 1) + deltaValue(st, from, pid, -1);
          if (v > bv) { bv = v; best = { from: from, to: to, v: v }; }
        });
      });
      if (!best) break;
      sim[best.from]--; sim[best.to]++;
      total += best.v;
    }
    return total;
  };

  AIAgent.prototype.bestReplaceValue = function (st, pid) {
    var best = 0;
    D.ZONE_ORDER.forEach(function (z) {
      if ((st.zones[z].astronauts[pid] || 0) <= 0) return;
      Object.keys(st.zones[z].astronauts).forEach(function (o) {
        if (+o === pid || st.zones[z].astronauts[o] <= 0) return;
        var v = deltaValue(st, z, pid, 1) - deltaValue(st, z, +o, -1) * 0.55;
        if (v > best) best = v;
      });
    });
    return best;
  };

  AIAgent.prototype.bestKillValue = function (st, pid) {
    var best = 0;
    D.ZONE_ORDER.forEach(function (z) {
      if (D.NO_KILL.indexOf(z) >= 0) return;
      Object.keys(st.zones[z].astronauts).forEach(function (o) {
        if (+o === pid || st.zones[z].astronauts[o] <= 0) return;
        var v = deltaValue(st, z, pid, 0) * 0 - deltaValue(st, z, +o, -1);
        /* 相手の取り分が減る分＋自分の取り分が増える分 */
        var c = zoneCounts(st, z);
        var beforeMe = share(c, pid);
        c[o] = c[o] - 1; if (c[o] <= 0) delete c[o];
        var afterMe = share(c, pid);
        v = zoneValue(st, z) * (afterMe - beforeMe) + Math.max(0, v) * 0.35;
        if (v > best) best = v;
      });
    });
    return best;
  };

  AIAgent.prototype.bestRetargetValue = function (st, pid) {
    var ships = st.docks.filter(Boolean).concat(st.launched);
    var best = 0;
    ships.forEach(function (s) {
      if (!s.seats.length) return;
      var dest = effDest(s);
      var cur = dest ? deltaValue(st, dest, pid, 0, seatCounts(s)) : 0;
      var mine = s.seats.filter(function (o) { return o === pid; }).length;
      D.ZONE_ORDER.forEach(function (z) {
        if ((st.destTokensUsed[z] || 0) >= 2) return;
        if (z === dest) return;
        var v;
        if (mine > s.seats.length - mine) {
          /* 自分が主導権を握る船 → 有利なエリアへ */
          v = deltaValue(st, z, pid, mine, seatCounts(s, pid));
        } else {
          /* 相手の船 → 価値の低いエリアへ追いやる */
          v = -zoneValue(st, z) * 0.25 + zoneValue(st, dest || z) * 0.25;
        }
        if (v > best) best = v;
      });
    });
    return best * 0.7;
  };

  /* ---------- 選択の実装 ---------- */

  AIAgent.prototype.choose = function (st, pid, req) {
    var self = this;
    var value = this.decide(st, pid, req);
    if (!this.delay) return Promise.resolve(value);
    return U.sleep(this.delay).then(function () { return value; });
  };

  AIAgent.prototype.decide = function (st, pid, req) {
    var self = this, rng = this.rng;
    var opts = req.options || [];
    if (!opts.length) return null;

    switch (req.kind) {
      case 'mission': {
        var best = opts[0], bv = -Infinity;
        opts.forEach(function (o) {
          var v = missionAppeal(o.label) + rng() * 1.5;
          if (v > bv) { bv = v; best = o; }
        });
        return best.id;
      }

      case 'character': {
        var bestC = opts[0], bvC = -Infinity;
        opts.forEach(function (o) {
          var v = self.scoreCharacter(st, pid, o.n) * (0.9 + rng() * 0.25);
          if (v > bvC) { bvC = v; bestC = o; }
        });
        return bestC.id;
      }

      case 'ship': {
        var ships = st.docks.filter(Boolean).concat(st.launched);
        var byUid = {};
        ships.forEach(function (s) { byUid[s.uid] = s; });
        var pick = opts[0], pv = -Infinity;
        opts.forEach(function (o) {
          var s = byUid[o.id];
          if (!s) return;
          var v;
          if (req.context === 'destroy') {
            var mine = s.seats.filter(function (x) { return x === pid; }).length;
            v = (s.seats.length - mine) * 1.6 - mine * 3.2;
          } else if (req.context === 'forceLaunch') {
            var m2 = s.seats.filter(function (x) { return x === pid; }).length;
            var dest = effDest(s);
            v = dest && m2 ? deltaValue(st, dest, pid, m2, seatCounts(s, pid)) : -0.5;
            if (!s.seats.length) v = 0.3; // 空の船を飛ばしてドックを空ける
          } else if (req.context === 'retarget') {
            var m3 = s.seats.filter(function (x) { return x === pid; }).length;
            v = Math.abs(m3 * 2 - s.seats.length) + s.seats.length * 0.3;
          } else {
            v = shipGain(st, pid, s);
          }
          if (v > pv) { pv = v; pick = o; }
        });
        return pick.id;
      }

      case 'zone': {
        var pickZ = opts[0], pvZ = -Infinity;
        opts.forEach(function (o) {
          var v = self.zoneScore(st, pid, o.id, req);
          if (v > pvZ) { pvZ = v; pickZ = o; }
        });
        if (req.optional && pvZ < 0.35) return null;
        return pickZ.id;
      }

      case 'astronaut': {
        var pickA = opts[0], pvA = -Infinity;
        opts.forEach(function (o) {
          var t = o.target;
          if (!t) return;
          var v;
          if (t.where === 'ship') {
            v = 1.0;
          } else {
            var c = zoneCounts(st, t.zoneId);
            var beforeMe = share(c, pid);
            c[t.victim] = (c[t.victim] || 0) - 1;
            if (c[t.victim] <= 0) delete c[t.victim];
            if (req.context === 'replace') c[pid] = (c[pid] || 0) + 1;
            var afterMe = share(c, pid);
            v = zoneValue(st, t.zoneId) * (afterMe - beforeMe);
            if (t.victim === pid) v -= 6;
          }
          if (v > pvA) { pvA = v; pickA = o; }
        });
        return pickA.id;
      }

      case 'option':
      default: {
        var drawOpt = opts.filter(function (o) { return o.id === 'draw'; })[0];
        if (drawOpt) return rng() < 0.85 ? 'draw' : opts[opts.length - 1].id;
        return opts[0].id;
      }
    }
  };

  AIAgent.prototype.zoneScore = function (st, pid, zid, req) {
    var ctx = req.context;
    if (ctx === 'destination') {
      var ship = st.docks.concat(st.launched).filter(function (s) { return s && s.uid === req.shipUid; })[0];
      var extra = ship ? seatCounts(ship, pid) : null;
      var mine = ship ? ship.seats.filter(function (o) { return o === pid; }).length : 1;
      return deltaValue(st, zid, pid, Math.max(1, mine), extra);
    }
    if (ctx === 'moveFrom') {
      /* 出しても損が小さいエリア＝すでに勝てない／余っているエリア */
      var loss = -deltaValue(st, zid, pid, -1);
      var bestGain = 0;
      D.ZONES[zid].adj.forEach(function (to) {
        var g = deltaValue(st, to, pid, 1);
        if (g > bestGain) bestGain = g;
      });
      return bestGain - loss;
    }
    if (ctx === 'moveTo') return deltaValue(st, zid, pid, 1);
    if (ctx === 'assignDiscovery') {
      var card = req.card;
      var mine = st.zones[zid].astronauts[pid] || 0;
      var others = 0;
      Object.keys(st.zones[zid].astronauts).forEach(function (o) {
        if (+o !== pid) others += st.zones[zid].astronauts[o];
      });
      var good = card && ['synergy', 'richvein', 'lichens', 'lake', 'frozen'].indexOf(card.id) >= 0;
      var bad = card && ['incident', 'radiation', 'native', 'sandstorm', 'subterfuge', 'uneven'].indexOf(card.id) >= 0;
      var lean = mine - others * 0.8;
      if (good) return lean + zoneValue(st, zid) * 0.1;
      if (bad) return -lean + zoneValue(st, zid) * 0.1;
      return Math.random() * 0.5;
    }
    if (ctx === 'peek') return zoneValue(st, zid);
    return zoneValue(st, zid);
  };

  function missionAppeal(label) {
    /* 汎用的で達成しやすいものを好む簡易な好み */
    var pref = {
      '拡張主義': 6, '東方進出': 5.5, '大量入植': 5, '多角経営': 5,
      '戦略拠点': 4.5, '氷の探鉱者': 4.5, 'セレリウム王': 4, 'シルバナイト王': 4,
      '北の領有権': 3.5, '南の領有権': 3.5, '深部採掘': 3.5,
      '月面前哨基地': 3, '英雄的犠牲': 2
    };
    return pref[label] != null ? pref[label] : 3.5;
  }

  MRP.AIAgent = AIAgent;
})(window);
