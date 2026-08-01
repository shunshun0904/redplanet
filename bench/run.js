/* 相手の強さを実測する。
     node bench/run.js                          既定の一式をまとめて回す
     node bench/run.js --lineup ai,naive,naive,naive --games 400
     node bench/run.js --lineup ai,ai,ai,ai      席順の偏りを見る

   席順の有利不利を打ち消すため、1局ごとに配役を1つずつ回す。
   勝率には正規近似の95%信頼区間を添える。 */
'use strict';

const { KINDS, LABEL, MRP } = require('./agents.js');

function parseArgs(argv) {
  const out = { games: 400, lineup: null, seed: 20260801, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') out.games = parseInt(argv[++i], 10);
    else if (a === '--lineup') out.lineup = argv[++i].split(',');
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10);
    else if (a === '--quiet') out.quiet = true;
  }
  return out;
}

/** lineup（例 ['ai','naive','naive','naive']）で games 局戦い、席ごとの勝利数を返す */
async function match(lineup, games, seed) {
  const n = lineup.length;
  const winsByKindIndex = new Array(n).fill(0);   // lineup の並び順に対する勝利数
  const winsBySeat = new Array(n).fill(0);
  const scores = [];

  for (let g = 0; g < games; g++) {
    const rng = MRP.util.makeRng(seed + g * 7919);
    const shift = g % n;                           // 配役を1つずつずらす
    const agents = {};
    const seatKind = new Array(n);
    for (let seat = 0; seat < n; seat++) {
      const kindIndex = (seat + shift) % n;
      seatKind[seat] = kindIndex;
      agents[seat] = KINDS[lineup[kindIndex]](seat, rng);
    }
    const game = new MRP.Game({
      playerCount: n, seed: seed + g * 7919, agents, fx: { log: () => {} }
    });
    await game.run();
    const w = game.state.results.winner.id;
    winsByKindIndex[seatKind[w]]++;
    winsBySeat[w]++;
    game.state.players.forEach(p => scores.push(p.score));
  }
  return { winsByKindIndex, winsBySeat, games, scores };
}

const fmt = v => v.toFixed(3);
const ci95 = (p, n) => 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);

function report(title, lineup, r) {
  const n = lineup.length;
  console.log('\n■ ' + title + '  （' + r.games + '局・席順ローテーション）');
  for (let i = 0; i < n; i++) {
    const p = r.winsByKindIndex[i] / r.games;
    console.log(
      '   ' + (LABEL[lineup[i]] + ' #' + (i + 1)).padEnd(12) +
      fmt(p) + ' ±' + fmt(ci95(p, r.games)) +
      '   (' + r.winsByKindIndex[i] + '/' + r.games + ')'
    );
  }
  console.log('   席別 : ' + r.winsBySeat.map(w => fmt(w / r.games)).join(' / ') +
    '   （互角 ' + fmt(1 / n) + '）');
  const s = r.scores.slice().sort((a, b) => a - b);
  console.log('   得点 : 最小 ' + s[0] + ' / 中央 ' + s[s.length >> 1] + ' / 最大 ' + s[s.length - 1]);
}

(async () => {
  const args = parseArgs(process.argv);
  const t0 = Date.now();

  if (args.lineup) {
    const r = await match(args.lineup, args.games, args.seed);
    report(args.lineup.map(k => LABEL[k]).join(' 対 '), args.lineup, r);
  } else {
    const suite = [
      ['AI 1人 対 素人筋 3人', ['ai', 'naive', 'naive', 'naive']],
      ['AI 1人 対 乱択 3人', ['ai', 'random', 'random', 'random']],
      ['素人筋 1人 対 AI 3人', ['naive', 'ai', 'ai', 'ai']],
      ['乱択 1人 対 AI 3人', ['random', 'ai', 'ai', 'ai']],
      ['［参考］素人筋 1人 対 乱択 3人', ['naive', 'random', 'random', 'random']],
      ['［参考］AI 4人（席順の偏りを見る）', ['ai', 'ai', 'ai', 'ai']]
    ];
    for (const [title, lineup] of suite) {
      report(title, lineup, await match(lineup, args.games, args.seed));
    }
  }
  console.log('\n所要 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
})().catch(e => { console.error(e); process.exit(1); });
