/* ミッション・レッドプラネット — 起動処理 */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});
  var D = MRP.data, U = MRP.util, A = MRP.audio, el = U.el;

  var ui = null;

  function startGame(playerCount, speed) {
    var seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    var rng = U.makeRng(seed);

    ui.speed = speed;
    var agents = {};
    agents[0] = new MRP.HumanAgent(ui, 0);
    for (var i = 1; i < playerCount; i++) {
      agents[i] = new MRP.AIAgent(i, rng, { delay: Math.round(260 * speed) });
    }
    ui.autoAgent = new MRP.AIAgent(0, rng, { delay: 0 });

    var game = new MRP.Game({
      playerCount: playerCount,
      seed: seed,
      agents: agents,
      fx: ui.hooks()
    });
    ui.game = game;
    document.getElementById('log').innerHTML = '';
    ui.render();
    game.run().catch(function (e) {
      console.error(e);
      ui.pushLog('エラーが発生しました: ' + e.message, 'bad');
    });
  }

  /* ==================== スタート画面 ==================== */

  function showStart() {
    var m = document.getElementById('modal');
    m.className = 'modal';
    m.innerHTML = '';
    var box = el('div', 'modal-box start');
    box.appendChild(el('div', 'start-kicker', '西暦 1888 年 — 蒸気機関の時代'));
    box.appendChild(el('h1', 'start-title', 'MISSION: RED PLANET'));
    box.appendChild(el('p', 'muted',
      'あなたは採掘企業の総帥。9人の腹心を送り込み、宇宙船を火星へ飛ばし、' +
      '各エリアで多数派を握って氷・シルバナイト・セレリウムを手に入れましょう。'));

    var pcWrap = el('div', 'field');
    pcWrap.appendChild(el('label', null, 'プレイヤー人数（あなた＋コンピューター）'));
    var pcRow = el('div', 'chips');
    var chosen = { n: 4, speed: 1 };
    [2, 3, 4, 5, 6].forEach(function (n) {
      var c = el('button', 'chip' + (n === 4 ? ' on' : ''), n + '人');
      c.onclick = function () {
        chosen.n = n;
        Array.prototype.forEach.call(pcRow.children, function (x) { x.classList.remove('on'); });
        c.classList.add('on');
        A.click();
      };
      pcRow.appendChild(c);
    });
    pcWrap.appendChild(pcRow);
    box.appendChild(pcWrap);

    var spWrap = el('div', 'field');
    spWrap.appendChild(el('label', null, '演出の速さ'));
    var spRow = el('div', 'chips');
    [['じっくり', 1.35], ['ふつう', 1], ['きびきび', 0.45]].forEach(function (o) {
      var c = el('button', 'chip' + (o[1] === 1 ? ' on' : ''), o[0]);
      c.onclick = function () {
        chosen.speed = o[1];
        Array.prototype.forEach.call(spRow.children, function (x) { x.classList.remove('on'); });
        c.classList.add('on');
        A.click();
      };
      spRow.appendChild(c);
    });
    spWrap.appendChild(spRow);
    box.appendChild(spWrap);

    var go = el('button', 'pbtn big', '🚀 発射準備 — ゲーム開始');
    go.onclick = function () {
      A.resume();
      A.click();
      m.className = 'modal hidden';
      startGame(chosen.n, chosen.speed);
    };
    box.appendChild(go);

    var rules = el('button', 'pbtn ghost', 'ルールを読む');
    rules.onclick = function () { showRules(true); };
    box.appendChild(rules);

    m.appendChild(box);
  }

  /* ==================== ルール ==================== */

  function showRules(backToStart) {
    var m = document.getElementById('modal');
    m.className = 'modal';
    m.innerHTML = '';
    var box = el('div', 'modal-box wide scroll');
    box.appendChild(el('h2', null, '遊びかた'));

    var html = '';
    html += '<h3>目的</h3><p>10 ラウンドを通じて火星の各エリアで多数派を握り、資源（氷 1 点／シルバナイト 2 点／セレリウム 3 点）と' +
      'ミッションで最も多くの点数を稼いだプレイヤーが勝ちます。</p>';
    html += '<h3>1 ラウンドの流れ</h3><ol>' +
      '<li>全員が手札から <b>キャラクターカードを 1 枚</b> 同時に選ぶ</li>' +
      '<li><b>9 → 1 のカウントダウン</b>（発射までの秒読み）の順に公開して効果を解決する</li>' +
      '<li>定員に達した宇宙船は<b>発射</b>し、ラウンド終了時に<b>着陸</b>する</li>' +
      '<li>空いたドックに新しい宇宙船を補充</li>' +
      '<li>最後に効果を解決したプレイヤーが次の先手になる</li>' +
      '</ol><p>一度使ったキャラクターは <b>リクルーター</b> を使うまで手札に戻りません。</p>' +
      '<p class="note"><b>番号が小さいほど、後に解決します。</b>発射台のカウントダウンなので 9 が先、1 が最後です。' +
      '宇宙船を破壊する工作員（5）、宇宙飛行士を排除する軍人（2）、行き先を書き換えるパイロット（1）といった' +
      '妨害役が小さい番号に並んでいるのは、他のプレイヤーが乗り込み終えたのを見てから動けるようにするためです。</p>';
    html += '<h3>生産フェイズ</h3><p>ラウンド 5・8・10 の後に生産が起こり、資源が公開済みの各エリアが ' +
      '1 個 → 2 個 → 3 個の得点トークンを産出します。そのエリアで宇宙飛行士が最も多いプレイヤーが' +
      'エリア上の得点トークンをすべて受け取ります（同数なら山分けし、余りはエリアに残ります）。</p>';
    html += '<h3>キャラクター</h3><p>上から順に解決されます（9 が最初、1 が最後）。</p><table class="rules-table">';
    D.CHARACTERS.forEach(function (c) {
      html += '<tr><td class="rt-n">' + c.n + '</td><td class="rt-name">' + c.glyph + ' ' + c.ja +
        '</td><td>' + c.text + '</td></tr>';
    });
    html += '</table>';
    html += '<h3>地図</h3><p>火星は中央の 2 エリア（シルチス・マヨル／マリネリス峡谷）と、それを囲む 7 つの外周エリアからなります。' +
      '衛星フォボスはどのエリアにも隣接していません。探検家の移動は隣接エリアにのみ行えます。' +
      '軍人は中央 2 エリアの宇宙飛行士を排除できず、発見カードは外周エリアにのみ配置されます。</p>';
    html += '<h3>イベントカード</h3><p><b>発見</b>は外周エリアに裏向きで置かれ、ラウンド 10 の後に一斉公開されます。' +
      '<b>ミッション</b>は秘密の目標で最終得点計算時に判定します。<b>アクション</b>は所定のタイミングで自動的に発動します。' +
      'さらに全員共通の「氷の独占」ミッション（氷トークン最多で 9 点）があります。</p>';

    var body = el('div', 'rules-body');
    body.innerHTML = html;
    box.appendChild(body);

    var close = el('button', 'pbtn big', backToStart ? '戻る' : '閉じる');
    close.onclick = function () {
      A.click();
      if (backToStart) showStart();
      else m.className = 'modal hidden';
    };
    box.appendChild(close);
    m.appendChild(box);
  }

  /* ==================== 起動 ==================== */

  function boot() {
    ui = new MRP.UI();
    ui.mount();

    var btnSound = document.getElementById('btnSound');
    var soundOn = true;
    btnSound.onclick = function () {
      soundOn = !soundOn;
      A.setEnabled(soundOn);
      btnSound.textContent = soundOn ? '🔊' : '🔇';
      btnSound.classList.toggle('off', !soundOn);
    };

    var btnAmb = document.getElementById('btnAmbient');
    var ambOn = true;
    btnAmb.onclick = function () {
      ambOn = !ambOn;
      A.setAmbient(ambOn);
      btnAmb.textContent = ambOn ? '🎵' : '🎼';
      btnAmb.classList.toggle('off', !ambOn);
      A.click();
    };

    document.getElementById('btnHelp').onclick = function () { A.click(); showRules(false); };
    document.getElementById('btnNew').onclick = function () {
      if (confirm('現在のゲームを破棄して新しいゲームを始めますか？')) location.reload();
    };
    document.getElementById('btnSpeed').onclick = function () {
      var opts = [1.35, 1, 0.45], labels = ['じっくり', 'ふつう', 'きびきび'];
      var i = opts.indexOf(ui.speed);
      i = (i + 1) % opts.length;
      ui.speed = opts[i];
      this.textContent = '⏩ ' + labels[i];
      A.click();
    };

    /* 最初のユーザー操作で音声コンテキストを起動する */
    var once = function () { A.resume(); document.removeEventListener('pointerdown', once); };
    document.addEventListener('pointerdown', once);

    showStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
