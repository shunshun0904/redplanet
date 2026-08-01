/* ミッション・レッドプラネット — ルールエンジン */
(function (global) {
  'use strict';
  var MRP = (global.MRP = global.MRP || {});
  var D = MRP.data, U = MRP.util;

  var NOOP = function () { return Promise.resolve(); };

  /**
   * @param {object} opts { playerCount, humanName, seed, agents, fx }
   */
  function Game(opts) {
    this.opts = opts;
    this.rng = U.makeRng(opts.seed || (Date.now() & 0xffffffff));
    this.fx = Object.assign({
      render: function () {}, log: function () {},
      placeAstronaut: NOOP, launchShip: NOOP, landShip: NOOP, explodeShip: NOOP,
      killAstronaut: NOOP, moveAstronaut: NOOP, revealCharacters: NOOP,
      production: NOOP, phaseBanner: NOOP, revealDiscoveries: NOOP,
      gameOver: NOOP, beat: NOOP
    }, opts.fx || {});
    this.agents = opts.agents || {};
    this.state = this.setup(opts);
  }

  /* ==================== セットアップ ==================== */

  Game.prototype.setup = function (opts) {
    var rng = this.rng;
    var n = opts.playerCount;
    var players = [];
    for (var i = 0; i < n; i++) {
      var c = D.PLAYER_COLORS[i];
      players.push({
        id: i,
        name: i === 0 ? (opts.humanName || 'あなた') : ('コンピューター ' + i),
        isHuman: i === 0,
        color: c,
        hand: D.CHARACTERS.map(function (ch) { return ch.n; }),
        played: [],
        astronautsLeft: D.ASTRONAUTS_PER_PLAYER,
        tokens: { ice: 0, sylvanite: 0, celerium: 0 },
        missions: [],
        actions: [],
        score: 0,
        scoreDetail: []
      });
    }

    var zones = {};
    D.ZONE_ORDER.forEach(function (id) {
      zones[id] = {
        id: id,
        astronauts: {},                       // pid -> 数
        resource: null, revealed: false,
        pending: { ice: 0, sylvanite: 0, celerium: 0 },
        discovery: null, discoveryRevealed: false
      };
    });

    /* 資源トークンをランダムに配置（11 枚のうち 10 枚を使用） */
    var bag = rng.shuffle(D.RESOURCE_BAG.slice());
    D.ZONE_ORDER.forEach(function (id) { zones[id].resource = bag.pop(); });

    var shipDeck = rng.shuffle(D.buildShipDeck());

    /* イベントデッキ：発見＋アクション＋残りのミッション */
    var missionDeck = rng.shuffle(D.MISSIONS.map(function (m) {
      return { kind: 'mission', def: m };
    }));

    var st = {
      players: players,
      zones: zones,
      memorial: {},
      docks: new Array(n).fill(null),
      launched: [],
      shipDeck: shipDeck,
      shipDiscard: [],
      eventDeck: [],
      eventDiscard: [],
      destTokensUsed: {},
      trackIndex: 0,
      round: 0,
      firstPlayer: 0,
      chosen: {},          // pid -> キャラクター番号
      revealedChoices: {}, // 公開済みの選択
      finished: false,
      results: null,
      log: []
    };

    /* 開始時ミッション：2 枚から 1 枚を選ぶ（選択は run() の冒頭で行う） */
    st._startMissionDeck = missionDeck;

    /* ドックに宇宙船を配置。目的地不明の船はセットアップでは使わない */
    for (var d = 0; d < n; d++) {
      st.docks[d] = drawInitialShip(st, rng);
    }
    /* フォボス行きの船が 1 隻もなければ、右端の船にフォボスの目的地トークンを置く */
    var hasPhobos = st.docks.some(function (s) { return s && s.dest === 'phobos'; });
    if (!hasPhobos) {
      var last = st.docks[n - 1];
      last.destToken = 'phobos';
      st.destTokensUsed.phobos = (st.destTokensUsed.phobos || 0) + 1;
    }

    /* 各船に開始時の宇宙飛行士を 1 体ずつランダムに配置 */
    var order = rng.shuffle(players.map(function (p) { return p.id; }));
    for (var k = 0; k < n; k++) {
      st.docks[k].seats.push(order[k]);
      players[order[k]].astronautsLeft--;
    }
    st.firstPlayer = st.docks[0].seats[0];

    return st;
  };

  function drawInitialShip(st, rng) {
    var idx = st.shipDeck.findIndex(function (s) { return s.dest !== null; });
    if (idx < 0) idx = 0;
    return st.shipDeck.splice(idx, 1)[0];
  }

  /* ==================== 補助 ==================== */

  Game.prototype.log = function (text, cls) {
    this.state.log.push({ text: text, cls: cls || '' });
    this.fx.log(text, cls || '');
  };

  Game.prototype.ask = function (pid, req) {
    var agent = this.agents[pid];
    return Promise.resolve(agent.choose(this.state, pid, req));
  };

  Game.prototype.player = function (pid) { return this.state.players[pid]; };

  function zoneCount(zone, pid) { return zone.astronauts[pid] || 0; }

  function addAstro(zone, pid, n) {
    zone.astronauts[pid] = (zone.astronauts[pid] || 0) + n;
  }
  function removeAstro(zone, pid, n) {
    zone.astronauts[pid] = Math.max(0, (zone.astronauts[pid] || 0) - n);
    if (!zone.astronauts[pid]) delete zone.astronauts[pid];
  }

  Game.prototype.effectiveDest = function (ship) {
    return ship.destToken || ship.dest;
  };

  /** 目的地トークンを置けるエリア（1 エリアにつき 2 枚まで） */
  Game.prototype.availableDestinations = function () {
    var st = this.state, out = [];
    D.ZONE_ORDER.forEach(function (id) {
      if ((st.destTokensUsed[id] || 0) < 2) out.push(id);
    });
    return out;
  };

  Game.prototype.dockedShips = function () {
    return this.state.docks.filter(Boolean);
  };

  /* ==================== メインループ ==================== */

  Game.prototype.run = function () {
    var self = this;
    return (async function () {
      await self.dealStartingMissions();
      self.fx.render();

      while (self.state.trackIndex < D.TRACK.length) {
        var step = D.TRACK[self.state.trackIndex];
        if (step.t === 'round') {
          self.state.round = step.n;
          await self.playRound(step.n);
        } else if (step.t === 'prod') {
          await self.productionPhase(step.n);
        } else if (step.t === 'discovery') {
          await self.revealDiscoveryPhase();
        } else if (step.t === 'final') {
          await self.finalScoring();
        }
        self.state.trackIndex++;
        self.fx.render();
      }
      self.state.finished = true;
      await self.fx.gameOver(self.state.results);
    })();
  };

  Game.prototype.dealStartingMissions = async function () {
    var st = this.state, deck = st._startMissionDeck;
    for (var i = 0; i < st.players.length; i++) {
      var a = deck.pop(), b = deck.pop();
      var choice = await this.ask(i, {
        kind: 'mission',
        prompt: '開始時のミッションカードを1枚選んでください',
        options: [
          { id: '0', label: a.def.ja, sub: a.def.text },
          { id: '1', label: b.def.ja, sub: b.def.text }
        ]
      });
      var keep = choice === '1' ? b : a;
      var back = choice === '1' ? a : b;
      st.players[i].missions.push(keep.def);
      deck.unshift(back);
    }
    /* 残りのミッション＋発見＋アクションでイベントデッキを作る */
    var ev = deck.map(function (m) { return { kind: 'mission', def: m.def }; });
    D.DISCOVERIES.forEach(function (d) { ev.push({ kind: 'discovery', def: d }); });
    D.ACTIONS.forEach(function (a) { ev.push({ kind: 'action', def: a }); });
    st.eventDeck = this.rng.shuffle(ev);
    delete st._startMissionDeck;
    this.log('ミッションカードを配りました。ミッション開始！', 'sys');
  };

  /* ==================== ラウンド ==================== */

  Game.prototype.playRound = async function (n) {
    var st = this.state;
    await this.fx.phaseBanner('ラウンド ' + n + ' / 10', 'キャラクターを選択');

    /* 1. キャラクター選択（同時） */
    st.chosen = {};
    st.revealedChoices = {};
    this.fx.render();
    var self = this;
    await Promise.all(st.players.map(function (p) {
      return self.ask(p.id, {
        kind: 'character',
        prompt: 'このラウンドに使うキャラクターカードを選んでください',
        options: p.hand.map(function (num) {
          var c = D.CHAR_BY_N[num];
          return { id: String(num), label: c.ja, sub: c.text, n: num };
        })
      }).then(function (id) {
        st.chosen[p.id] = parseInt(id, 10);
      });
    }));
    this.fx.render();

    /* 2. キャラクター効果の解決（9 → 1 のカウントダウン） */
    await this.fx.phaseBanner('カウントダウン開始', '9 → 1 の順に解決');
    var lastResolver = st.firstPlayer;
    for (var num = 9; num >= 1; num--) {
      var actors = this.turnOrder().filter(function (pid) { return st.chosen[pid] === num; });
      if (!actors.length) continue;
      st.revealedChoices[num] = actors.slice();
      await this.fx.revealCharacters(num, actors);
      for (var i = 0; i < actors.length; i++) {
        var pid = actors[i];
        var p = this.player(pid);
        p.hand.splice(p.hand.indexOf(num), 1);
        p.played.push(num);
        this.log(p.name + ' が【' + D.CHAR_BY_N[num].ja + '】を発動', 'char p' + pid);
        this.fx.render();
        await this.resolveCharacter(pid, num);
        await this.checkLaunches();
        lastResolver = pid;
        this.fx.render();
        await this.fx.beat();
      }
    }

    /* 3. 発射済みの宇宙船が着陸 */
    await this.landShips();

    /* 4. ドックに新しい宇宙船を補充 */
    this.refillDocks();
    this.fx.render();

    /* 5. 新しいスタートプレイヤー */
    st.firstPlayer = lastResolver;
    this.log('スタートプレイヤーは ' + this.player(lastResolver).name, 'sys');
  };

  /** スタートプレイヤーから時計回りの順番 */
  Game.prototype.turnOrder = function () {
    var st = this.state, n = st.players.length, out = [];
    for (var i = 0; i < n; i++) out.push((st.firstPlayer + i) % n);
    return out;
  };

  /* ==================== キャラクター効果 ==================== */

  Game.prototype.resolveCharacter = async function (pid, num) {
    switch (num) {
      case 9: return this.doRecruiter(pid);
      case 8: return this.doExplorer(pid);
      case 7: return this.doScientist(pid);
      case 6: return this.doSecretAgent(pid);
      case 5: return this.doSaboteur(pid);
      case 4: return this.doFemmeFatale(pid);
      case 3: return this.doTravelAgent(pid);
      case 2: return this.doSoldier(pid);
      case 1: return this.doPilot(pid);
    }
  };

  /** 宇宙船の空席 */
  function room(ship) { return ship.cap - ship.seats.length; }

  /**
   * 宇宙飛行士をドック中の宇宙船に配置する。
   * @param opts { sameShip, distinct, allOrNothing, label }
   * @returns 配置した数
   */
  Game.prototype.placeAstronauts = async function (pid, count, opts) {
    opts = opts || {};
    var st = this.state, p = this.player(pid), placed = 0, fixedShip = null;
    var used = [];

    for (var i = 0; i < count; i++) {
      if (p.astronautsLeft <= 0) break;
      var cands;
      if (fixedShip) {
        cands = room(fixedShip) > 0 ? [fixedShip] : [];
      } else {
        cands = this.dockedShips().filter(function (s) {
          if (room(s) <= 0) return false;
          if (opts.distinct && used.indexOf(s.uid) >= 0) return false;
          return true;
        });
        if (opts.sameShip) {
          var big = cands.filter(function (s) { return room(s) >= count; });
          if (opts.allOrNothing) {
            if (!big.length) return 0;
            cands = big;
          } else if (big.length) {
            cands = big;
          }
        }
      }
      if (!cands.length) break;

      var shipUid;
      if (cands.length === 1) {
        shipUid = cands[0].uid;
      } else {
        shipUid = await this.ask(pid, {
          kind: 'ship',
          prompt: (opts.label || '宇宙飛行士を乗せる宇宙船を選んでください') +
            (count > 1 ? '（残り ' + (count - i) + ' 体）' : ''),
          options: cands.map(function (s) { return { id: s.uid }; })
        });
      }
      var ship = cands.filter(function (s) { return s.uid === shipUid; })[0] || cands[0];
      if (opts.sameShip) fixedShip = ship;
      used.push(ship.uid);

      ship.seats.push(pid);
      p.astronautsLeft--;
      placed++;
      await this.fx.placeAstronaut(pid, ship.uid);

      /* 目的地不明の船に最初の 1 体を乗せたら目的地を決める */
      if (!ship.dest && !ship.destToken && ship.seats.length === 1) {
        await this.assignDestination(pid, ship);
      }
      this.fx.render();
    }
    return placed;
  };

  Game.prototype.assignDestination = async function (pid, ship) {
    var avail = this.availableDestinations();
    if (!avail.length) return;
    var zoneId = avail.length === 1 ? avail[0] : await this.ask(pid, {
      kind: 'zone',
      prompt: '目的地不明の宇宙船の行き先を決めてください',
      context: 'destination', shipUid: ship.uid,
      options: avail.map(function (z) { return { id: z }; })
    });
    ship.destToken = zoneId;
    this.state.destTokensUsed[zoneId] = (this.state.destTokensUsed[zoneId] || 0) + 1;
    this.log(this.player(pid).name + ' が宇宙船の行き先を「' + D.ZONES[zoneId].ja + '」に設定', 'p' + pid);
  };

  /* --- 9 リクルーター --- */
  Game.prototype.doRecruiter = async function (pid) {
    await this.placeAstronauts(pid, 1);
    var p = this.player(pid);
    p.hand = p.hand.concat(p.played);
    p.played = [];
    p.hand.sort(function (a, b) { return b - a; });
    this.log(p.name + ' は使用済みカードをすべて手札に戻した', 'p' + pid);
  };

  /* --- 8 探検家 --- */
  Game.prototype.doExplorer = async function (pid) {
    await this.placeAstronauts(pid, 1);
    var st = this.state;
    for (var m = 0; m < 3; m++) {
      var froms = D.ZONE_ORDER.filter(function (z) {
        return !D.ZONES[z].phobos && zoneCount(st.zones[z], pid) > 0 && D.ZONES[z].adj.length;
      });
      if (!froms.length) break;
      var fromId = await this.ask(pid, {
        kind: 'zone',
        prompt: '移動させる宇宙飛行士のいるエリアを選んでください（残り ' + (3 - m) + ' 回・スキップ可）',
        context: 'moveFrom',
        optional: true,
        options: froms.map(function (z) { return { id: z }; })
      });
      if (!fromId) break;
      var adj = D.ZONES[fromId].adj;
      var toId = await this.ask(pid, {
        kind: 'zone',
        prompt: '移動先の隣接エリアを選んでください',
        context: 'moveTo',
        options: adj.map(function (z) { return { id: z }; })
      });
      if (!toId) break;
      removeAstro(st.zones[fromId], pid, 1);
      addAstro(st.zones[toId], pid, 1);
      this.revealResource(toId);
      this.log(this.player(pid).name + ' が ' + D.ZONES[fromId].ja + ' → ' + D.ZONES[toId].ja + ' へ移動', 'p' + pid);
      await this.fx.moveAstronaut(pid, fromId, toId);
      this.fx.render();
    }
  };

  /* --- 7 科学者 --- */
  Game.prototype.doScientist = async function (pid) {
    await this.placeAstronauts(pid, 2);
    var st = this.state;
    var facedown = D.ZONE_ORDER.filter(function (z) {
      return st.zones[z].discovery && !st.zones[z].discoveryRevealed;
    });
    var opts = [{ id: 'draw', label: 'イベントカードを1枚引く', sub: '残り ' + st.eventDeck.length + ' 枚' }];
    if (facedown.length) opts.push({ id: 'peek', label: '裏向きの発見カードを1枚確認する', sub: facedown.length + ' 枚が場にある' });

    var pick = opts.length === 1 ? 'draw' : await this.ask(pid, {
      kind: 'option', prompt: '科学者の効果を選んでください', options: opts
    });

    if (pick === 'peek') {
      var zoneId = await this.ask(pid, {
        kind: 'zone', prompt: '確認する発見カードのエリアを選んでください',
        context: 'peek', options: facedown.map(function (z) { return { id: z }; })
      });
      var d = st.zones[zoneId].discovery;
      if (this.player(pid).isHuman) {
        this.log('👁 ' + D.ZONES[zoneId].ja + ' の発見カードは「' + d.ja + '」— ' + d.text, 'peek');
      } else {
        this.log(this.player(pid).name + ' が ' + D.ZONES[zoneId].ja + ' の発見カードを確認した', 'p' + pid);
      }
      return;
    }

    if (!st.eventDeck.length) {
      st.eventDeck = this.rng.shuffle(st.eventDiscard.splice(0));
      if (!st.eventDeck.length) return;
    }
    var card = st.eventDeck.pop();
    await this.gainEventCard(pid, card);
  };

  Game.prototype.gainEventCard = async function (pid, card) {
    var st = this.state, p = this.player(pid);
    if (card.kind === 'discovery') {
      var free = D.ZONE_ORDER.filter(function (z) {
        return D.NO_DISCOVERY.indexOf(z) < 0 && !st.zones[z].discovery;
      });
      if (!free.length) {
        st.eventDiscard.push(card);
        this.log(p.name + ' は発見カードを引いたが配置先がなく捨てた', 'p' + pid);
        return;
      }
      var zoneId = free.length === 1 ? free[0] : await this.ask(pid, {
        kind: 'zone', prompt: '発見カード「' + card.def.ja + '」を割り当てるエリアを選んでください',
        context: 'assignDiscovery', card: card.def,
        options: free.map(function (z) { return { id: z }; })
      });
      st.zones[zoneId].discovery = card.def;
      st.zones[zoneId].discoveryRevealed = false;
      this.log(p.name + ' が ' + D.ZONES[zoneId].ja + ' に発見カードを裏向きで配置' +
        (p.isHuman ? '（「' + card.def.ja + '」）' : ''), 'p' + pid);
    } else if (card.kind === 'mission') {
      p.missions.push(card.def);
      this.log(p.name + ' が新たなミッションカードを獲得' + (p.isHuman ? '（「' + card.def.ja + '」）' : ''), 'p' + pid);
    } else {
      p.actions.push(card.def);
      this.log(p.name + ' がアクションカードを獲得' + (p.isHuman ? '（「' + card.def.ja + '」）' : ''), 'p' + pid);
    }
  };

  /* --- 6 秘密諜報員 --- */
  Game.prototype.doSecretAgent = async function (pid) {
    await this.placeAstronauts(pid, 2, { distinct: true });
    var docked = this.dockedShips();
    if (!docked.length) return;
    var uid = docked.length === 1 ? docked[0].uid : await this.ask(pid, {
      kind: 'ship', prompt: '強制発射させる宇宙船を選んでください',
      context: 'forceLaunch', options: docked.map(function (s) { return { id: s.uid }; })
    });
    var ship = docked.filter(function (s) { return s.uid === uid; })[0] || docked[0];
    this.log(this.player(pid).name + ' が宇宙船を強制発射させた', 'p' + pid);
    await this.launch(ship);
  };

  /* --- 5 工作員 --- */
  Game.prototype.doSaboteur = async function (pid) {
    await this.placeAstronauts(pid, 1);
    var docked = this.dockedShips();
    if (!docked.length) return;
    var uid = docked.length === 1 ? docked[0].uid : await this.ask(pid, {
      kind: 'ship', prompt: '破壊する宇宙船を選んでください',
      context: 'destroy', options: docked.map(function (s) { return { id: s.uid }; })
    });
    var ship = docked.filter(function (s) { return s.uid === uid; })[0] || docked[0];
    var st = this.state;
    ship.seats.forEach(function (owner) {
      st.memorial[owner] = (st.memorial[owner] || 0) + 1;
    });
    this.log('💥 ' + this.player(pid).name + ' が宇宙船を破壊！ 乗員 ' + ship.seats.length + ' 名が宇宙の藻屑に', 'bad');
    await this.fx.explodeShip(ship);
    var idx = st.docks.indexOf(ship);
    if (idx >= 0) st.docks[idx] = null;
    if (ship.destToken) {
      st.destTokensUsed[ship.destToken] = Math.max(0, (st.destTokensUsed[ship.destToken] || 1) - 1);
      ship.destToken = null;
    }
    ship.seats = [];
    st.shipDiscard.push(ship);
    this.fx.render();
  };

  /* --- 4 ファム・ファタール --- */
  Game.prototype.doFemmeFatale = async function (pid) {
    await this.placeAstronauts(pid, 1);
    var st = this.state, p = this.player(pid);
    if (p.astronautsLeft <= 0) return;

    var targets = [];
    /* 自分の宇宙飛行士がいるエリア */
    D.ZONE_ORDER.forEach(function (z) {
      var zone = st.zones[z];
      if (zoneCount(zone, pid) <= 0) return;
      Object.keys(zone.astronauts).forEach(function (other) {
        if (+other !== pid && zone.astronauts[other] > 0) {
          targets.push({ id: 'zone:' + z + ':' + other, where: 'zone', zoneId: z, victim: +other });
        }
      });
    });
    /* 自分の宇宙飛行士がいる宇宙船（ドック中／発射済み） */
    st.docks.concat(st.launched).forEach(function (s) {
      if (!s) return;
      if (s.seats.indexOf(pid) < 0) return;
      var others = {};
      s.seats.forEach(function (o) { if (o !== pid) others[o] = true; });
      Object.keys(others).forEach(function (o) {
        targets.push({ id: 'ship:' + s.uid + ':' + o, where: 'ship', shipUid: s.uid, victim: +o });
      });
    });

    if (!targets.length) {
      this.log(p.name + ' のファム・ファタールは標的を見つけられなかった', 'p' + pid);
      return;
    }
    var id = targets.length === 1 ? targets[0].id : await this.ask(pid, {
      kind: 'astronaut', prompt: '入れ替える相手の宇宙飛行士を選んでください',
      context: 'replace', options: targets.map(function (t) { return { id: t.id, target: t }; })
    });
    var t = targets.filter(function (x) { return x.id === id; })[0] || targets[0];

    if (t.where === 'zone') {
      removeAstro(st.zones[t.zoneId], t.victim, 1);
      addAstro(st.zones[t.zoneId], pid, 1);
      await this.fx.killAstronaut(t.victim, t.zoneId);
    } else {
      var ship = st.docks.concat(st.launched).filter(function (s) { return s && s.uid === t.shipUid; })[0];
      var i = ship.seats.indexOf(t.victim);
      if (i >= 0) ship.seats[i] = pid;
    }
    st.memorial[t.victim] = (st.memorial[t.victim] || 0) + 1;
    p.astronautsLeft--;
    this.log('🌹 ' + p.name + ' が ' + this.player(t.victim).name + ' の宇宙飛行士を入れ替えた', 'bad');
    this.fx.render();
  };

  /* --- 3 旅行代理店 --- */
  Game.prototype.doTravelAgent = async function (pid) {
    var placed = await this.placeAstronauts(pid, 3, { sameShip: true, allOrNothing: true, label: '3体まとめて乗せる宇宙船を選んでください' });
    if (!placed) this.log(this.player(pid).name + ' の旅行代理店は空席3以上の船がなく不発', 'p' + pid);
  };

  /* --- 2 軍人 --- */
  Game.prototype.doSoldier = async function (pid) {
    await this.placeAstronauts(pid, 2, { sameShip: true, label: '2体を乗せる宇宙船を選んでください' });
    var st = this.state;
    var targets = [];
    D.ZONE_ORDER.forEach(function (z) {
      if (D.NO_KILL.indexOf(z) >= 0) return;
      var zone = st.zones[z];
      Object.keys(zone.astronauts).forEach(function (o) {
        if (zone.astronauts[o] > 0) targets.push({ id: 'zone:' + z + ':' + o, zoneId: z, victim: +o });
      });
    });
    if (!targets.length) {
      this.log(this.player(pid).name + ' の軍人は排除対象を見つけられなかった', 'p' + pid);
      return;
    }
    var id = targets.length === 1 ? targets[0].id : await this.ask(pid, {
      kind: 'astronaut', prompt: '排除する宇宙飛行士を選んでください（中央2エリアは対象外）',
      context: 'kill', options: targets.map(function (t) { return { id: t.id, target: t }; })
    });
    var t = targets.filter(function (x) { return x.id === id; })[0] || targets[0];
    removeAstro(st.zones[t.zoneId], t.victim, 1);
    st.memorial[t.victim] = (st.memorial[t.victim] || 0) + 1;
    this.log('⚔ ' + this.player(pid).name + ' が ' + D.ZONES[t.zoneId].ja + ' の ' +
      this.player(t.victim).name + ' の宇宙飛行士を排除', 'bad');
    await this.fx.killAstronaut(t.victim, t.zoneId);
    this.fx.render();
  };

  /* --- 1 パイロット --- */
  Game.prototype.doPilot = async function (pid) {
    await this.placeAstronauts(pid, 2);
    var st = this.state;
    var ships = this.dockedShips().concat(st.launched);
    var avail = this.availableDestinations();
    if (!ships.length || !avail.length) return;
    var uid = ships.length === 1 ? ships[0].uid : await this.ask(pid, {
      kind: 'ship', prompt: '目的地を変更する宇宙船を選んでください',
      context: 'retarget', options: ships.map(function (s) { return { id: s.uid }; })
    });
    var ship = ships.filter(function (s) { return s.uid === uid; })[0] || ships[0];
    var zoneId = avail.length === 1 ? avail[0] : await this.ask(pid, {
      kind: 'zone', prompt: '新しい目的地を選んでください',
      context: 'destination', shipUid: ship.uid,
      options: avail.map(function (z) { return { id: z }; })
    });
    if (ship.destToken) {
      st.destTokensUsed[ship.destToken] = Math.max(0, (st.destTokensUsed[ship.destToken] || 1) - 1);
    }
    ship.destToken = zoneId;
    st.destTokensUsed[zoneId] = (st.destTokensUsed[zoneId] || 0) + 1;
    this.log('🚀 ' + this.player(pid).name + ' が宇宙船の行き先を「' + D.ZONES[zoneId].ja + '」に変更', 'p' + pid);
    this.fx.render();
  };

  /* ==================== 発射・着陸 ==================== */

  Game.prototype.checkLaunches = async function () {
    var st = this.state;
    for (var i = 0; i < st.docks.length; i++) {
      var s = st.docks[i];
      if (s && s.seats.length >= s.cap) {
        await this.launch(s);
      }
    }
  };

  Game.prototype.launch = async function (ship) {
    var st = this.state;
    var idx = st.docks.indexOf(ship);
    if (idx >= 0) st.docks[idx] = null;
    st.launched.push(ship);
    var dest = this.effectiveDest(ship);
    this.log('🚀 宇宙船が発射（' + (dest ? D.ZONES[dest].ja : '目的地未定') + ' 行き・乗員 ' + ship.seats.length + '）', 'launch');
    await this.fx.launchShip(ship);
    this.fx.render();
  };

  Game.prototype.landShips = async function () {
    var st = this.state;
    if (!st.launched.length) return;
    await this.fx.phaseBanner('着陸', '発射した宇宙船が火星に到達');
    while (st.launched.length) {
      var ship = st.launched.shift();
      var dest = this.effectiveDest(ship);
      if (dest && ship.seats.length) {
        var zone = st.zones[dest];
        ship.seats.forEach(function (o) { addAstro(zone, o, 1); });
        this.revealResource(dest);
        this.log('🛬 ' + D.ZONES[dest].ja + ' に ' + ship.seats.length + ' 名が着陸', 'land');
        await this.fx.landShip(ship, dest);
      }
      if (ship.destToken) {
        st.destTokensUsed[ship.destToken] = Math.max(0, (st.destTokensUsed[ship.destToken] || 1) - 1);
        ship.destToken = null;
      }
      ship.seats = [];
      st.shipDiscard.push(ship);
      this.fx.render();
    }
  };

  Game.prototype.revealResource = function (zoneId) {
    var zone = this.state.zones[zoneId];
    if (!zone.revealed && zone.resource) {
      zone.revealed = true;
      var r = D.RESOURCES[zone.resource];
      this.log('🔎 ' + D.ZONES[zoneId].ja + ' の資源は「' + r.ja + '」（' + r.value + '点）', 'reveal');
    }
  };

  Game.prototype.refillDocks = function () {
    var st = this.state;
    for (var i = 0; i < st.docks.length; i++) {
      if (st.docks[i]) continue;
      if (!st.shipDeck.length) {
        st.shipDeck = this.rng.shuffle(st.shipDiscard.splice(0));
      }
      if (!st.shipDeck.length) break;
      st.docks[i] = st.shipDeck.pop();
    }
  };

  /* ==================== 生産フェイズ ==================== */

  /** 第3生産フェイズで有効な発見カードの効果 */
  function discoveryOf(state, zoneId, id) {
    var z = state.zones[zoneId];
    return z.discovery && z.discoveryRevealed && z.discovery.id === id;
  }

  Game.prototype.productionPhase = async function (phase) {
    var st = this.state, self = this;
    var label = ['第1生産フェイズ', '第2生産フェイズ', '第3生産フェイズ'][phase - 1];
    await this.fx.phaseBanner(label, '各エリアが ' + phase + ' 個の得点トークンを産出');

    if (phase === 3) await this.resolvePreProductionActions();

    var results = [];
    D.ZONE_ORDER.forEach(function (zid) {
      var zone = st.zones[zid];
      if (!zone.revealed) return;

      /* --- 産出 --- */
      if (phase < 3 || !discoveryOf(st, zid, 'incident')) {
        var amount = phase;
        if (phase === 3) {
          if (discoveryOf(st, zid, 'richvein')) amount += 2;
          D.ZONES[zid].adj.forEach(function (n) {
            if (discoveryOf(st, n, 'synergy')) amount += 1;
          });
        }
        var type = zone.resource;
        if (phase === 3 && discoveryOf(st, zid, 'frozen')) type = 'ice';
        zone.pending[type] += amount;
      }

      /* --- 多数派の判定 --- */
      var counts = {};
      Object.keys(zone.astronauts).forEach(function (p) {
        if (zone.astronauts[p] > 0) counts[p] = zone.astronauts[p];
      });
      if (phase === 3) {
        if (discoveryOf(st, zid, 'even')) {
          Object.keys(counts).forEach(function (p) { counts[p] = 1; });
        } else if (discoveryOf(st, zid, 'uneven')) {
          Object.keys(counts).forEach(function (p) { counts[p] = 100 - counts[p]; });
        }
      }
      var winners;
      if (phase === 3 && discoveryOf(st, zid, 'subterfuge')) {
        winners = secondMost(counts);
      } else {
        winners = U.argMaxKeys(counts).keys;
      }
      if (!winners.length) return;

      /* --- 分配 --- */
      var gained = {};
      ['ice', 'sylvanite', 'celerium'].forEach(function (t) {
        var total = zone.pending[t];
        if (!total) return;
        var each = Math.floor(total / winners.length);
        if (!each) return;
        winners.forEach(function (w) {
          st.players[+w].tokens[t] += each;
          gained[w] = gained[w] || { ice: 0, sylvanite: 0, celerium: 0 };
          gained[w][t] += each;
        });
        zone.pending[t] = total - each * winners.length;
      });
      if (Object.keys(gained).length) {
        results.push({ zoneId: zid, winners: winners.map(Number), gained: gained });
        winners.forEach(function (w) {
          var g = gained[w];
          if (!g) return;
          var parts = [];
          ['ice', 'sylvanite', 'celerium'].forEach(function (t) {
            if (g[t]) parts.push(D.RESOURCES[t].ja + '×' + g[t]);
          });
          if (parts.length) {
            self.log('⛏ ' + D.ZONES[zid].ja + '：' + st.players[+w].name + ' が ' + parts.join('・') + ' を獲得', 'prod p' + w);
          }
        });
      }
    });

    await this.fx.production(phase, results);
    if (phase === 3) await this.resolvePostProductionActions();
    this.fx.render();
  };

  function secondMost(counts) {
    var vals = Object.keys(counts).map(function (k) { return counts[k]; });
    if (!vals.length) return [];
    var uniq = vals.slice().sort(function (a, b) { return b - a; })
      .filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    if (uniq.length < 2) return [];
    var target = uniq[1];
    return Object.keys(counts).filter(function (k) { return counts[k] === target; });
  }

  /* ==================== アクションカード ==================== */

  Game.prototype.resolvePreProductionActions = async function () {
    var st = this.state, self = this;
    for (var i = 0; i < st.players.length; i++) {
      var p = st.players[i];
      var keep = [];
      for (var j = 0; j < p.actions.length; j++) {
        var a = p.actions[j];
        if (a.id === 'rescue') {
          var back = Math.min(2, st.memorial[p.id] || 0);
          var host = D.ZONE_ORDER.filter(function (z) { return zoneCount(st.zones[z], p.id) > 0; });
          if (back > 0 && host.length) {
            var best = self.bestZoneFor(p.id, host);
            st.memorial[p.id] -= back;
            addAstro(st.zones[best], p.id, back);
            self.log('🛟 ' + p.name + ' の【救助作戦】：' + D.ZONES[best].ja + ' に ' + back + ' 名が帰還', 'good');
          }
        } else if (a.id === 'espionage') {
          var cands = [];
          D.ZONE_ORDER.forEach(function (z) {
            if (zoneCount(st.zones[z], p.id) <= 0) return;
            Object.keys(st.zones[z].astronauts).forEach(function (o) {
              if (+o !== p.id && st.zones[z].astronauts[o] > 0) cands.push({ z: z, o: +o });
            });
          });
          if (cands.length) {
            cands.sort(function (a2, b2) { return self.zoneValue(b2.z, 3) - self.zoneValue(a2.z, 3); });
            var t = cands[0];
            removeAstro(st.zones[t.z], t.o, 1);
            st.memorial[t.o] = (st.memorial[t.o] || 0) + 1;
            self.log('🕵 ' + p.name + ' の【産業スパイ】：' + D.ZONES[t.z].ja + ' の ' +
              st.players[t.o].name + ' の宇宙飛行士を排除', 'bad');
          }
        } else {
          keep.push(a);
          continue;
        }
      }
      p.actions = keep;
    }
    this.fx.render();
  };

  Game.prototype.resolvePostProductionActions = async function () {
    var st = this.state;
    st.players.forEach(function (p) {
      var keep = [];
      p.actions.forEach(function (a) {
        if (a.id === 'blocks') {
          p.tokens.ice += 2;
          st.log.push({ text: '🧊 ' + p.name + ' の【氷塊】：氷トークン2個を獲得', cls: 'good' });
        } else if (a.id === 'etherwind') {
          p.tokens.celerium += 1;
          st.log.push({ text: '✦ ' + p.name + ' の【エーテルの風】：セレリウム1個を獲得', cls: 'good' });
        } else keep.push(a);
      });
      p.actions = keep;
    });
    this.fx.render();
  };

  /* ==================== 発見カード公開フェイズ ==================== */

  Game.prototype.revealDiscoveryPhase = async function () {
    var st = this.state, self = this;
    var zonesWith = D.ZONE_ORDER.filter(function (z) { return st.zones[z].discovery; });
    if (!zonesWith.length) return;
    await this.fx.phaseBanner('発見カード公開', 'すべての発見カードが明らかに');
    zonesWith.forEach(function (z) { st.zones[z].discoveryRevealed = true; });
    await this.fx.revealDiscoveries(zonesWith);

    for (var i = 0; i < zonesWith.length; i++) {
      var zid = zonesWith[i];
      var d = st.zones[zid].discovery;
      this.log('📜 ' + D.ZONES[zid].ja + '：発見「' + d.ja + '」— ' + d.text, 'reveal');
      if (d.when !== 'reveal') continue;

      if (d.id === 'ether') {
        var moved = 0;
        st.docks.forEach(function (s) {
          if (!s) return;
          s.seats.forEach(function (o) { addAstro(st.zones[zid], o, 1); moved++; });
          s.seats = [];
        });
        if (moved) { this.revealResource(zid); this.log('🧲 ドック中の ' + moved + ' 名が ' + D.ZONES[zid].ja + ' へ引き寄せられた', 'good'); }
      } else if (d.id === 'native') {
        var zone = st.zones[zid];
        Object.keys(zone.astronauts).slice().forEach(function (o) {
          if (zone.astronauts[o] > 0) {
            removeAstro(zone, +o, 1);
            st.memorial[+o] = (st.memorial[+o] || 0) + 1;
          }
        });
        this.log('☠ ' + D.ZONES[zid].ja + ' で各プレイヤーが1名を失った', 'bad');
      } else if (d.id === 'sandstorm') {
        var zone2 = st.zones[zid], adj = D.ZONES[zid].adj;
        if (adj.length) {
          Object.keys(zone2.astronauts).slice().forEach(function (o) {
            var n = zone2.astronauts[o] || 0;
            if (!n) return;
            var target = self.bestZoneFor(+o, adj);
            removeAstro(zone2, +o, n);
            addAstro(st.zones[target], +o, n);
            self.revealResource(target);
          });
          this.log('🌪 ' + D.ZONES[zid].ja + ' の宇宙飛行士が隣接エリアへ退避', 'bad');
        }
      }
      this.fx.render();
    }
  };

  /** 指定プレイヤーにとって最も価値の高いエリアを候補から選ぶ */
  Game.prototype.bestZoneFor = function (pid, candidates) {
    var st = this.state, self = this, best = candidates[0], bestV = -Infinity;
    candidates.forEach(function (z) {
      var v = self.zoneValue(z, 3) * (1 + zoneCount(st.zones[z], pid) * 0.4);
      if (v > bestV) { bestV = v; best = z; }
    });
    return best;
  };

  /** エリアの期待価値（未公開なら平均 1.73 点として扱う） */
  Game.prototype.zoneValue = function (zoneId, phaseLeftWeight) {
    var zone = this.state.zones[zoneId];
    var v = zone.revealed ? D.RESOURCES[zone.resource].value : 1.73;
    var pend = zone.pending.ice + zone.pending.sylvanite * 2 + zone.pending.celerium * 3;
    return v * (phaseLeftWeight || 1) + pend;
  };

  /* ==================== 最終得点計算 ==================== */

  Game.prototype.finalScoring = async function () {
    var st = this.state, self = this;
    await this.fx.phaseBanner('最終得点計算', 'ミッションと発見が明らかに');

    st.players.forEach(function (p) {
      p.score = 0;
      p.scoreDetail = [];
      var tok = p.tokens.ice * 1 + p.tokens.sylvanite * 2 + p.tokens.celerium * 3;
      p.score += tok;
      p.scoreDetail.push({
        label: '得点トークン（氷' + p.tokens.ice + '／シルバナイト' + p.tokens.sylvanite +
          '／セレリウム' + p.tokens.celerium + '）', pts: tok
      });
    });

    /* 氷の独占（グローバルミッション） */
    var iceMap = {};
    st.players.forEach(function (p) { iceMap[p.id] = p.tokens.ice; });
    var iceWin = U.argMaxKeys(iceMap).keys;
    if (iceWin.length) {
      var per = Math.floor(9 / iceWin.length);
      iceWin.forEach(function (w) {
        st.players[+w].score += per;
        st.players[+w].scoreDetail.push({ label: 'グローバルミッション「氷の独占」', pts: per });
      });
    }

    /* 個人ミッション */
    st.players.forEach(function (p) {
      p.missions.forEach(function (m) {
        var pts = self.scoreMission(p, m);
        if (pts) {
          p.score += pts;
          p.scoreDetail.push({ label: 'ミッション「' + m.ja + '」', pts: pts });
        } else {
          p.scoreDetail.push({ label: 'ミッション「' + m.ja + '」（未達成）', pts: 0 });
        }
      });
    });

    /* 最終得点時に発動する発見カード */
    D.ZONE_ORDER.forEach(function (zid) {
      var zone = st.zones[zid];
      if (!zone.discovery || zone.discovery.when !== 'final') return;
      var d = zone.discovery;
      if (d.id === 'lichens') {
        Object.keys(zone.astronauts).forEach(function (o) {
          if (zone.astronauts[o] > 0) {
            st.players[+o].score += 6;
            st.players[+o].scoreDetail.push({ label: '発見「地衣類」（' + D.ZONES[zid].ja + '）', pts: 6 });
          }
        });
      } else if (d.id === 'lake') {
        var w = U.argMaxKeys(zone.astronauts).keys;
        w.forEach(function (o) {
          st.players[+o].score += 4;
          st.players[+o].scoreDetail.push({ label: '発見「地下湖」（' + D.ZONES[zid].ja + '）', pts: 4 });
        });
      } else if (d.id === 'radiation') {
        Object.keys(zone.astronauts).forEach(function (o) {
          if (zone.astronauts[o] > 0) {
            st.players[+o].score -= 3;
            st.players[+o].scoreDetail.push({ label: '発見「放射線漏れ」（' + D.ZONES[zid].ja + '）', pts: -3 });
          }
        });
      }
    });

    var ranked = st.players.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return U.sum(b.tokens) - U.sum(a.tokens);
    });
    st.results = { ranked: ranked, winner: ranked[0] };
    this.log('🏆 勝者：' + ranked[0].name + '（' + ranked[0].score + ' 点）', 'win');
    this.fx.render();
  };

  Game.prototype.scoreMission = function (p, m) {
    var st = this.state, pid = p.id;
    var totalOnMars = 0, zonesPresent = 0;
    D.ZONE_ORDER.forEach(function (z) {
      var c = zoneCount(st.zones[z], pid);
      totalOnMars += c;
      if (c > 0) zonesPresent++;
    });

    function mostIn(zoneIds) {
      var totals = {};
      st.players.forEach(function (q) {
        var s = 0;
        zoneIds.forEach(function (z) { s += zoneCount(st.zones[z], q.id); });
        if (s > 0) totals[q.id] = s;
      });
      var w = U.argMaxKeys(totals).keys;
      return w.indexOf(String(pid)) >= 0;
    }
    function mostToken(type) {
      var map = {};
      st.players.forEach(function (q) { map[q.id] = q.tokens[type]; });
      var w = U.argMaxKeys(map).keys;
      return w.indexOf(String(pid)) >= 0;
    }

    switch (m.id) {
      case 'eastern':
        var c = D.RED_ZONES.filter(function (z) { return zoneCount(st.zones[z], pid) > 0; }).length;
        return [0, 1, 2, 4, 7][c] || 0;
      case 'strategic': return mostIn(['syrtis', 'marineris']) ? 8 : 0;
      case 'moonbase': return Math.min(8, zoneCount(st.zones.phobos, pid) * 2);
      case 'celbaron': return mostToken('celerium') ? 8 : 0;
      case 'sylbaron': return mostToken('sylvanite') ? 8 : 0;
      case 'iceprosp': return p.tokens.ice >= 5 ? 7 : 0;
      case 'expansion': return zonesPresent;
      case 'colonist': return totalOnMars >= 10 ? 7 : 0;
      case 'memorial': return Math.min(8, (st.memorial[pid] || 0) * 2);
      case 'diverse': return (p.tokens.ice && p.tokens.sylvanite && p.tokens.celerium) ? 6 : 0;
      case 'claim_borealis': return mostIn(['borealis']) ? 5 : 0;
      case 'claim_sabaeus': return mostIn(['sabaeus']) ? 5 : 0;
      case 'claim_syrtis': return mostIn(['syrtis']) ? 5 : 0;
    }
    return 0;
  };

  MRP.Game = Game;
  MRP.helpers = { zoneCount: zoneCount, room: room, addAstro: addAstro, removeAstro: removeAstro };
})(window);
