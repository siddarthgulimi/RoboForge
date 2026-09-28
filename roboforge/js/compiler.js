/* compiler.js — block tree -> IR -> optimised IR -> bytecode.
   The VM runs the optimised IR; the bytecode is the packed form shown
   on the Compiler page. */
(function (global) {
  'use strict';

  var OPCODES = {
    NOP: 0x00, MOVE: 0x01, BACK: 0x02, TURN: 0x03, FACE: 0x04,
    WAIT: 0x05, CHARGE: 0x06, SPEED: 0x07, SAY: 0x08, STOP: 0x09,
    PUSHI: 0x10, SENSE: 0x11, CMP: 0x12, JMPF: 0x13, JMP: 0x14,
    RPT_INIT: 0x20, RPT_TEST: 0x21, RPT_NEXT: 0x22, GOALS_TEST: 0x23,
    LABEL: 0xF0, HALT: 0xFF
  };

  var SENSOR_CODE = {
    distance: 1, left: 2, right: 3, battery: 4, heat: 5, onTarget: 6,
    onCharger: 7, goalsLeft: 8, bumps: 9, steps: 10, x: 11, y: 12, heading: 13
  };

  var CMP_CODE = { '<': 1, '<=': 2, '=': 3, '!=': 4, '>=': 5, '>': 6 };

  function compile(program) {
    var ir = [];
    var labelId = 0;
    var regId = 0;

    function label(tag) { labelId += 1; return 'L' + labelId + '_' + tag; }
    function push(ins) { ir.push(ins); return ins; }

    function emitCond(c, src) {
      push({ op: 'SENSE', a: c.sensor, src: src });
      push({ op: 'PUSHI', a: c.value, src: src });
      push({ op: 'CMP', a: c.op, src: src });
    }

    function emitList(list) {
      list.forEach(function (b) {
        var a = b.args;
        switch (b.type) {
          case 'move': push({ op: 'MOVE', a: int(a.n), src: b.id }); break;
          case 'back': push({ op: 'BACK', a: int(a.n), src: b.id }); break;
          case 'turn': push({ op: 'TURN', a: a.side, src: b.id }); break;
          case 'face': push({ op: 'FACE', a: int(a.dir), src: b.id }); break;
          case 'wait': push({ op: 'WAIT', a: int(a.n), src: b.id }); break;
          case 'charge': push({ op: 'CHARGE', a: int(a.n), src: b.id }); break;
          case 'speed': push({ op: 'SPEED', a: num(a.n), src: b.id }); break;
          case 'say': push({ op: 'SAY', a: String(a.text), src: b.id }); break;
          case 'stop': push({ op: 'STOP', src: b.id }); break;

          case 'repeat': {
            var reg = regId++;
            var top = label('rpt'), out = label('rptEnd');
            push({ op: 'RPT_INIT', a: int(a.n), reg: reg, src: b.id });
            push({ op: 'LABEL', a: top });
            push({ op: 'RPT_TEST', reg: reg, target: out, src: b.id });
            emitList(b.body);
            push({ op: 'RPT_NEXT', reg: reg, target: top, src: b.id });
            push({ op: 'LABEL', a: out });
            break;
          }
          case 'forever': {
            var ftop = label('loop'), fout = label('loopEnd');
            push({ op: 'LABEL', a: ftop });
            push({ op: 'GOALS_TEST', target: fout, src: b.id });
            emitList(b.body);
            push({ op: 'JMP', target: ftop, src: b.id });
            push({ op: 'LABEL', a: fout });
            break;
          }
          case 'whileB': {
            var wtop = label('while'), wout = label('whileEnd');
            push({ op: 'LABEL', a: wtop });
            emitCond(a.cond, b.id);
            push({ op: 'JMPF', target: wout, src: b.id });
            emitList(b.body);
            push({ op: 'JMP', target: wtop, src: b.id });
            push({ op: 'LABEL', a: wout });
            break;
          }
          case 'ifB': {
            var iout = label('ifEnd');
            emitCond(a.cond, b.id);
            push({ op: 'JMPF', target: iout, src: b.id });
            emitList(b.body);
            push({ op: 'LABEL', a: iout });
            break;
          }
          case 'ifElse': {
            var els = label('else'), end = label('ifEnd');
            emitCond(a.cond, b.id);
            push({ op: 'JMPF', target: els, src: b.id });
            emitList(b.body);
            push({ op: 'JMP', target: end, src: b.id });
            push({ op: 'LABEL', a: els });
            emitList(b.alt);
            push({ op: 'LABEL', a: end });
            break;
          }
          default:
            throw new Error('cannot compile block type "' + b.type + '"');
        }
      });
    }

    emitList(program);
    push({ op: 'HALT' });
    return { ir: ir, registers: regId };
  }

  function int(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 1 : n; }

  /* ---------------- optimiser ---------------- */

  function optimise(ir) {
    var out = ir.map(function (i) { return copy(i); });
    var notes = [];

    out = dropZero(out, notes);
    out = mergeMoves(out, notes);
    out = foldTurns(out, notes);
    out = dropAfterHalt(out, notes);
    out = dropDeadJumps(out, notes);
    out = dropUnusedLabels(out, notes);

    return { ir: out, notes: notes };
  }

  function copy(i) {
    var c = {};
    for (var k in i) if (Object.prototype.hasOwnProperty.call(i, k)) c[k] = i[k];
    return c;
  }

  function dropZero(ir, notes) {
    var n = 0;
    var out = ir.filter(function (i) {
      if ((i.op === 'MOVE' || i.op === 'BACK' || i.op === 'WAIT') && int(i.a) === 0) { n++; return false; }
      if (i.op === 'CHARGE' && int(i.a) === 0) { n++; return false; }
      return true;
    });
    if (n) notes.push(n + ' no-op instruction' + (n > 1 ? 's' : '') + ' removed');
    return out;
  }

  function mergeMoves(ir, notes) {
    var out = [], n = 0;
    for (var i = 0; i < ir.length; i++) {
      var cur = ir[i], last = out[out.length - 1];
      if (last && cur.op === last.op && (cur.op === 'MOVE' || cur.op === 'BACK' || cur.op === 'WAIT')) {
        last.a = int(last.a) + int(cur.a);
        n++;
        continue;
      }
      out.push(cur);
    }
    if (n) notes.push(n + ' consecutive motion instruction' + (n > 1 ? 's' : '') + ' folded together');
    return out;
  }

  function foldTurns(ir, notes) {
    var out = [], n = 0;
    for (var i = 0; i < ir.length; i++) {
      if (ir[i].op !== 'TURN') { out.push(ir[i]); continue; }
      var net = 0, src = ir[i].src, j = i;
      while (j < ir.length && ir[j].op === 'TURN') {
        net += ir[j].a === 'left' ? 3 : 1;
        j++;
      }
      var runLength = j - i;
      net = net % 4;
      var emitted = [];
      if (net === 1) emitted.push({ op: 'TURN', a: 'right', src: src });
      else if (net === 3) emitted.push({ op: 'TURN', a: 'left', src: src });
      else if (net === 2) {
        emitted.push({ op: 'TURN', a: 'right', src: src });
        emitted.push({ op: 'TURN', a: 'right', src: src });
      }
      n += runLength - emitted.length;
      out = out.concat(emitted);
      i = j - 1;
    }
    if (n > 0) notes.push(n + ' redundant turn' + (n > 1 ? 's' : '') + ' cancelled out');
    return out;
  }

  function dropAfterHalt(ir, notes) {
    var out = [], skipping = false, n = 0;
    for (var i = 0; i < ir.length; i++) {
      var ins = ir[i];
      if (skipping) {
        if (ins.op === 'LABEL') { skipping = false; out.push(ins); }
        else { n++; }
        continue;
      }
      out.push(ins);
      if (ins.op === 'STOP' || ins.op === 'HALT') skipping = true;
    }
    if (n) notes.push(n + ' unreachable instruction' + (n > 1 ? 's' : '') + ' dropped');
    return out;
  }

  function dropDeadJumps(ir, notes) {
    var out = [], n = 0;
    for (var i = 0; i < ir.length; i++) {
      var ins = ir[i], nxt = ir[i + 1];
      if (ins.op === 'JMP' && nxt && nxt.op === 'LABEL' && nxt.a === ins.target) { n++; continue; }
      out.push(ins);
    }
    if (n) notes.push(n + ' jump' + (n > 1 ? 's' : '') + ' to the next line removed');
    return out;
  }

  function dropUnusedLabels(ir, notes) {
    var used = {};
    ir.forEach(function (i) { if (i.target) used[i.target] = true; });
    var n = 0;
    var out = ir.filter(function (i) {
      if (i.op === 'LABEL' && !used[i.a]) { n++; return false; }
      return true;
    });
    if (n) notes.push(n + ' unused label' + (n > 1 ? 's' : '') + ' stripped');
    return out;
  }

  /* ---------------- bytecode ---------------- */

  function assemble(ir) {
    var addr = {}, pc = 0, i;
    for (i = 0; i < ir.length; i++) {
      if (ir[i].op === 'LABEL') { addr[ir[i].a] = pc; continue; }
      pc += width(ir[i]);
    }
    var bytes = [], listing = [];
    pc = 0;
    for (i = 0; i < ir.length; i++) {
      var ins = ir[i];
      if (ins.op === 'LABEL') { listing.push({ pc: pc, text: ins.a + ':', bytes: [] }); continue; }
      var chunk = encode(ins, addr);
      listing.push({ pc: pc, text: mnemonic(ins), bytes: chunk });
      bytes = bytes.concat(chunk);
      pc += chunk.length;
    }
    return { bytes: bytes, listing: listing, addresses: addr };
  }

  function width(ins) {
    switch (ins.op) {
      case 'STOP': case 'HALT': return 1;
      case 'SAY': return 2;
      default: return 2;
    }
  }

  function encode(ins, addr) {
    var code = OPCODES[ins.op] !== undefined ? OPCODES[ins.op] : OPCODES.NOP;
    switch (ins.op) {
      case 'STOP': case 'HALT': return [code];
      case 'TURN': return [code, ins.a === 'left' ? 0 : 1];
      case 'SENSE': return [code, SENSOR_CODE[ins.a] || 0];
      case 'CMP': return [code, CMP_CODE[ins.a] || 0];
      case 'JMP': case 'JMPF': case 'GOALS_TEST': case 'RPT_TEST': case 'RPT_NEXT':
        return [code, addr[ins.target] & 0xff];
      case 'SAY': return [code, strHash(ins.a) & 0xff];
      case 'SPEED': return [code, Math.round(num(ins.a) * 10) & 0xff];
      default: return [code, int(ins.a) & 0xff];
    }
  }

  function strHash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return h;
  }

  function mnemonic(ins) {
    var parts = [ins.op];
    if (ins.target) parts.push('-> ' + ins.target);
    else if (ins.a !== undefined) parts.push(typeof ins.a === 'string' ? ins.a : String(ins.a));
    if (ins.reg !== undefined) parts.push('r' + ins.reg);
    return parts.join(' ');
  }

  /* ---------------- dumps for the compiler page ---------------- */

  function dumpIR(ir) {
    var lines = [], pc = 0;
    ir.forEach(function (i) {
      if (i.op === 'LABEL') { lines.push(i.a + ':'); return; }
      lines.push(pad(String(pc), 4) + '  ' + mnemonic(i));
      pc++;
    });
    return lines.join('\n');
  }

  function dumpBytecode(asm) {
    var lines = ['addr   bytes     instruction', '----   -------   -----------'];
    asm.listing.forEach(function (l) {
      if (!l.bytes.length) { lines.push('       ' + l.text); return; }
      var hex = l.bytes.map(function (b) { return ('0' + b.toString(16)).slice(-2).toUpperCase(); }).join(' ');
      lines.push(pad(l.pc.toString(16).toUpperCase(), 4, '0') + '   ' + padRight(hex, 7) + '   ' + l.text);
    });
    lines.push('');
    lines.push('total: ' + asm.bytes.length + ' bytes');
    return lines.join('\n');
  }

  function dumpAST(program) {
    var out = [];
    (function walk(list, depth) {
      var pad = new Array(depth + 1).join('   ');
      list.forEach(function (b, idx) {
        var isLast = idx === list.length - 1;
        var branch = pad + (isLast ? '└─ ' : '├─ ');
        out.push(branch + describe(b));
        var def = global.RF.blocks.DEFS[b.type];
        if (def && def.body) {
          def.body.forEach(function (slot) {
            if (!b[slot].length) return;
            out.push(pad + '   ' + (slot === 'alt' ? '[else]' : '[body]'));
            walk(b[slot], depth + 2);
          });
        }
      });
    })(program, 0);
    return out.length ? out.join('\n') : '(empty program)';
  }

  function describe(b) {
    var a = b.args;
    switch (b.type) {
      case 'move': return 'Move(cells=' + a.n + ')';
      case 'back': return 'Back(cells=' + a.n + ')';
      case 'turn': return 'Turn(' + a.side + ')';
      case 'face': return 'Face(dir=' + a.dir + ')';
      case 'wait': return 'Wait(' + a.n + ')';
      case 'stop': return 'Stop()';
      case 'charge': return 'Charge(' + a.n + ')';
      case 'speed': return 'Speed(' + a.n + ')';
      case 'say': return 'Say("' + a.text + '")';
      case 'repeat': return 'Repeat(times=' + a.n + ')';
      case 'forever': return 'RepeatUntilGoalsCleared()';
      case 'whileB': return 'While(' + condText(a.cond) + ')';
      case 'ifB': return 'If(' + condText(a.cond) + ')';
      case 'ifElse': return 'IfElse(' + condText(a.cond) + ')';
      default: return b.type;
    }
  }

  function condText(c) { return c.sensor + ' ' + c.op + ' ' + c.value; }

  function pad(s, n, ch) {
    s = String(s);
    while (s.length < n) s = (ch || ' ') + s;
    return s;
  }
  function padRight(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }

  function countReal(ir) {
    return ir.filter(function (i) { return i.op !== 'LABEL'; }).length;
  }

  global.RF.compiler = {
    OPCODES: OPCODES,
    compile: compile,
    optimise: optimise,
    assemble: assemble,
    dumpIR: dumpIR,
    dumpBytecode: dumpBytecode,
    dumpAST: dumpAST,
    countReal: countReal,
    padRight: padRight
  };
})(window);
