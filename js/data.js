/* ミッション・レッドプラネット — 静的データ（エリア／キャラクター／宇宙船／イベント） */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});

  /* ==========================================================
   * 火星の地図
   * 中央 2 エリア（シルチス・マヨル／マリネリス峡谷）を
   * 外周 7 エリアが取り囲む。フォボスはどこにも隣接しない。
   * ========================================================== */
  var MARS = { cx: 500, cy: 545, rOuter: 395, rInner: 185 };
  var PHOBOS_POS = { cx: 878, cy: 108, r: 72 };

  var RING = [
    { id: 'ausonia', name: 'Ausonia', ja: 'アウソニア', red: true },
    { id: 'hellas', name: 'Hellas', ja: 'ヘラス', red: true },
    { id: 'tritonis', name: 'Tritonis Sinus', ja: 'トリトニス湾', red: false },
    { id: 'tyrrhenum', name: 'Mare Tyrrhenum', ja: 'ティレヌム海', red: true },
    { id: 'sabaeus', name: 'Sinus Sabaeus', ja: 'サバエウス湾', red: false },
    { id: 'serpentis', name: 'Mare Serpentis', ja: 'セルペンティス海', red: true },
    { id: 'borealis', name: 'Vastitas Borealis', ja: '北極平原', red: false }
  ];

  var SECTOR = 360 / RING.length;
  var START = -90 - SECTOR / 2;

  var ZONES = {};
  var ZONE_ORDER = [];

  RING.forEach(function (z, i) {
    var a0 = START + i * SECTOR, a1 = a0 + SECTOR, mid = (a0 + a1) / 2;
    ZONES[z.id] = {
      id: z.id, name: z.name, ja: z.ja, red: !!z.red,
      outer: true, phobos: false,
      path: MRP.util.ringSectorPath(MARS.cx, MARS.cy, MARS.rInner, MARS.rOuter, a0, a1),
      label: MRP.util.polar(MARS.cx, MARS.cy, 234, mid),
      token: MRP.util.polar(MARS.cx, MARS.cy, 288, mid),
      crew: MRP.util.polar(MARS.cx, MARS.cy, 348, mid),
      adj: []
    };
    ZONE_ORDER.push(z.id);
  });

  ZONES.syrtis = {
    id: 'syrtis', name: 'Syrtis Major', ja: 'シルチス・マヨル', red: false,
    outer: false, phobos: false,
    path: 'M' + (MARS.cx - MARS.rInner) + ',' + MARS.cy +
      'A' + MARS.rInner + ',' + MARS.rInner + ' 0 0 1 ' + (MARS.cx + MARS.rInner) + ',' + MARS.cy + 'Z',
    label: [MARS.cx, MARS.cy - 128],
    token: [MARS.cx, MARS.cy - 92],
    crew: [MARS.cx, MARS.cy - 48],
    adj: []
  };
  ZONES.marineris = {
    id: 'marineris', name: 'Valles Marineris', ja: 'マリネリス峡谷', red: false,
    outer: false, phobos: false,
    path: 'M' + (MARS.cx + MARS.rInner) + ',' + MARS.cy +
      'A' + MARS.rInner + ',' + MARS.rInner + ' 0 0 1 ' + (MARS.cx - MARS.rInner) + ',' + MARS.cy + 'Z',
    label: [MARS.cx, MARS.cy + 46],
    token: [MARS.cx, MARS.cy + 82],
    crew: [MARS.cx, MARS.cy + 126],
    adj: []
  };
  ZONE_ORDER.push('syrtis', 'marineris');

  ZONES.phobos = {
    id: 'phobos', name: 'Phobos', ja: 'フォボス', red: false,
    outer: false, phobos: true,
    path: null,
    circle: PHOBOS_POS,
    label: [PHOBOS_POS.cx, PHOBOS_POS.cy - 88],
    token: [PHOBOS_POS.cx - 44, PHOBOS_POS.cy - 44],
    crew: [PHOBOS_POS.cx, PHOBOS_POS.cy + 6],
    adj: []
  };
  ZONE_ORDER.push('phobos');

  /* 隣接関係：外周はリング状に連結、中央 2 エリアは接する外周エリアと連結 */
  function link(a, b) {
    if (ZONES[a].adj.indexOf(b) < 0) ZONES[a].adj.push(b);
    if (ZONES[b].adj.indexOf(a) < 0) ZONES[b].adj.push(a);
  }
  RING.forEach(function (z, i) { link(z.id, RING[(i + 1) % RING.length].id); });
  ['borealis', 'ausonia', 'hellas', 'tritonis', 'serpentis'].forEach(function (z) { link('syrtis', z); });
  ['tritonis', 'tyrrhenum', 'sabaeus', 'serpentis', 'borealis'].forEach(function (z) { link('marineris', z); });
  link('syrtis', 'marineris');

  /* 兵士カードが排除できないエリア（＝中央 2 エリア） */
  var NO_KILL = ['syrtis', 'marineris'];
  /* 発見カードを配置できないエリア */
  var NO_DISCOVERY = ['syrtis', 'marineris', 'phobos'];

  /* ==========================================================
   * 資源
   * ========================================================== */
  var RESOURCES = {
    ice: { id: 'ice', ja: '氷', value: 1, color: '#8fd6f2', glyph: '❄' },
    sylvanite: { id: 'sylvanite', ja: 'シルバナイト', value: 2, color: '#dfe4ea', glyph: '◈' },
    celerium: { id: 'celerium', ja: 'セレリウム', value: 3, color: '#c88bf0', glyph: '✦' }
  };
  /* 資源トークンの内訳（氷 5・シルバナイト 3・セレリウム 3 ＝ 11 枚） */
  var RESOURCE_BAG = ['ice', 'ice', 'ice', 'ice', 'ice',
    'sylvanite', 'sylvanite', 'sylvanite',
    'celerium', 'celerium', 'celerium'];

  /* ==========================================================
   * キャラクターカード（9 → 1 のカウントダウン順に解決）
   * ========================================================== */
  var CHARACTERS = [
    {
      n: 9, id: 'recruiter', name: 'Recruiter', ja: 'リクルーター', glyph: '🎩',
      text: 'ドック中の宇宙船に宇宙飛行士を1体乗せ、使用済みのキャラクターカードをすべて手札に戻す（このカードも含む）。'
    },
    {
      n: 8, id: 'explorer', name: 'Explorer', ja: '探検家', glyph: '🧭',
      text: 'ドック中の宇宙船に宇宙飛行士を1体乗せ、火星上の自分の宇宙飛行士を合計3回まで隣接エリアへ移動させる。'
    },
    {
      n: 7, id: 'scientist', name: 'Scientist', ja: '科学者', glyph: '🔬',
      text: 'ドック中の宇宙船に宇宙飛行士を2体乗せ、イベントカードを1枚引く、または場の裏向きの発見カードを1枚確認する。'
    },
    {
      n: 6, id: 'agent', name: 'Secret Agent', ja: '秘密諜報員', glyph: '🕵',
      text: '異なるドック中の宇宙船に宇宙飛行士を1体ずつ計2体乗せ、ドック中の宇宙船1隻を強制的に発射させる。'
    },
    {
      n: 5, id: 'saboteur', name: 'Saboteur', ja: '工作員', glyph: '💣',
      text: 'ドック中の宇宙船に宇宙飛行士を1体乗せ、ドック中の宇宙船1隻を破壊する（乗員は全員「宇宙の藻屑」へ）。'
    },
    {
      n: 4, id: 'femme', name: 'Femme Fatale', ja: 'ファム・ファタール', glyph: '🌹',
      text: 'ドック中の宇宙船に宇宙飛行士を1体乗せ、自分の宇宙飛行士がいる宇宙船／エリアにいる他人の宇宙飛行士1体を自分の宇宙飛行士と入れ替える。'
    },
    {
      n: 3, id: 'travel', name: 'Travel Agent', ja: '旅行代理店', glyph: '🎟',
      text: '空席が3以上あるドック中の宇宙船1隻に、宇宙飛行士を3体まとめて乗せる。該当する船がなければ何もしない。'
    },
    {
      n: 2, id: 'soldier', name: 'Soldier', ja: '軍人', glyph: '⚔',
      text: '同じドック中の宇宙船に宇宙飛行士を2体乗せ、中央2エリア以外のエリアにいる宇宙飛行士1体を排除する。'
    },
    {
      n: 1, id: 'pilot', name: 'Pilot', ja: 'パイロット', glyph: '🚀',
      text: 'ドック中の宇宙船に宇宙飛行士を2体乗せ、宇宙船1隻（ドック中／発射済みどちらでも）の目的地を変更する。'
    }
  ];
  var CHAR_BY_N = {};
  CHARACTERS.forEach(function (c) { CHAR_BY_N[c.n] = c; });

  /* ==========================================================
   * 宇宙船デッキ（36 隻）
   * ========================================================== */
  function buildShipDeck() {
    var list = [];
    var plan = [
      ['syrtis', [4, 5, 5]],
      ['marineris', [4, 4, 5]],
      ['phobos', [3, 4, 4]],
      ['ausonia', [2, 3, 4]],
      ['hellas', [2, 3, 4]],
      ['tritonis', [2, 3, 4]],
      ['tyrrhenum', [2, 3, 4]],
      ['sabaeus', [2, 3, 4]],
      ['serpentis', [2, 3, 4]],
      ['borealis', [2, 3, 4]],
      [null, [2, 3, 3, 4, 4, 5]] // 目的地不明の宇宙船
    ];
    var uid = 0;
    plan.forEach(function (p) {
      p[1].forEach(function (cap) {
        list.push({ uid: 'S' + (uid++), dest: p[0], cap: cap, seats: [], destToken: null });
      });
    });
    return list;
  }

  /* ==========================================================
   * イベントカード（発見 13／ミッション 13／アクション 4）
   * ========================================================== */

  /* 発見カード：外周エリアに裏向きで割り当て、終盤に公開される */
  var DISCOVERIES = [
    { id: 'ether', ja: 'エーテル磁石', when: 'reveal', text: 'ドック中の宇宙船に乗っている宇宙飛行士をすべてこのエリアへ移す。' },
    { id: 'native', ja: '原住民の抵抗', when: 'reveal', text: '各プレイヤーはこのエリアの自分の宇宙飛行士を1体「宇宙の藻屑」へ送る。' },
    { id: 'sandstorm', ja: '大砂嵐', when: 'reveal', text: 'このエリアの宇宙飛行士をすべて隣接エリアへ退避させる。' },
    { id: 'synergy', ja: 'シナジー', when: 'prod3', text: '隣接する各エリアは追加で1個の得点トークンを産出する。' },
    { id: 'incident', ja: '採掘事故', when: 'prod3', text: 'このエリアは得点トークンを産出しない。' },
    { id: 'richvein', ja: '豊かな鉱脈', when: 'prod3', text: 'このエリアは追加で2個の得点トークンを産出する。' },
    { id: 'even', ja: '平坦な地形', when: 'prod3', text: '第3生産フェイズの間、このエリアの宇宙飛行士がいる全プレイヤーは同数とみなす。' },
    { id: 'uneven', ja: '起伏の激しい地形', when: 'prod3', text: '第3生産フェイズの間、このエリアで最も宇宙飛行士が少ないプレイヤーが多数派とみなされる。' },
    { id: 'subterfuge', ja: '謀略', when: 'prod3', text: '第3生産フェイズの間、このエリアの得点トークンは2番目に宇宙飛行士が多いプレイヤーが受け取る。' },
    { id: 'frozen', ja: '凍結洞窟', when: 'prod3', text: '第3生産フェイズの間、このエリアは本来の資源の代わりに氷を産出する。' },
    { id: 'lichens', ja: '地衣類', when: 'final', text: 'このエリアに宇宙飛行士が1体以上いる各プレイヤーは6点を得る。' },
    { id: 'lake', ja: '地下湖', when: 'final', text: 'このエリアで最も宇宙飛行士が多いプレイヤーは4点を得る。' },
    { id: 'radiation', ja: '放射線漏れ', when: 'final', text: 'このエリアに宇宙飛行士が1体以上いる各プレイヤーは3点を失う。' }
  ];

  /* ミッションカード：秘密の目標。最終得点計算で判定 */
  var MISSIONS = [
    { id: 'eastern', ja: '東方進出', text: '赤いエリア（アウソニア／ヘラス／ティレヌム海／セルペンティス海）のうち1/2/3/4か所に宇宙飛行士が1体以上いれば 1/2/4/7 点。' },
    { id: 'strategic', ja: '戦略拠点', text: 'シルチス・マヨルとマリネリス峡谷の宇宙飛行士の合計が最多なら 8 点。' },
    { id: 'moonbase', ja: '月面前哨基地', text: 'フォボスにいる自分の宇宙飛行士1体につき 2 点（最大 8 点）。' },
    { id: 'celbaron', ja: 'セレリウム王', text: 'セレリウムの得点トークンが最多なら 8 点。' },
    { id: 'sylbaron', ja: 'シルバナイト王', text: 'シルバナイトの得点トークンが最多なら 8 点。' },
    { id: 'iceprosp', ja: '氷の探鉱者', text: '氷の得点トークンを5個以上持っていれば 7 点。' },
    { id: 'expansion', ja: '拡張主義', text: '宇宙飛行士が1体以上いるエリア1か所につき 1 点。' },
    { id: 'colonist', ja: '大量入植', text: '火星とフォボスの合計で宇宙飛行士が10体以上いれば 7 点。' },
    { id: 'memorial', ja: '英雄的犠牲', text: '「宇宙の藻屑」にいる自分の宇宙飛行士1体につき 2 点（最大 8 点）。' },
    { id: 'diverse', ja: '多角経営', text: '3種類すべての得点トークンを1個以上持っていれば 6 点。' },
    { id: 'claim_borealis', ja: '北の領有権', text: '北極平原で宇宙飛行士が最多なら 5 点。' },
    { id: 'claim_sabaeus', ja: '南の領有権', text: 'サバエウス湾で宇宙飛行士が最多なら 5 点。' },
    { id: 'claim_syrtis', ja: '深部採掘', text: 'シルチス・マヨルで宇宙飛行士が最多なら 5 点。' }
  ];

  /* アクションカード：所定のタイミングで自動的に発動する */
  var ACTIONS = [
    { id: 'blocks', ja: '氷塊', text: '第3生産フェイズの終了時、氷の得点トークンを2個得る。' },
    { id: 'etherwind', ja: 'エーテルの風', text: '第3生産フェイズの終了時、セレリウムの得点トークンを1個得る。' },
    { id: 'rescue', ja: '救助作戦', text: '第3生産フェイズの直前、「宇宙の藻屑」から自分の宇宙飛行士を最大2体、自分の宇宙飛行士がいるエリアへ帰還させる。' },
    { id: 'espionage', ja: '産業スパイ', text: '第3生産フェイズの直前、自分の宇宙飛行士がいるエリアから他プレイヤーの宇宙飛行士を1体排除する。' }
  ];

  var PLAYER_COLORS = [
    { id: 'red', ja: 'クリムゾン', hex: '#e0533a', dark: '#7c2415' },
    { id: 'blue', ja: 'アズール', hex: '#3f9fe0', dark: '#144a72' },
    { id: 'green', ja: 'ヴィリジアン', hex: '#4fb87a', dark: '#175539' },
    { id: 'yellow', ja: 'アンバー', hex: '#e8c04a', dark: '#7b5c10' },
    { id: 'purple', ja: 'モーヴ', hex: '#b07ae0', dark: '#4d2a75' },
    { id: 'white', ja: 'アイボリー', hex: '#e6e2d6', dark: '#6e6a5c' }
  ];

  /* ラウンドトラッカー：10 ラウンド＋各フェイズ */
  var TRACK = [
    { t: 'round', n: 1 }, { t: 'round', n: 2 }, { t: 'round', n: 3 }, { t: 'round', n: 4 }, { t: 'round', n: 5 },
    { t: 'prod', n: 1 },
    { t: 'round', n: 6 }, { t: 'round', n: 7 }, { t: 'round', n: 8 },
    { t: 'prod', n: 2 },
    { t: 'round', n: 9 }, { t: 'round', n: 10 },
    { t: 'discovery' },
    { t: 'prod', n: 3 },
    { t: 'final' }
  ];

  MRP.data = {
    MARS: MARS, PHOBOS_POS: PHOBOS_POS,
    ZONES: ZONES, ZONE_ORDER: ZONE_ORDER, RING: RING,
    NO_KILL: NO_KILL, NO_DISCOVERY: NO_DISCOVERY,
    RESOURCES: RESOURCES, RESOURCE_BAG: RESOURCE_BAG,
    CHARACTERS: CHARACTERS, CHAR_BY_N: CHAR_BY_N,
    buildShipDeck: buildShipDeck,
    DISCOVERIES: DISCOVERIES, MISSIONS: MISSIONS, ACTIONS: ACTIONS,
    PLAYER_COLORS: PLAYER_COLORS, TRACK: TRACK,
    ASTRONAUTS_PER_PLAYER: 22,
    RED_ZONES: RING.filter(function (z) { return z.red; }).map(function (z) { return z.id; })
  };
})(window);
