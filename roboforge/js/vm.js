/* vm.js — the robot VM. Runs optimised IR one tick at a time so the
   simulator can animate between instructions. */
(function (global) {
  'use strict';

  var OP_BUDGET = 400;       // non-timed instructions allowed inside one tick
  var MAX_TICKS = 20000;     // hard stop so a runaway loop cannot hang the tab

  function VM(ir, robot, log) {
    this.ir = ir;
    this.robot = robot;
    this.log = log || function () {};
    this.labels = {};
    for (var i = 0; i < ir.length; i++) {
      if (ir[i].op === 'LABEL') this.labels[ir[i].a] = i;
    }
    this.reset();
  }

  VM.prototype.reset = function () {
    this.pc = 0;
    this.stack = [];
    this.regs = {};
    this.pending = null;
    this.halted = false;
    this.error = null;
    this.ticks = 0;
    this.currentSrc = null;
  };

  VM.prototype.jump = function (label) {
    if (!(label in this.labels)) throw new Error('missing label ' + label);
    this.pc = this.labels[label];
  };

  /* One tick. Returns a short report the UI can log. */
  VM.prototype.tick = function () {
    if (this.halted) return { halted: true };
    this.ticks++;
    if (this.ticks > MAX_TICKS) {
      return this.fail('program exceeded ' + MAX_TICKS + ' ticks and was stopped');
    }
    if (!this.robot.alive) {
      return this.fail('battery is flat — the robot stopped responding');
    }

    if (this.pending) return this.resume();

    var budget = OP_BUDGET;
    while (budget-- > 0) {
      if (this.pc >= this.ir.length) { this.halted = true; return { halted: true, reason: 'end of program' }; }
      var ins = this.ir[this.pc++];
      this.currentSrc = ins.src || this.currentSrc;
      var res = this.exec(ins);
      if (res) return res;
      if (this.halted) return { halted: true, reason: 'program stopped' };
    }
    return this.fail('loop ran ' + OP_BUDGET + ' instructions without moving — check your loop condition');
  };

  VM.prototype.exec = function (ins) {
    var r = this.robot;
    switch (ins.op) {
      case 'LABEL': return null;
      case 'NOP': return null;

      case 'MOVE':
        if (ins.a <= 0) return null;
        this.pending = { kind: 'move', left: ins.a, src: ins.src };
        return this.resume();

      case 'BACK':
        if (ins.a <= 0) return null;
        this.pending = { kind: 'back', left: ins.a, src: ins.src };
        return this.resume();

      case 'WAIT':
        if (ins.a <= 0) return null;
        this.pending = { kind: 'wait', left: ins.a, src: ins.src };
        return this.resume();

      case 'TURN':
        r.turn(ins.a);
        return { action: 'turn ' + ins.a + ' → now facing ' + r.heading().name, src: ins.src };

      case 'FACE': {
        var want = ins.a % 4, guard = 0;
        while (r.dir !== want && guard++ < 4) r.turn('right');
        return { action: 'face ' + r.heading().name, src: ins.src };
      }

      case 'CHARGE': {
        var out = r.charge(ins.a);
        if (!out.ok) return { action: 'charge failed: ' + out.reason, level: 'warn', src: ins.src };
        return { action: 'charging — battery ' + Math.round(r.battery) + '%', level: 'good', src: ins.src };
      }

      case 'SPEED':
        r.speedMul = Math.max(0.25, Math.min(4, ins.a));
        return { action: 'speed set to ' + r.speedMul + '×', src: ins.src };

      case 'SAY':
        r.lastSay = ins.a;
        r.setMood(r.mood, 30);
        return { action: r.name + ': "' + ins.a + '"', src: ins.src };

      case 'STOP':
        this.halted = true;
        return { halted: true, action: 'STOP reached', src: ins.src };

      case 'HALT':
        this.halted = true;
        return { halted: true, reason: 'end of program', src: ins.src };

      case 'PUSHI':
        this.stack.push(ins.a);
        return null;

      case 'SENSE':
        this.stack.push(r.sensor(ins.a));
        return null;

      case 'CMP': {
        var b = this.stack.pop(), a = this.stack.pop();
        this.stack.push(compare(a, ins.a, b) ? 1 : 0);
        return null;
      }

      case 'JMPF':
        if (!this.stack.pop()) this.jump(ins.target);
        return null;

      case 'JMP':
        this.jump(ins.target);
        return null;

      case 'RPT_INIT':
        this.regs[ins.reg] = ins.a;
        return null;

      case 'RPT_TEST':
        if ((this.regs[ins.reg] || 0) <= 0) this.jump(ins.target);
        return null;

      case 'RPT_NEXT':
        this.regs[ins.reg] = (this.regs[ins.reg] || 0) - 1;
        this.jump(ins.target);
        return null;

      case 'GOALS_TEST':
        if (this.robot.sensor('goalsLeft') <= 0) this.jump(ins.target);
        return null;

      default:
        return this.fail('unknown instruction ' + ins.op);
    }
  };

  /* Finish one unit of a multi-cell or multi-tick instruction. */
  VM.prototype.resume = function () {
    var p = this.pending, r = this.robot, res;
    if (p.kind === 'move' || p.kind === 'back') {
      if (p.kind === 'back') r.turn('right'), r.turn('right');
      res = r.forward();
      if (p.kind === 'back') r.turn('right'), r.turn('right');
      p.left -= 1;
      if (p.left <= 0) this.pending = null;
      if (!res.ok) {
        this.pending = null;
        return { action: 'bumped into a wall at ' + r.x + ',' + r.y, level: 'bad', src: p.src };
      }
      var msg = 'moved to ' + r.x + ',' + r.y;
      var level = null;
      if (res.event === 'goal') { msg = 'goal pad reached at ' + r.x + ',' + r.y; level = 'good'; }
      if (res.event === 'all-goals') { msg = 'all goal pads cleared'; level = 'good'; }
      if (res.event === 'charger') msg = 'parked on the charger at ' + r.x + ',' + r.y;
      if (res.event === 'pit') { msg = 'fell into a pit'; level = 'bad'; this.halted = true; }
      return { action: msg, level: level, src: p.src };
    }
    if (p.kind === 'wait') {
      p.left -= 1;
      r.coolDown();
      if (p.left <= 0) this.pending = null;
      return { action: 'waiting', src: p.src };
    }
    this.pending = null;
    return null;
  };

  VM.prototype.fail = function (message) {
    this.error = message;
    this.halted = true;
    return { halted: true, error: message, level: 'bad' };
  };

  function compare(a, op, b) {
    switch (op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '=': return a === b;
      case '!=': return a !== b;
      case '>=': return a >= b;
      case '>': return a > b;
      default: return false;
    }
  }

  global.RF.VM = VM;
})(window);
