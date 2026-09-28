/* roboscript.js — the text form of a program.
   Blocks -> RoboScript (generate) and RoboScript -> Blocks (lex + parse).
   Both forms describe the same tree, so the two editors stay in sync. */
(function (global) {
  'use strict';

  var B = global.RF.blocks;

  var KEYWORDS = ['MOVE', 'BACK', 'TURN', 'FACE', 'WAIT', 'STOP', 'REPEAT', 'FOREVER',
                  'WHILE', 'IF', 'ELSE', 'END', 'CHARGE', 'SPEED', 'SAY',
                  'LEFT', 'RIGHT', 'NORTH', 'EAST', 'SOUTH', 'WEST'];

  var DIR_WORDS = { NORTH: '0', EAST: '1', SOUTH: '2', WEST: '3' };
  var DIR_NAMES = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

  /* ---------------- generate ---------------- */

  function generate(program) {
    return emit(program, 0).join('\n');
  }

  function emit(list, depth) {
    var pad = new Array(depth + 1).join('  ');
    var out = [];
    list.forEach(function (b) {
      var a = b.args;
      switch (b.type) {
        case 'move': out.push(pad + 'MOVE ' + a.n); break;
        case 'back': out.push(pad + 'BACK ' + a.n); break;
        case 'turn': out.push(pad + 'TURN ' + a.side.toUpperCase()); break;
        case 'face': out.push(pad + 'FACE ' + DIR_NAMES[parseInt(a.dir, 10) || 0]); break;
        case 'wait': out.push(pad + 'WAIT ' + a.n); break;
        case 'stop': out.push(pad + 'STOP'); break;
        case 'charge': out.push(pad + 'CHARGE ' + a.n); break;
        case 'speed': out.push(pad + 'SPEED ' + a.n); break;
        case 'say': out.push(pad + 'SAY "' + String(a.text).replace(/"/g, "'") + '"'); break;
        case 'repeat':
          out.push(pad + 'REPEAT ' + a.n);
          out = out.concat(emit(b.body, depth + 1));
          out.push(pad + 'END');
          break;
        case 'forever':
          out.push(pad + 'FOREVER');
          out = out.concat(emit(b.body, depth + 1));
          out.push(pad + 'END');
          break;
        case 'whileB':
          out.push(pad + 'WHILE ' + cond(a.cond));
          out = out.concat(emit(b.body, depth + 1));
          out.push(pad + 'END');
          break;
        case 'ifB':
          out.push(pad + 'IF ' + cond(a.cond));
          out = out.concat(emit(b.body, depth + 1));
          out.push(pad + 'END');
          break;
        case 'ifElse':
          out.push(pad + 'IF ' + cond(a.cond));
          out = out.concat(emit(b.body, depth + 1));
          out.push(pad + 'ELSE');
          out = out.concat(emit(b.alt, depth + 1));
          out.push(pad + 'END');
          break;
        default: out.push(pad + '# unsupported block: ' + b.type);
      }
    });
    return out;
  }

  function cond(c) { return c.sensor + ' ' + c.op + ' ' + c.value; }

  /* ---------------- lex ---------------- */

  function lex(src) {
    var tokens = [];
    var lines = String(src).split(/\r?\n/);
    for (var ln = 0; ln < lines.length; ln++) {
      var line = lines[ln];
      var i = 0;
      while (i < line.length) {
        var ch = line[i];
        if (ch === ' ' || ch === '\t') { i++; continue; }
        if (ch === '#') break;                       // comment to end of line
        if (ch === '"') {
          var j = line.indexOf('"', i + 1);
          if (j < 0) throw err(ln + 1, 'string is missing its closing quote');
          tokens.push(tok('STRING', line.slice(i + 1, j), ln + 1));
          i = j + 1;
          continue;
        }
        if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(line[i + 1] || ''))) {
          var num = ch; i++;
          while (i < line.length && /[0-9.]/.test(line[i])) { num += line[i]; i++; }
          tokens.push(tok('NUMBER', parseFloat(num), ln + 1));
          continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
          var word = ''; 
          while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) { word += line[i]; i++; }
          var upper = word.toUpperCase();
          if (KEYWORDS.indexOf(upper) >= 0) tokens.push(tok('KEYWORD', upper, ln + 1));
          else tokens.push(tok('IDENT', word, ln + 1));
          continue;
        }
        var two = line.substr(i, 2);
        if (two === '<=' || two === '>=' || two === '!=' || two === '==') {
          tokens.push(tok('OP', two === '==' ? '=' : two, ln + 1));
          i += 2;
          continue;
        }
        if ('<>='.indexOf(ch) >= 0) { tokens.push(tok('OP', ch, ln + 1)); i++; continue; }
        throw err(ln + 1, 'unexpected character "' + ch + '"');
      }
      tokens.push(tok('NEWLINE', '', ln + 1));
    }
    tokens.push(tok('EOF', '', lines.length));
    return tokens;
  }

  function tok(type, value, line) { return { type: type, value: value, line: line }; }
  function err(line, msg) { var e = new Error('line ' + line + ': ' + msg); e.line = line; return e; }

  /* ---------------- parse ---------------- */

  function parse(src) {
    var tokens = lex(src).filter(function (t) { return t.type !== 'NEWLINE' || true; });
    var pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function skipNewlines() { while (peek().type === 'NEWLINE') pos++; }
    function expectNumber(what) {
      var t = peek();
      if (t.type !== 'NUMBER') throw err(t.line, what + ' needs a number');
      pos++;
      return t.value;
    }
    function endOfStatement() {
      var t = peek();
      if (t.type === 'NEWLINE' || t.type === 'EOF') { if (t.type === 'NEWLINE') pos++; return; }
      throw err(t.line, 'unexpected "' + t.value + '" at the end of the line');
    }

    function parseCond(owner) {
      var s = peek();
      var name;
      if (s.type === 'IDENT') name = s.value;
      else if (s.type === 'KEYWORD' && (s.value === 'LEFT' || s.value === 'RIGHT')) name = s.value.toLowerCase();
      else throw err(s.line, owner + ' needs a sensor name, for example: distance < 2');
      var known = B.SENSORS.some(function (x) { return x[0] === name; });
      if (!known) throw err(s.line, 'unknown sensor "' + name + '"');
      s = { type: 'IDENT', value: name, line: s.line };
      pos++;
      var o = peek();
      if (o.type !== 'OP') throw err(o.line, 'expected a comparison such as < or >=');
      pos++;
      var v = expectNumber('the comparison');
      return { sensor: s.value, op: o.value, value: v };
    }

    function parseBlockList(stopWords, ownerLine) {
      var list = [];
      for (;;) {
        skipNewlines();
        var t = peek();
        if (t.type === 'EOF') {
          if (stopWords.length) throw err(ownerLine, 'block opened here is never closed with END');
          return list;
        }
        if (t.type === 'KEYWORD' && stopWords.indexOf(t.value) >= 0) return list;
        list.push(parseStatement());
      }
    }

    function parseStatement() {
      var t = next();
      if (t.type !== 'KEYWORD') throw err(t.line, 'expected a command, got "' + t.value + '"');
      var b;
      switch (t.value) {
        case 'MOVE': b = B.makeBlock('move'); b.args.n = expectNumber('MOVE'); endOfStatement(); return b;
        case 'BACK': b = B.makeBlock('back'); b.args.n = expectNumber('BACK'); endOfStatement(); return b;
        case 'WAIT': b = B.makeBlock('wait'); b.args.n = expectNumber('WAIT'); endOfStatement(); return b;
        case 'CHARGE': b = B.makeBlock('charge'); b.args.n = expectNumber('CHARGE'); endOfStatement(); return b;
        case 'SPEED': b = B.makeBlock('speed'); b.args.n = expectNumber('SPEED'); endOfStatement(); return b;
        case 'STOP': b = B.makeBlock('stop'); endOfStatement(); return b;
        case 'TURN': {
          var d = next();
          if (d.type !== 'KEYWORD' || (d.value !== 'LEFT' && d.value !== 'RIGHT')) {
            throw err(d.line, 'TURN needs LEFT or RIGHT');
          }
          b = B.makeBlock('turn');
          b.args.side = d.value.toLowerCase();
          endOfStatement();
          return b;
        }
        case 'FACE': {
          var f = next();
          if (f.type !== 'KEYWORD' || !DIR_WORDS[f.value]) {
            throw err(f.line, 'FACE needs NORTH, EAST, SOUTH or WEST');
          }
          b = B.makeBlock('face');
          b.args.dir = DIR_WORDS[f.value];
          endOfStatement();
          return b;
        }
        case 'SAY': {
          var s = next();
          if (s.type !== 'STRING') throw err(s.line, 'SAY needs text in quotes');
          b = B.makeBlock('say');
          b.args.text = s.value;
          endOfStatement();
          return b;
        }
        case 'REPEAT': {
          b = B.makeBlock('repeat');
          b.args.n = expectNumber('REPEAT');
          endOfStatement();
          b.body = parseBlockList(['END'], t.line);
          expectEnd(t.line);
          return b;
        }
        case 'FOREVER': {
          b = B.makeBlock('forever');
          endOfStatement();
          b.body = parseBlockList(['END'], t.line);
          expectEnd(t.line);
          return b;
        }
        case 'WHILE': {
          b = B.makeBlock('whileB');
          b.args.cond = parseCond('WHILE');
          endOfStatement();
          b.body = parseBlockList(['END'], t.line);
          expectEnd(t.line);
          return b;
        }
        case 'IF': {
          var c = parseCond('IF');
          endOfStatement();
          var body = parseBlockList(['END', 'ELSE'], t.line);
          var nt = peek();
          if (nt.type === 'KEYWORD' && nt.value === 'ELSE') {
            pos++;
            endOfStatement();
            var alt = parseBlockList(['END'], t.line);
            expectEnd(t.line);
            b = B.makeBlock('ifElse');
            b.args.cond = c; b.body = body; b.alt = alt;
            return b;
          }
          expectEnd(t.line);
          b = B.makeBlock('ifB');
          b.args.cond = c; b.body = body;
          return b;
        }
        default:
          throw err(t.line, '"' + t.value + '" cannot start a statement');
      }
    }

    function expectEnd(openLine) {
      skipNewlines();
      var t = peek();
      if (t.type !== 'KEYWORD' || t.value !== 'END') {
        throw err(t.line || openLine, 'expected END to close the block opened on line ' + openLine);
      }
      pos++;
      endOfStatement();
    }

    var program = parseBlockList([], 1);
    skipNewlines();
    if (peek().type !== 'EOF') throw err(peek().line, 'unexpected "' + peek().value + '"');
    return program;
  }

  function dumpTokens(src) {
    var out = [];
    lex(src).forEach(function (t) {
      if (t.type === 'NEWLINE') { out.push(''); return; }
      if (t.type === 'EOF') { out.push('EOF'); return; }
      out.push(t.type + '(' + t.value + ')');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  global.RF.script = {
    generate: generate,
    parse: parse,
    lex: lex,
    dumpTokens: dumpTokens,
    KEYWORDS: KEYWORDS
  };
})(window);
