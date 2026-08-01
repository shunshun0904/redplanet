/* 比較用の相手。ここに置いた2つは「弱さの物差し」であって、
   ゲーム画面で使う相手（js/ai.js）ではない。 */
'use strict';

const MRP = require('./load.js');
const D = MRP.data;

/* ------------------------------------------------------------------ 乱択 */
/* 合法な選択肢から一様に選ぶだけ。下限の目盛り。 */
function RandomAgent(pid, rng) {
  this.pid = pid;
  this.rng = rng;
}
RandomAgent.prototype.choose = function (st, pid, req) {
  const opts = req.options || [];
  if (!opts.length) return Promise.resolve(null);
  if (req.optional && this.rng() < 0.5) return Promise.resolve(null);
  return Promise.resolve(this.rng.pick(opts).id);
};

/* ---------------------------------------------------------------- 素人筋 */
/* 初心者がまず思いつく方針だけで打つ相手。
   ・宇宙飛行士は多く出せるカードほど良いカードだと思っている
   ・宇宙船は「行き先の資源が高いほど良い」で選ぶ。もうすぐ飛ぶ船を少し好む
   ・行き先は資源の価値がいちばん高いエリア
   ・排除・入れ替えは、そのエリアでいちばん数の多い相手を狙う
   ・移動はしない
   抜けているのは多数派の読みだけ ── 誰が何人いるか、
   自分が1人足したら取り分がどう動くかを一切見ていない。 */
function NaiveAgent(pid, rng) {
  this.pid = pid;
  this.rng = rng;
}

/* 明かされていない資源は期待値（(1+2+3)/3 の重み付け平均）として扱う */
function resourceValue(st, zoneId) {
  const z = st.zones[zoneId];
  return z.revealed ? D.RESOURCES[z.resource].value : 1.73;
}

/* そのカードが盤に出せる宇宙飛行士の数 */
const PLACES = { 9: 1, 8: 1, 7: 2, 6: 2, 5: 1, 4: 1, 3: 3, 2: 2, 1: 2 };

NaiveAgent.prototype.choose = function (st, pid, req) {
  return Promise.resolve(this.decide(st, pid, req));
};

NaiveAgent.prototype.decide = function (st, pid, req) {
  const opts = req.options || [];
  const rng = this.rng;
  if (!opts.length) return null;

  switch (req.kind) {
    case 'character': {
      const me = st.players[pid];
      /* 手札が尽きかけたときだけリクルーターを使う */
      const rec = opts.filter(o => o.n === 9)[0];
      if (me.hand.length <= 2 && rec) return rec.id;
      /* それ以外は「たくさん出せるカードが良いカード」 */
      let best = [], bestV = -Infinity;
      opts.forEach(o => {
        if (o.n === 9) return;
        const v = PLACES[o.n];
        if (v > bestV) { bestV = v; best = [o]; }
        else if (v === bestV) best.push(o);
      });
      if (!best.length) return opts[0].id;
      return rng.pick(best).id;
    }

    case 'ship': {
      const ships = st.docks.filter(Boolean).concat(st.launched);
      const byUid = {};
      ships.forEach(s => { byUid[s.uid] = s; });
      if (req.context === 'destroy' || req.context === 'forceLaunch' || req.context === 'retarget') {
        return rng.pick(opts).id;
      }
      /* 行き先の資源が高い船。もうすぐ飛ぶ船をわずかに好む。
         誰が乗っているかは見ない。 */
      let best = opts[0], bestV = -Infinity;
      opts.forEach(o => {
        const s = byUid[o.id];
        if (!s) return;
        const dest = s.destToken || s.dest;
        const v = (dest ? resourceValue(st, dest) : 1.9) +
          0.25 * (s.seats.length + 1) / s.cap;
        if (v > bestV) { bestV = v; best = o; }
      });
      return best.id;
    }

    case 'zone': {
      if (req.context === 'moveFrom') return req.optional ? null : rng.pick(opts).id;
      if (req.context === 'destination') {
        let best = opts[0], bestV = -Infinity;
        opts.forEach(o => {
          const v = resourceValue(st, o.id) + rng() * 0.2;
          if (v > bestV) { bestV = v; best = o; }
        });
        return best.id;
      }
      return rng.pick(opts).id;
    }

    case 'astronaut': {
      /* そのエリアでいちばん数の多い相手を狙う */
      const foes = opts.filter(o => o.target && o.target.victim !== pid);
      const pool = foes.length ? foes : opts;
      let best = pool[0], bestN = -Infinity;
      pool.forEach(o => {
        const t = o.target;
        const n = t && t.zoneId ? (st.zones[t.zoneId].astronauts[t.victim] || 0) : 0;
        if (n > bestN) { bestN = n; best = o; }
      });
      return best.id;
    }

    case 'option': {
      const draw = opts.filter(o => o.id === 'draw')[0];
      return draw ? draw.id : opts[0].id;
    }

    case 'mission':
    default:
      return rng.pick(opts).id;
  }
};

const KINDS = {
  ai: (pid, rng) => new MRP.AIAgent(pid, rng, { delay: 0 }),
  naive: (pid, rng) => new NaiveAgent(pid, rng),
  random: (pid, rng) => new RandomAgent(pid, rng)
};

const LABEL = { ai: 'AI', naive: '素人筋', random: '乱択' };

module.exports = { RandomAgent, NaiveAgent, KINDS, LABEL, MRP, D };
