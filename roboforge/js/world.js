/* world.js — the grid the robot lives in. */
(function (global) {
  'use strict';

  var TILE = {
    EMPTY: 0,
    WALL: 1,
    TARGET: 2,
    CHARGER: 3,
    CRATE: 4,
    PIT: 5
  };

  var TILE_META = {
    0: { name: 'Floor', color: '#111c26' },
    1: { name: 'Wall', color: '#3c5468' },
    2: { name: 'Goal pad', color: '#4fd6a6' },
    3: { name: 'Charger', color: '#f2a93b' },
    4: { name: 'Crate', color: '#a98bf0' },
    5: { name: 'Pit', color: '#ef6b6b' }
  };

  function World(cols, rows) {
    this.cols = cols || 20;
    this.rows = rows || 15;
    this.start = { x: 1, y: 1, dir: 1 };
    this.cells = new Array(this.cols * this.rows).fill(TILE.EMPTY);
    this.border();
  }

  World.prototype.index = function (x, y) { return y * this.cols + x; };

  World.prototype.inside = function (x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  };

  World.prototype.get = function (x, y) {
    if (!this.inside(x, y)) return TILE.WALL;
    return this.cells[this.index(x, y)];
  };

  World.prototype.set = function (x, y, tile) {
    if (!this.inside(x, y)) return false;
    this.cells[this.index(x, y)] = tile;
    return true;
  };

  World.prototype.blocked = function (x, y) {
    var t = this.get(x, y);
    return t === TILE.WALL || t === TILE.CRATE;
  };

  World.prototype.clear = function () {
    this.cells.fill(TILE.EMPTY);
  };

  World.prototype.border = function () {
    for (var x = 0; x < this.cols; x++) {
      this.set(x, 0, TILE.WALL);
      this.set(x, this.rows - 1, TILE.WALL);
    }
    for (var y = 0; y < this.rows; y++) {
      this.set(0, y, TILE.WALL);
      this.set(this.cols - 1, y, TILE.WALL);
    }
  };

  World.prototype.scatter = function (density) {
    var d = typeof density === 'number' ? density : 0.12;
    for (var y = 1; y < this.rows - 1; y++) {
      for (var x = 1; x < this.cols - 1; x++) {
        if (x === this.start.x && y === this.start.y) continue;
        if (this.get(x, y) !== TILE.EMPTY) continue;
        if (Math.random() < d) this.set(x, y, TILE.WALL);
      }
    }
  };

  World.prototype.countTile = function (tile) {
    var n = 0;
    for (var i = 0; i < this.cells.length; i++) if (this.cells[i] === tile) n++;
    return n;
  };

  World.prototype.toJSON = function () {
    return {
      cols: this.cols,
      rows: this.rows,
      start: { x: this.start.x, y: this.start.y, dir: this.start.dir },
      cells: this.cells.slice()
    };
  };

  World.fromJSON = function (data) {
    if (!data || typeof data !== 'object') throw new Error('world data is not an object');
    var w = new World(data.cols, data.rows);
    if (Array.isArray(data.cells) && data.cells.length === w.cols * w.rows) {
      w.cells = data.cells.slice();
    }
    if (data.start) {
      w.start = {
        x: clampInt(data.start.x, 0, w.cols - 1, 1),
        y: clampInt(data.start.y, 0, w.rows - 1, 1),
        dir: clampInt(data.start.dir, 0, 3, 1)
      };
    }
    return w;
  };

  function clampInt(v, lo, hi, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  /* A few hand-built maps used by the test lab and the first load. */
  function preset(name) {
    var w = new World(20, 15);
    if (name === 'open') {
      w.set(10, 7, TILE.TARGET);
      w.set(3, 11, TILE.CHARGER);
      return w;
    }
    if (name === 'corridor') {
      for (var x = 2; x < 18; x++) { w.set(x, 5, TILE.WALL); w.set(x, 9, TILE.WALL); }
      w.set(17, 7, TILE.TARGET);
      w.start = { x: 2, y: 7, dir: 1 };
      return w;
    }
    if (name === 'maze') {
      var plan = [
        '####################',
        '#S...#.......#.....#',
        '#.##.#.#####.#.###.#',
        '#.#..#.....#.#...#.#',
        '#.#.####.#.#.###.#.#',
        '#.#....#.#.#...#.#.#',
        '#.####.#.#.###.#.#.#',
        '#......#.#...#.#...#',
        '#.######.###.#.####.',
        '#........#...#....G#',
        '#.######.#.#####.#.#',
        '#.#....#.#.....#.#.#',
        '#.#.##.#.#####.#.#.#',
        '#C..##.........#...#',
        '####################'
      ];
      applyPlan(w, plan);
      return w;
    }
    if (name === 'collect') {
      w.set(5, 3, TILE.TARGET); w.set(14, 4, TILE.TARGET);
      w.set(8, 10, TILE.TARGET); w.set(16, 11, TILE.TARGET);
      w.set(3, 12, TILE.CHARGER);
      for (var y = 4; y < 11; y++) w.set(10, y, TILE.WALL);
      w.set(10, 7, TILE.EMPTY);
      return w;
    }
    if (name === 'battery') {
      w.set(17, 12, TILE.TARGET);
      w.set(9, 7, TILE.CHARGER);
      for (var i = 4; i < 12; i++) w.set(6, i, TILE.WALL);
      return w;
    }
    w.set(10, 7, TILE.TARGET);
    return w;
  }

  function applyPlan(w, plan) {
    w.clear();
    for (var y = 0; y < plan.length && y < w.rows; y++) {
      for (var x = 0; x < plan[y].length && x < w.cols; x++) {
        var ch = plan[y][x];
        if (ch === '#') w.set(x, y, TILE.WALL);
        else if (ch === 'G') w.set(x, y, TILE.TARGET);
        else if (ch === 'C') w.set(x, y, TILE.CHARGER);
        else if (ch === 'X') w.set(x, y, TILE.CRATE);
        else if (ch === 'S') { w.start = { x: x, y: y, dir: 1 }; }
      }
    }
  }

  global.RF = global.RF || {};
  global.RF.TILE = TILE;
  global.RF.TILE_META = TILE_META;
  global.RF.World = World;
  global.RF.preset = preset;
})(window);
