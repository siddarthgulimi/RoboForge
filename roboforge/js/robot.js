/* robot.js — the test subject. State, sensors, and the mood engine. */
(function (global) {
  'use strict';

  var TILE = global.RF.TILE;

  /* Heading: 0 = north, 1 = east, 2 = south, 3 = west. */
  var DIRS = [
    { dx: 0, dy: -1, name: 'N' },
    { dx: 1, dy: 0, name: 'E' },
    { dx: 0, dy: 1, name: 'S' },
    { dx: -1, dy: 0, name: 'W' }
  ];

  var CHASSIS = {
    scout:   { label: 'Scout',   speed: 1.30, drain: 0.55, armor: 1, sensorRange: 9 },
    hauler:  { label: 'Hauler',  speed: 0.80, drain: 0.40, armor: 3, sensorRange: 5 },
    sprinter:{ label: 'Sprinter',speed: 1.70, drain: 0.95, armor: 1, sensorRange: 6 },
    surveyor:{ label: 'Surveyor',speed: 1.00, drain: 0.50, armor: 2, sensorRange: 12 }
  };

  var MOODS = {
    curious:  { face: '•ᴗ•',  label: 'Curious',  line: 'Waiting for orders.' },
    focused:  { face: '⌐■-■', label: 'Focused',  line: 'Running the routine.' },
    happy:    { face: '^ᴗ^',  label: 'Happy',    line: 'Reached a goal pad.' },
    hurt:     { face: '×╭╮×', label: 'Bruised',  line: 'That was a wall.' },
    tired:    { face: '-.-',  label: 'Tired',    line: 'Battery is running low.' },
    hot:      { face: '>_<',  label: 'Overheated', line: 'Motors need a moment.' },
    charging: { face: 'ᵔᴗᵔ',  label: 'Charging', line: 'Topping up on the pad.' },
    dead:     { face: 'x_x',  label: 'Flat',     line: 'Battery empty. Reset to revive.' },
    proud:    { face: '★ᴗ★',  label: 'Proud',    line: 'All goal pads cleared.' }
  };

  function Robot(world, opts) {
    this.world = world;
    this.chassis = (opts && opts.chassis) || 'scout';
    this.color = (opts && opts.color) || '#5fb7f0';
    this.name = (opts && opts.name) || 'Scrappy';
    this.chatty = true;
    this.showTrail = true;
    this.reset();
  }

  Robot.prototype.spec = function () { return CHASSIS[this.chassis] || CHASSIS.scout; };

  Robot.prototype.reset = function () {
    var s = this.world.start;
    this.x = s.x; this.y = s.y; this.dir = s.dir;
    this.rx = s.x; this.ry = s.y;            // render position (animated)
    this.rdir = s.dir * 90;                  // render heading in degrees
    this.battery = 100;
    this.heat = 28;
    this.steps = 0;
    this.bumps = 0;
    this.speedMul = 1;
    this.alive = true;
    this.mood = 'curious';
    this.moodTimer = 0;
    this.trail = [{ x: s.x, y: s.y }];
    this.collected = {};
    this.targetsTotal = this.world.countTile(TILE.TARGET);
    this.targetsHit = 0;
    this.lastSay = '';
  };

  Robot.prototype.heading = function () { return DIRS[this.dir]; };

  Robot.prototype.ahead = function (n) {
    var d = DIRS[this.dir];
    return { x: this.x + d.dx * (n || 1), y: this.y + d.dy * (n || 1) };
  };

  /* Sensors -------------------------------------------------------------- */

  Robot.prototype.distance = function () {
    var range = this.spec().sensorRange, d = DIRS[this.dir];
    for (var i = 1; i <= range; i++) {
      if (this.world.blocked(this.x + d.dx * i, this.y + d.dy * i)) return i - 1;
    }
    return range;
  };

  Robot.prototype.sideDistance = function (turn) {
    var dir = (this.dir + (turn === 'left' ? 3 : 1)) % 4;
    var d = DIRS[dir], range = this.spec().sensorRange;
    for (var i = 1; i <= range; i++) {
      if (this.world.blocked(this.x + d.dx * i, this.y + d.dy * i)) return i - 1;
    }
    return range;
  };

  Robot.prototype.sensor = function (name) {
    switch (name) {
      case 'distance': return this.distance();
      case 'left': return this.sideDistance('left');
      case 'right': return this.sideDistance('right');
      case 'battery': return Math.round(this.battery);
      case 'heat': return Math.round(this.heat);
      case 'onTarget': return this.world.get(this.x, this.y) === TILE.TARGET ? 1 : 0;
      case 'onCharger': return this.world.get(this.x, this.y) === TILE.CHARGER ? 1 : 0;
      case 'bumps': return this.bumps;
      case 'steps': return this.steps;
      case 'x': return this.x;
      case 'y': return this.y;
      case 'heading': return this.dir;
      case 'goalsLeft': return Math.max(0, this.targetsTotal - this.targetsHit);
      default: throw new Error('unknown sensor: ' + name);
    }
  };

  /* Actions -------------------------------------------------------------- */

  Robot.prototype.forward = function () {
    if (!this.alive) return { ok: false, reason: 'flat battery' };
    var t = this.ahead(1);
    if (this.world.blocked(t.x, t.y)) {
      this.bumps++;
      this.heat += 3;
      this.drain(0.4);
      this.setMood('hurt', 90);
      return { ok: false, reason: 'wall ahead', bump: true };
    }
    this.x = t.x; this.y = t.y;
    this.steps++;
    this.drain(this.spec().drain);
    this.heat += 0.7;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 400) this.trail.shift();

    var tile = this.world.get(this.x, this.y);
    var evt = null;
    if (tile === TILE.TARGET) {
      var key = this.x + ',' + this.y;
      if (!this.collected[key]) {
        this.collected[key] = true;
        this.targetsHit++;
        evt = this.targetsHit >= this.targetsTotal && this.targetsTotal > 0 ? 'all-goals' : 'goal';
        this.setMood(evt === 'all-goals' ? 'proud' : 'happy', 140);
      }
    } else if (tile === TILE.PIT) {
      this.alive = false;
      this.setMood('dead', 999);
      evt = 'pit';
    } else if (tile === TILE.CHARGER) {
      evt = 'charger';
    }
    this.coolDown();
    return { ok: true, event: evt };
  };

  Robot.prototype.turn = function (side) {
    this.dir = side === 'left' ? (this.dir + 3) % 4 : (this.dir + 1) % 4;
    this.drain(0.15);
    this.heat += 0.3;
    this.coolDown();
    return { ok: true };
  };

  Robot.prototype.charge = function (amount) {
    if (this.world.get(this.x, this.y) !== TILE.CHARGER) {
      return { ok: false, reason: 'not on a charger' };
    }
    this.battery = Math.min(100, this.battery + (amount || 12));
    this.heat = Math.max(26, this.heat - 3);
    if (this.battery > 5) this.alive = true;
    this.setMood('charging', 60);
    return { ok: true };
  };

  Robot.prototype.drain = function (amount) {
    this.battery = Math.max(0, this.battery - amount);
    if (this.battery <= 0) {
      this.battery = 0;
      this.alive = false;
      this.setMood('dead', 999);
    } else if (this.battery < 20) {
      this.setMood('tired', 40);
    }
  };

  Robot.prototype.coolDown = function () {
    this.heat = Math.max(26, this.heat - 0.35);
    if (this.heat > 85) this.setMood('hot', 80);
  };

  /* Mood ----------------------------------------------------------------- */

  Robot.prototype.setMood = function (mood, priority) {
    var p = priority || 10;
    if (p >= this.moodTimer) { this.mood = mood; this.moodTimer = p; }
  };

  Robot.prototype.tickMood = function (running) {
    if (this.moodTimer > 0) this.moodTimer -= 1;
    if (this.moodTimer <= 0) {
      if (!this.alive) this.mood = 'dead';
      else if (this.battery < 20) this.mood = 'tired';
      else if (this.heat > 85) this.mood = 'hot';
      else if (running) this.mood = 'focused';
      else this.mood = 'curious';
    }
  };

  Robot.prototype.moodInfo = function () {
    var m = MOODS[this.mood] || MOODS.curious;
    if (this.lastSay && this.chatty) {
      return { face: m.face, label: m.label, line: '"' + this.lastSay + '"' };
    }
    return m;
  };

  /* Smooth render interpolation between grid cells. */
  Robot.prototype.animate = function (dt) {
    var k = Math.min(1, dt * 12);
    this.rx += (this.x - this.rx) * k;
    this.ry += (this.y - this.ry) * k;
    var target = this.dir * 90;
    var delta = ((target - this.rdir + 540) % 360) - 180;
    this.rdir += delta * k;
  };

  global.RF.Robot = Robot;
  global.RF.DIRS = DIRS;
  global.RF.CHASSIS = CHASSIS;
  global.RF.MOODS = MOODS;
})(window);
