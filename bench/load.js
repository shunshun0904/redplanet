/* ブラウザ向けのゲームコードを Node から読み込む。
   遊ぶときと寸分違わぬ同じ js/ をそのまま使う（測る用の複製は作らない）。 */
'use strict';

const path = require('path');

globalThis.window = globalThis;

['util.js', 'data.js', 'engine.js', 'ai.js'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f));
});

module.exports = globalThis.MRP;
