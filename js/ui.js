/* ミッション・レッドプラネット — 画面描画と操作 */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});
  var D = MRP.data, U = MRP.util, FX = MRP.fx, A = MRP.audio;
  var el = U.el, svgEl = U.svgEl;

  function UI() {
    this.game = null;
    this.pending = null;
    this.speed = 1;      // 1 = 通常, 0.35 = 高速
    this.autoAgent = null;
    this.dom = {};
    this.built = false;
  }

  UI.prototype.t = function (ms) { return Math.round(ms * this.speed); };
  UI.prototype.wait = function (ms) { return U.sleep(this.t(ms)); };

  /* ==================== 初期化 ==================== */

  UI.prototype.mount = function () {
    var d = this.dom;
    ['track', 'board', 'players', 'log', 'launchpad', 'flight', 'hand',
      'promptBar', 'modal', 'fxLayer', 'stars', 'memorial', 'panel'].forEach(function (id) {
        d[id] = document.getElementById(id);
      });
    this.stars = new FX.Starfield(d.stars);
    this.stars.start();
    this.buildBoard();
  };

  /* ==================== 盤面（静的部分） ==================== */

  UI.prototype.buildBoard = function () {
    var svg = this.dom.board;
    svg.innerHTML = '';
    var M = D.MARS;

    var defs = svgEl('defs');
    defs.innerHTML =
      '<radialGradient id="marsGrad" cx="38%" cy="30%" r="78%">' +
      '<stop offset="0%" stop-color="#e8814a"/><stop offset="55%" stop-color="#b8492a"/>' +
      '<stop offset="100%" stop-color="#4c1a12"/></radialGradient>' +
      '<radialGradient id="phobosGrad" cx="35%" cy="30%" r="75%">' +
      '<stop offset="0%" stop-color="#b9b0a4"/><stop offset="100%" stop-color="#3b3630"/></radialGradient>' +
      '<radialGradient id="haloGrad" cx="50%" cy="50%" r="50%">' +
      '<stop offset="60%" stop-color="rgba(224,101,58,0)"/>' +
      '<stop offset="88%" stop-color="rgba(224,101,58,.28)"/>' +
      '<stop offset="100%" stop-color="rgba(224,101,58,0)"/></radialGradient>' +
      '<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>';
    svg.appendChild(defs);

    svg.appendChild(svgEl('circle', {
      cx: M.cx, cy: M.cy, r: M.rOuter + 46, fill: 'url(#haloGrad)', class: 'halo'
    }));
    svg.appendChild(svgEl('circle', {
      cx: M.cx, cy: M.cy, r: M.rOuter, fill: 'url(#marsGrad)'
    }));

    var zonesG = svgEl('g', { class: 'zones' });
    svg.appendChild(zonesG);

    D.ZONE_ORDER.forEach(function (id) {
      var z = D.ZONES[id];
      var g = svgEl('g', { class: 'zone' + (z.red ? ' red' : '') + (z.phobos ? ' phobos' : ''), 'data-zone': id });
      var shape;
      if (z.phobos) {
        shape = svgEl('circle', { cx: z.circle.cx, cy: z.circle.cy, r: z.circle.r, class: 'zone-shape' });
        shape.setAttribute('fill', 'url(#phobosGrad)');
      } else {
        shape = svgEl('path', { d: z.path, class: 'zone-shape' });
      }
      g.appendChild(shape);
      var lbl = svgEl('text', {
        x: z.label[0], y: z.label[1], class: 'zone-label', 'text-anchor': 'middle'
      });
      lbl.textContent = z.ja;
      g.appendChild(lbl);
      zonesG.appendChild(g);
    });

    /* 動的レイヤー */
    this.zoneDyn = svgEl('g', { class: 'zone-dyn' });
    svg.appendChild(this.zoneDyn);

    var self = this;
    svg.addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('.zone') : null;
      if (!g) return;
      var id = g.getAttribute('data-zone');
      if (g.classList.contains('selectable')) self.resolveChoice(id);
    });
    this.built = true;
  };

  /* 円形に並ぶ宇宙飛行士ドットの座標 */
  function dotPositions(cx, cy, k) {
    var out = [], perRow = k > 8 ? 5 : 4, sp = 19;
    var rows = Math.ceil(k / perRow);
    for (var i = 0; i < k; i++) {
      var r = Math.floor(i / perRow);
      var inRow = Math.min(perRow, k - r * perRow);
      var col = i % perRow;
      out.push([
        cx + (col - (inRow - 1) / 2) * sp,
        cy + (r - (rows - 1) / 2) * sp
      ]);
    }
    return out;
  }

  UI.prototype.renderBoard = function () {
    var st = this.game.state, g = this.zoneDyn;
    g.innerHTML = '';
    var self = this;

    D.ZONE_ORDER.forEach(function (id) {
      var z = D.ZONES[id], zone = st.zones[id];

      /* 資源トークン */
      var tg = svgEl('g', { class: 'restoken' + (zone.revealed ? ' up' : '') });
      tg.appendChild(svgEl('circle', { cx: z.token[0], cy: z.token[1], r: 17 }));
      var tt = svgEl('text', { x: z.token[0], y: z.token[1] + 6, 'text-anchor': 'middle', class: 'restoken-t' });
      if (zone.revealed) {
        var R = D.RESOURCES[zone.resource];
        tg.firstChild.setAttribute('fill', R.color);
        tt.textContent = R.glyph;
        tt.setAttribute('fill', '#1b1008');
      } else {
        tg.firstChild.setAttribute('fill', '#2b1d16');
        tt.textContent = '?';
        tt.setAttribute('fill', '#d9a441');
      }
      tg.appendChild(tt);
      g.appendChild(tg);

      /* 蓄積された得点トークン */
      var pend = zone.pending.ice + zone.pending.sylvanite + zone.pending.celerium;
      if (pend > 0) {
        var pv = zone.pending.ice + zone.pending.sylvanite * 2 + zone.pending.celerium * 3;
        var pg = svgEl('g', { class: 'pendtok' });
        pg.appendChild(svgEl('rect', {
          x: z.token[0] + 20, y: z.token[1] - 12, width: 44, height: 24, rx: 11
        }));
        var pt = svgEl('text', { x: z.token[0] + 42, y: z.token[1] + 5, 'text-anchor': 'middle' });
        pt.textContent = '◈' + pend + '/' + pv + 'pt';
        pt.setAttribute('font-size', '13');
        pg.appendChild(pt);
        g.appendChild(pg);
      }

      /* 発見カード */
      if (zone.discovery) {
        var dg = svgEl('g', { class: 'disc' + (zone.discoveryRevealed ? ' up' : '') });
        dg.appendChild(svgEl('rect', { x: z.token[0] - 62, y: z.token[1] - 14, width: 30, height: 28, rx: 4 }));
        var dt = svgEl('text', { x: z.token[0] - 47, y: z.token[1] + 6, 'text-anchor': 'middle' });
        dt.textContent = zone.discoveryRevealed ? '📜' : '✧';
        dt.setAttribute('font-size', '15');
        dg.appendChild(dt);
        var title = svgEl('title');
        title.textContent = zone.discoveryRevealed
          ? zone.discovery.ja + '：' + zone.discovery.text
          : '裏向きの発見カード';
        dg.appendChild(title);
        g.appendChild(dg);
      }

      /* 宇宙飛行士 */
      var list = [];
      st.players.forEach(function (p) {
        var n = zone.astronauts[p.id] || 0;
        for (var i = 0; i < n; i++) list.push(p);
      });
      var shown = list.slice(0, 15);
      var pos = dotPositions(z.crew[0], z.crew[1], shown.length);
      shown.forEach(function (p, i) {
        var c = svgEl('circle', {
          cx: pos[i][0], cy: pos[i][1], r: 8, class: 'astro',
          fill: p.color.hex, stroke: p.color.dark
        });
        c.setAttribute('data-pid', p.id);
        g.appendChild(c);
      });
      if (list.length > shown.length) {
        var bottom = pos.length ? pos[pos.length - 1][1] : z.crew[1];
        var more = svgEl('text', {
          x: z.crew[0], y: bottom + 22, 'text-anchor': 'middle', class: 'more'
        });
        more.textContent = '+' + (list.length - shown.length);
        g.appendChild(more);
      }
    });
  };

  /* ==================== ラウンドトラッカー ==================== */

  UI.prototype.renderTrack = function () {
    var st = this.game.state, box = this.dom.track;
    box.innerHTML = '';
    D.TRACK.forEach(function (s, i) {
      var e = el('div', 'pip ' + s.t + (i === st.trackIndex ? ' now' : (i < st.trackIndex ? ' done' : '')));
      if (s.t === 'round') e.textContent = s.n;
      else if (s.t === 'prod') { e.textContent = '⛏'; e.title = '第' + s.n + '生産フェイズ'; }
      else if (s.t === 'discovery') { e.textContent = '📜'; e.title = '発見カード公開'; }
      else { e.textContent = '🏆'; e.title = '最終得点計算'; }
      box.appendChild(e);
    });
  };

  /* ==================== プレイヤー一覧 ==================== */

  UI.prototype.renderPlayers = function () {
    var st = this.game.state, box = this.dom.players;
    box.innerHTML = '';
    var self = this;
    st.players.forEach(function (p) {
      var card = el('div', 'pcard' + (st.firstPlayer === p.id ? ' first' : ''));
      card.style.setProperty('--pc', p.color.hex);
      card.setAttribute('data-pid', p.id);

      var head = el('div', 'phead');
      head.appendChild(el('span', 'pdot'));
      head.appendChild(el('span', 'pname', p.name + (p.isHuman ? '' : '')));
      if (st.firstPlayer === p.id) head.appendChild(el('span', 'badge', '先手'));
      card.appendChild(head);

      var stats = el('div', 'pstats');
      var score = p.tokens.ice + p.tokens.sylvanite * 2 + p.tokens.celerium * 3;
      stats.appendChild(el('span', 'stat', '❄' + p.tokens.ice));
      stats.appendChild(el('span', 'stat', '◈' + p.tokens.sylvanite));
      stats.appendChild(el('span', 'stat', '✦' + p.tokens.celerium));
      stats.appendChild(el('span', 'stat pts', st.finished ? (p.score + '点') : (score + 'pt')));
      stats.appendChild(el('span', 'stat', '👤' + p.astronautsLeft));
      if (st.memorial[p.id]) stats.appendChild(el('span', 'stat dead', '✝' + st.memorial[p.id]));
      card.appendChild(stats);

      var cardsRow = el('div', 'pcards');
      D.CHARACTERS.forEach(function (c) {
        var chosen = st.chosen[p.id] === c.n;
        var revealed = st.revealedChoices[c.n] && st.revealedChoices[c.n].indexOf(p.id) >= 0;
        var used = p.played.indexOf(c.n) >= 0;
        var inHand = p.hand.indexOf(c.n) >= 0;
        var cls = 'minicard';
        if (used) cls += ' used';
        else if (chosen && (revealed || p.isHuman)) cls += ' chosen';
        else if (chosen) cls += ' hidden-choice';
        else if (!inHand) cls += ' used';
        var m = el('div', cls, String(c.n));
        m.title = c.ja;
        cardsRow.appendChild(m);
      });
      card.appendChild(cardsRow);

      if (p.missions.length) {
        var mi = el('div', 'pmis', '🎯 ' + (p.isHuman
          ? p.missions.map(function (m) { return m.ja; }).join('・')
          : 'ミッション ' + p.missions.length + ' 枚'));
        if (p.isHuman) mi.title = p.missions.map(function (m) { return m.ja + '：' + m.text; }).join('\n');
        card.appendChild(mi);
      }
      if (p.actions.length && p.isHuman) {
        var ac = el('div', 'pmis', '⚡ ' + p.actions.map(function (a) { return a.ja; }).join('・'));
        ac.title = p.actions.map(function (a) { return a.ja + '：' + a.text; }).join('\n');
        card.appendChild(ac);
      }
      box.appendChild(card);
    });

    /* 宇宙の藻屑 */
    var mem = this.dom.memorial;
    var total = U.sum(st.memorial);
    mem.innerHTML = '';
    mem.appendChild(el('span', 'memlabel', '✝ 宇宙の藻屑'));
    if (!total) mem.appendChild(el('span', 'memnone', 'まだ犠牲者なし'));
    st.players.forEach(function (p) {
      var n = st.memorial[p.id] || 0;
      if (!n) return;
      var s = el('span', 'memdot', String(n));
      s.style.setProperty('--pc', p.color.hex);
      s.title = p.name;
      mem.appendChild(s);
    });
  };

  /* ==================== 発射台 ==================== */

  UI.prototype.shipCard = function (ship, opts) {
    var st = this.game.state;
    var dest = ship.destToken || ship.dest;
    var c = el('div', 'ship' + (opts && opts.flying ? ' flying' : ''));
    c.setAttribute('data-uid', ship.uid);

    var top = el('div', 'ship-dest');
    if (dest) {
      top.textContent = D.ZONES[dest].ja;
      if (ship.destToken) top.appendChild(el('span', 'token-mark', '⌖'));
      var zr = st.zones[dest];
      if (zr.revealed) {
        var r = D.RESOURCES[zr.resource];
        var rs = el('span', 'ship-res', r.glyph);
        rs.style.color = r.color;
        top.appendChild(rs);
      }
    } else {
      top.textContent = '目的地不明';
      top.classList.add('unknown');
    }
    c.appendChild(top);

    var body = el('div', 'ship-body');
    body.appendChild(el('div', 'rocket', '🚀'));
    var seats = el('div', 'seats');
    for (var i = 0; i < ship.cap; i++) {
      var s = el('div', 'seat');
      if (i < ship.seats.length) {
        var p = st.players[ship.seats[i]];
        s.classList.add('filled');
        s.style.setProperty('--pc', p.color.hex);
        s.title = p.name;
      }
      seats.appendChild(s);
    }
    body.appendChild(seats);
    c.appendChild(body);
    c.appendChild(el('div', 'ship-cap', '定員 ' + ship.cap + ' ／ 搭乗 ' + ship.seats.length));
    return c;
  };

  UI.prototype.renderPad = function () {
    var st = this.game.state, box = this.dom.launchpad, self = this;
    box.innerHTML = '';
    st.docks.forEach(function (ship, i) {
      var dock = el('div', 'dock');
      if (ship) dock.appendChild(self.shipCard(ship));
      else dock.appendChild(el('div', 'dock-empty', '空きドック'));
      box.appendChild(dock);
    });

    var fl = this.dom.flight;
    fl.innerHTML = '';
    if (st.launched.length) {
      fl.appendChild(el('div', 'flight-label', '飛行中'));
      st.launched.forEach(function (s) { fl.appendChild(self.shipCard(s, { flying: true })); });
    }

    box.onclick = fl.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.ship') : null;
      if (t && t.classList.contains('selectable')) self.resolveChoice(t.getAttribute('data-uid'));
    };
  };

  /* ==================== 手札 ==================== */

  UI.prototype.renderHand = function () {
    var st = this.game.state, box = this.dom.hand, self = this;
    var me = st.players[0];
    box.innerHTML = '';
    D.CHARACTERS.forEach(function (c) {
      var inHand = me.hand.indexOf(c.n) >= 0;
      var chosen = st.chosen[0] === c.n;
      var card = el('div', 'hcard' + (inHand ? '' : ' spent') + (chosen ? ' picked' : ''));
      card.setAttribute('data-n', c.n);
      card.appendChild(el('div', 'hnum', String(c.n)));
      card.appendChild(el('div', 'hglyph', c.glyph));
      card.appendChild(el('div', 'hname', c.ja));
      card.title = c.n + ' ' + c.ja + '\n' + c.text;
      box.appendChild(card);
    });
    box.onclick = function (e) {
      var t = e.target.closest ? e.target.closest('.hcard') : null;
      if (t && t.classList.contains('selectable')) self.resolveChoice(t.getAttribute('data-n'));
    };
  };

  /* ==================== ログ ==================== */

  UI.prototype.pushLog = function (text, cls) {
    var box = this.dom.log;
    var line = el('div', 'logline ' + cls, text);
    box.appendChild(line);
    while (box.children.length > 160) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  };

  /* ==================== 全体描画 ==================== */

  UI.prototype.render = function () {
    if (!this.game) return;
    /* 各ブロックを組み直すと中身の高さが一瞬縮み、操作盤のスクロール位置が
       先頭に戻ってしまう。相手の手番のたびに勝手に飛ばないよう覚えておく。 */
    var panel = this.dom.panel;
    var keep = panel ? panel.scrollTop : 0;
    this.renderTrack();
    this.renderBoard();
    this.renderPlayers();
    this.renderPad();
    this.renderHand();
    if (panel && panel.scrollTop !== keep) panel.scrollTop = keep;
    if (this.pending) this.applyHighlight(this.pending.req);
  };

  /* ==================== 人間プレイヤーの選択 ==================== */

  UI.prototype.requestChoice = function (pid, req) {
    var self = this;
    return new Promise(function (resolve) {
      self.pending = { req: req, resolve: resolve, pid: pid };
      self.render();
      self.showPrompt(req);
    });
  };

  UI.prototype.clearHighlight = function () {
    var q = this.dom.board.querySelectorAll('.selectable');
    for (var i = 0; i < q.length; i++) q[i].classList.remove('selectable');
    ['launchpad', 'flight', 'hand'].forEach(function (k) {
      var box = document.getElementById(k);
      var s = box.querySelectorAll('.selectable');
      for (var j = 0; j < s.length; j++) s[j].classList.remove('selectable');
    });
  };

  UI.prototype.applyHighlight = function (req) {
    this.clearHighlight();
    var ids = (req.options || []).map(function (o) { return String(o.id); });
    if (req.kind === 'zone') {
      ids.forEach(function (id) {
        var g = document.querySelector('.zone[data-zone="' + id + '"]');
        if (g) g.classList.add('selectable');
      });
    } else if (req.kind === 'ship') {
      ids.forEach(function (id) {
        var e = document.querySelector('.ship[data-uid="' + id + '"]');
        if (e) e.classList.add('selectable');
      });
    } else if (req.kind === 'character') {
      ids.forEach(function (id) {
        var e = document.querySelector('.hcard[data-n="' + id + '"]');
        if (e) e.classList.add('selectable');
      });
    } else if (req.kind === 'astronaut') {
      var zoneIds = {};
      (req.options || []).forEach(function (o) {
        if (o.target && o.target.zoneId) zoneIds[o.target.zoneId] = true;
      });
      Object.keys(zoneIds).forEach(function (id) {
        var g = document.querySelector('.zone[data-zone="' + id + '"]');
        if (g) g.classList.add('selectable');
      });
    }
  };

  UI.prototype.showPrompt = function (req) {
    var bar = this.dom.promptBar, self = this;
    bar.innerHTML = '';
    bar.classList.add('active');

    if (req.kind === 'mission') { this.showMissionModal(req); return; }

    bar.appendChild(el('div', 'prompt-text', req.prompt));
    var btns = el('div', 'prompt-btns');

    if (req.kind === 'option' || req.kind === 'astronaut') {
      (req.options || []).forEach(function (o) {
        var label = o.label;
        if (!label && o.target) {
          var t = o.target;
          var who = self.game.state.players[t.victim];
          label = (t.where === 'ship' ? '🚀 宇宙船' : D.ZONES[t.zoneId].ja) + ' — ' + who.name;
        }
        var b = el('button', 'pbtn', label || String(o.id));
        if (o.sub) b.title = o.sub;
        if (o.target) b.style.setProperty('--pc', self.game.state.players[o.target.victim].color.hex);
        b.onclick = function () { self.resolveChoice(o.id); };
        btns.appendChild(b);
      });
    } else {
      var hint = { zone: '地図上のエリアをクリック', ship: '宇宙船カードをクリック', character: '手札のカードをクリック' }[req.kind];
      if (hint) btns.appendChild(el('span', 'prompt-hint', '👉 ' + hint));
    }

    if (req.optional) {
      var sk = el('button', 'pbtn ghost', 'スキップ');
      sk.onclick = function () { self.resolveChoice(null); };
      btns.appendChild(sk);
    }
    var auto = el('button', 'pbtn auto', 'おまかせ');
    auto.title = 'AI と同じ判断で自動的に選びます';
    auto.onclick = function () {
      var pick = self.autoAgent.decide(self.game.state, self.pending.pid, req);
      self.resolveChoice(pick);
    };
    btns.appendChild(auto);
    bar.appendChild(btns);
  };

  UI.prototype.showMissionModal = function (req) {
    var self = this, m = this.dom.modal;
    m.className = 'modal';
    m.innerHTML = '';
    var box = el('div', 'modal-box');
    box.appendChild(el('h2', null, 'ミッションカードを1枚選択'));
    box.appendChild(el('p', 'muted', '選ばなかった1枚は山札に戻ります。ミッションは他プレイヤーには秘密です。'));
    var row = el('div', 'mission-row');
    (req.options || []).forEach(function (o) {
      var c = el('div', 'mission-card');
      c.appendChild(el('div', 'mc-title', o.label));
      c.appendChild(el('div', 'mc-text', o.sub));
      c.onclick = function () {
        A.click();
        m.className = 'modal hidden';
        self.resolveChoice(o.id);
      };
      row.appendChild(c);
    });
    box.appendChild(row);
    m.appendChild(box);
  };

  UI.prototype.resolveChoice = function (id) {
    if (!this.pending) return;
    var p = this.pending;
    this.pending = null;
    A.click();
    this.clearHighlight();
    this.dom.promptBar.classList.remove('active');
    this.dom.promptBar.innerHTML = '';
    p.resolve(id);
  };

  /* ==================== 演出フック ==================== */

  UI.prototype.zonePoint = function (zoneId) {
    var z = D.ZONES[zoneId];
    return FX.svgPoint(this.dom.board, z.crew[0], z.crew[1]);
  };

  UI.prototype.shipPoint = function (uid) {
    var e = document.querySelector('.ship[data-uid="' + uid + '"]');
    return e ? FX.centerOf(e) : { x: global.innerWidth / 2, y: global.innerHeight / 2 };
  };

  UI.prototype.hooks = function () {
    var self = this;
    return {
      render: function () { self.render(); },
      log: function (t, c) { self.pushLog(t, c); },

      beat: function () { return self.wait(140); },

      phaseBanner: function (title, sub) {
        A.phase();
        return FX.banner(title, sub, self.t(1100));
      },

      revealCharacters: function (num, actors) {
        var c = D.CHAR_BY_N[num];
        var names = actors.map(function (p) { return self.game.state.players[p].name; }).join('・');
        A.flip();
        var L = self.dom.fxLayer;
        var e = el('div', 'charreveal');
        e.innerHTML = '<div class="cr-num">' + num + '</div><div class="cr-glyph">' + c.glyph +
          '</div><div class="cr-name">' + c.ja + '</div><div class="cr-who">' + names + '</div>';
        L.appendChild(e);
        return self.wait(760).then(function () {
          e.classList.add('out');
          setTimeout(function () { e.remove(); }, 260);
        });
      },

      placeAstronaut: function (pid, uid) {
        A.place();
        var p = self.game.state.players[pid];
        var to = self.shipPoint(uid);
        var card = document.querySelector('.pcard[data-pid="' + pid + '"]');
        var from = card ? FX.centerOf(card) : { x: to.x, y: to.y + 160 };
        FX.burst(to.x, to.y, p.color.hex, 6, { dist: 22, size: 5, dur: 380 });
        return FX.fly(from, to, p.color.hex, { dur: self.t(340), size: 13 });
      },

      launchShip: function (ship) {
        A.launch();
        var e = document.querySelector('.ship[data-uid="' + ship.uid + '"]');
        if (e) {
          var c = FX.centerOf(e);
          FX.burst(c.x, c.y + 24, '#ffb347', 12, { dist: 60, size: 7, dur: 700 });
          e.classList.add('launching');
        }
        return self.wait(620);
      },

      landShip: function (ship, zoneId) {
        A.land();
        var to = self.zonePoint(zoneId);
        var from = { x: to.x, y: -40 };
        var st = self.game.state;
        var jobs = ship.seats.map(function (owner, i) {
          var p = st.players[owner];
          return U.sleep(self.t(i * 70)).then(function () {
            return FX.fly(from, { x: to.x + (i - (ship.seats.length - 1) / 2) * 16, y: to.y },
              p.color.hex, { dur: self.t(520), size: 13 });
          });
        });
        return Promise.all(jobs).then(function () {
          FX.burst(to.x, to.y, '#e8814a', 10, { dist: 40, dur: 520 });
        });
      },

      explodeShip: function (ship) {
        A.explode();
        var e = document.querySelector('.ship[data-uid="' + ship.uid + '"]');
        if (e) {
          var c = FX.centerOf(e);
          FX.burst(c.x, c.y, '#ff8a3d', 16, { dist: 90, size: 9, dur: 760 });
          FX.burst(c.x, c.y, '#ffe08a', 10, { dist: 55, size: 6, dur: 620 });
          e.classList.add('exploding');
          FX.shake(document.getElementById('launchpad'));
        }
        return self.wait(600);
      },

      killAstronaut: function (pid, zoneId) {
        A.kill();
        var pt = self.zonePoint(zoneId);
        var p = self.game.state.players[pid];
        FX.burst(pt.x, pt.y, p.color.hex, 10, { dist: 44, dur: 560 });
        FX.floatText(pt.x, pt.y - 26, '✝', 'bad');
        return self.wait(340);
      },

      moveAstronaut: function (pid, from, to) {
        A.place();
        var p = self.game.state.players[pid];
        return FX.fly(self.zonePoint(from), self.zonePoint(to), p.color.hex, { dur: self.t(430), size: 13 });
      },

      production: function (phase, results) {
        var st = self.game.state;
        var jobs = [];
        results.forEach(function (r, ri) {
          var from = self.zonePoint(r.zoneId);
          Object.keys(r.gained).forEach(function (w, wi) {
            var p = st.players[+w];
            var card = document.querySelector('.pcard[data-pid="' + w + '"]');
            var to = card ? FX.centerOf(card) : { x: global.innerWidth - 60, y: 120 };
            var g = r.gained[w];
            var total = g.ice + g.sylvanite + g.celerium;
            var pts = g.ice + g.sylvanite * 2 + g.celerium * 3;
            FX.floatText(from.x, from.y - 34, '+' + pts + 'pt', 'good');
            for (var i = 0; i < Math.min(total, 4); i++) {
              (function (i) {
                jobs.push(U.sleep(self.t(ri * 60 + i * 90)).then(function () {
                  A.coin(i);
                  return FX.fly(from, to, '#f0c14b', { dur: self.t(560), size: 12, glyph: '' });
                }));
              })(i);
            }
          });
        });
        if (!jobs.length) return self.wait(200);
        return Promise.all(jobs).then(function () { return self.wait(260); });
      },

      revealDiscoveries: function (zoneIds) {
        A.fanfare();
        zoneIds.forEach(function (z, i) {
          setTimeout(function () {
            var pt = self.zonePoint(z);
            FX.burst(pt.x, pt.y, '#d9a441', 8, { dist: 40, dur: 620 });
          }, self.t(i * 110));
        });
        return self.wait(700);
      },

      gameOver: function (results) {
        A.fanfare();
        self.showResults(results);
        return Promise.resolve();
      }
    };
  };

  /* ==================== 結果画面 ==================== */

  UI.prototype.showResults = function (results) {
    var m = this.dom.modal, self = this;
    m.className = 'modal';
    m.innerHTML = '';
    var box = el('div', 'modal-box wide');
    var winner = results.winner;
    box.appendChild(el('h2', null, '🏆 ' + winner.name + ' の勝利！'));
    var table = el('div', 'result-table');
    results.ranked.forEach(function (p, i) {
      var row = el('div', 'result-row' + (i === 0 ? ' win' : ''));
      row.style.setProperty('--pc', p.color.hex);
      var head = el('div', 'rr-head');
      head.appendChild(el('span', 'pdot'));
      head.appendChild(el('span', 'rr-name', (i + 1) + '位  ' + p.name));
      head.appendChild(el('span', 'rr-score', p.score + ' 点'));
      row.appendChild(head);
      var det = el('div', 'rr-detail');
      p.scoreDetail.forEach(function (d) {
        var line = el('div', 'rr-line' + (d.pts < 0 ? ' neg' : (d.pts ? '' : ' zero')));
        line.appendChild(el('span', null, d.label));
        line.appendChild(el('span', 'rr-pts', (d.pts >= 0 ? '+' : '') + d.pts));
        det.appendChild(line);
      });
      row.appendChild(det);
      table.appendChild(row);
    });
    box.appendChild(table);
    var again = el('button', 'pbtn big', 'もう一度プレイ');
    again.onclick = function () { location.reload(); };
    box.appendChild(again);
    m.appendChild(box);
  };

  /* ==================== 人間エージェント ==================== */

  function HumanAgent(ui, pid) { this.ui = ui; this.pid = pid; }
  HumanAgent.prototype.choose = function (state, pid, req) {
    return this.ui.requestChoice(pid, req);
  };

  MRP.UI = UI;
  MRP.HumanAgent = HumanAgent;
})(window);
