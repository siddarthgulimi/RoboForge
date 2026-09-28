/* blocks.js — Scratch-style block model, palette, and drag-and-drop editor. */
(function (global) {
  'use strict';

  var CATEGORY = {
    motion:  '#5fb7f0',
    control: '#f2a93b',
    sensing: '#4fd6a6',
    power:   '#a98bf0',
    say:     '#ef8fb1'
  };

  var SENSORS = [
    ['distance', 'distance ahead'],
    ['left', 'distance left'],
    ['right', 'distance right'],
    ['battery', 'battery %'],
    ['heat', 'motor heat'],
    ['onTarget', 'on goal pad'],
    ['onCharger', 'on charger'],
    ['goalsLeft', 'goals left'],
    ['bumps', 'bump count'],
    ['steps', 'steps taken'],
    ['x', 'grid x'],
    ['y', 'grid y']
  ];

  var OPS = ['<', '<=', '=', '!=', '>=', '>'];

  /* Every block type the editor knows about. */
  var DEFS = {
    move:   { cat: 'motion',  label: 'move forward', args: [{ key: 'n', type: 'num', def: 1, suffix: 'cells' }] },
    back:   { cat: 'motion',  label: 'back up',      args: [{ key: 'n', type: 'num', def: 1, suffix: 'cells' }] },
    turn:   { cat: 'motion',  label: 'turn',         args: [{ key: 'side', type: 'select', def: 'right', options: [['left', 'left'], ['right', 'right']] }] },
    face:   { cat: 'motion',  label: 'face',         args: [{ key: 'dir', type: 'select', def: '1', options: [['0', 'north'], ['1', 'east'], ['2', 'south'], ['3', 'west']] }] },
    wait:   { cat: 'control', label: 'wait',         args: [{ key: 'n', type: 'num', def: 1, suffix: 'ticks' }] },
    stop:   { cat: 'control', label: 'stop program', args: [] },
    repeat: { cat: 'control', label: 'repeat',       args: [{ key: 'n', type: 'num', def: 4, suffix: 'times' }], body: ['body'], foot: 'end repeat' },
    forever:{ cat: 'control', label: 'repeat until goals cleared', args: [], body: ['body'], foot: 'end loop' },
    whileB: { cat: 'control', label: 'while',        args: [{ key: 'cond', type: 'cond' }], body: ['body'], foot: 'end while' },
    ifB:    { cat: 'sensing', label: 'if',           args: [{ key: 'cond', type: 'cond' }], body: ['body'], foot: 'end if' },
    ifElse: { cat: 'sensing', label: 'if',           args: [{ key: 'cond', type: 'cond' }], body: ['body', 'alt'], foot: 'end if' },
    charge: { cat: 'power',   label: 'charge',       args: [{ key: 'n', type: 'num', def: 20, suffix: '%' }] },
    speed:  { cat: 'power',   label: 'set speed',    args: [{ key: 'n', type: 'num', def: 1, suffix: '×' }] },
    say:    { cat: 'say',     label: 'say',          args: [{ key: 'text', type: 'text', def: 'here we go' }] }
  };

  var PALETTE_GROUPS = [
    { title: 'Motion', types: ['move', 'back', 'turn', 'face'] },
    { title: 'Control', types: ['repeat', 'forever', 'whileB', 'wait', 'stop'] },
    { title: 'Sensing', types: ['ifB', 'ifElse'] },
    { title: 'Power', types: ['charge', 'speed'] },
    { title: 'Mood', types: ['say'] }
  ];

  var uid = 0;
  function newId() { uid += 1; return 'b' + uid; }

  function makeBlock(type) {
    var def = DEFS[type];
    if (!def) throw new Error('unknown block type: ' + type);
    var b = { id: newId(), type: type, args: {} };
    def.args.forEach(function (a) {
      if (a.type === 'cond') b.args.cond = { sensor: 'distance', op: '<', value: 2 };
      else b.args[a.key] = a.def;
    });
    if (def.body) def.body.forEach(function (slot) { b[slot] = []; });
    return b;
  }

  /* --- tree helpers ----------------------------------------------------- */

  function walk(list, fn, parent) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (fn(b, list, i, parent) === false) return false;
      var def = DEFS[b.type];
      if (def && def.body) {
        for (var s = 0; s < def.body.length; s++) {
          if (walk(b[def.body[s]], fn, b) === false) return false;
        }
      }
    }
    return true;
  }

  function findSlot(root, id) {
    var found = null;
    walk(root, function (b, list, i) {
      if (b.id === id) { found = { list: list, index: i, block: b }; return false; }
    });
    return found;
  }

  function removeBlock(root, id) {
    var slot = findSlot(root, id);
    if (!slot) return null;
    slot.list.splice(slot.index, 1);
    return slot.block;
  }

  function contains(block, id) {
    if (block.id === id) return true;
    var def = DEFS[block.type];
    if (!def || !def.body) return false;
    var hit = false;
    def.body.forEach(function (slot) {
      walk(block[slot], function (b) { if (b.id === id) { hit = true; return false; } });
    });
    return hit;
  }

  function countBlocks(root) {
    var n = 0;
    walk(root, function () { n++; });
    return n;
  }

  /* --- palette rendering ------------------------------------------------ */

  function renderPalette(host, onPick) {
    host.innerHTML = '';
    PALETTE_GROUPS.forEach(function (group) {
      var h = document.createElement('div');
      h.className = 'pal-group';
      h.textContent = group.title;
      host.appendChild(h);
      group.types.forEach(function (type) {
        var def = DEFS[type];
        var btn = document.createElement('button');
        btn.className = 'pal-block';
        btn.style.background = CATEGORY[def.cat];
        btn.textContent = paletteLabel(type, def);
        btn.addEventListener('click', function () { onPick(type); });
        host.appendChild(btn);
      });
    });
  }

  function paletteLabel(type, def) {
    if (type === 'ifElse') return 'if … else';
    if (type === 'whileB') return 'while …';
    if (type === 'ifB') return 'if …';
    var parts = [def.label];
    def.args.forEach(function (a) {
      if (a.type === 'num') parts.push(String(a.def) + (a.suffix ? ' ' + a.suffix : ''));
      else if (a.type === 'select') parts.push(a.options[0][1]);
      else if (a.type === 'text') parts.push('"' + a.def + '"');
    });
    return parts.join(' ');
  }

  /* --- script rendering ------------------------------------------------- */

  function Editor(host, program, hooks) {
    this.host = host;
    this.program = program;
    this.hooks = hooks || {};
    this.dragId = null;
    this.selected = null;   // container block id that palette clicks go into
  }

  Editor.prototype.render = function () {
    this.host.innerHTML = '';
    this.host.appendChild(this.renderSlot(this.program, null, 'body'));
    if (this.hooks.onChange) this.hooks.onChange();
  };

  Editor.prototype.renderSlot = function (list, parentBlock, slotName) {
    var self = this;
    var wrap = document.createElement('div');
    wrap.className = 'slot';
    wrap.appendChild(this.gap(list, 0));
    list.forEach(function (block, i) {
      wrap.appendChild(self.renderBlock(block));
      wrap.appendChild(self.gap(list, i + 1));
    });
    if (parentBlock) { wrap.dataset.parent = parentBlock.id; wrap.dataset.slot = slotName; }
    return wrap;
  };

  Editor.prototype.gap = function (list, index) {
    var self = this;
    var g = document.createElement('div');
    g.className = 'gap';
    g.addEventListener('dragover', function (e) {
      if (!self.dragId) return;
      e.preventDefault();
      g.classList.add('over');
    });
    g.addEventListener('dragleave', function () { g.classList.remove('over'); });
    g.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      g.classList.remove('over');
      self.drop(list, index);
    });
    return g;
  };

  Editor.prototype.drop = function (list, index) {
    if (!this.dragId) return;
    var slot = findSlot(this.program, this.dragId);
    if (!slot) { this.dragId = null; return; }
    if (contains(slot.block, this.dragId) && list !== slot.list) {
      // dropping a container into its own body is rejected
      var inside = false;
      walk([slot.block], function (b) {
        var def = DEFS[b.type];
        if (!def || !def.body) return;
        def.body.forEach(function (s) { if (b[s] === list) inside = true; });
      });
      if (inside) { this.dragId = null; return; }
    }
    var block = slot.block;
    var target = index;
    if (slot.list === list && slot.index < index) target -= 1;
    slot.list.splice(slot.index, 1);
    list.splice(target, 0, block);
    this.dragId = null;
    this.render();
  };

  Editor.prototype.renderBlock = function (block) {
    var self = this;
    var def = DEFS[block.type];
    var color = CATEGORY[def.cat];

    var head = document.createElement('div');
    head.className = 'block';
    head.dataset.id = block.id;
    head.style.background = color;
    head.draggable = true;
    head.addEventListener('dragstart', function (e) {
      self.dragId = block.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', block.id); } catch (err) { /* older browsers */ }
    });
    head.addEventListener('dragend', function () { self.dragId = null; });
    head.addEventListener('click', function (e) {
      if (e.target !== head) return;
      if (def.body) {
        self.selected = self.selected === block.id ? null : block.id;
        self.render();
        if (self.hooks.onSelect) self.hooks.onSelect(self.selected);
      }
    });
    if (self.selected === block.id) head.classList.add('selected');

    var label = document.createElement('span');
    label.textContent = def.label;
    head.appendChild(label);

    def.args.forEach(function (a) {
      head.appendChild(self.renderArg(block, a));
      if (a.suffix) {
        var s = document.createElement('span');
        s.textContent = a.suffix;
        head.appendChild(s);
      }
    });

    var kill = document.createElement('button');
    kill.className = 'kill';
    kill.type = 'button';
    kill.title = 'delete block';
    kill.textContent = '×';
    kill.addEventListener('click', function (e) {
      e.stopPropagation();
      removeBlock(self.program, block.id);
      if (self.selected === block.id) self.selected = null;
      self.render();
    });
    head.appendChild(kill);

    if (!def.body) return head;

    var box = document.createElement('div');
    box.className = 'container-block';
    box.appendChild(head);

    def.body.forEach(function (slotName, i) {
      if (def.body.length > 1) {
        var tag = document.createElement('div');
        tag.className = 'branch-label';
        tag.textContent = i === 0 ? 'then' : 'else';
        box.appendChild(tag);
      }
      var body = document.createElement('div');
      body.className = 'container-body';
      body.style.borderLeftColor = color;
      body.appendChild(self.renderSlot(block[slotName], block, slotName));
      box.appendChild(body);
    });

    var foot = document.createElement('div');
    foot.className = 'container-foot';
    foot.style.background = color;
    foot.textContent = def.foot || 'end';
    box.appendChild(foot);
    return box;
  };

  Editor.prototype.renderArg = function (block, a) {
    var self = this;
    if (a.type === 'num') {
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'num';
      inp.value = block.args[a.key];
      inp.min = a.key === 'n' ? 0 : -999;
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('change', function () {
        var v = parseFloat(inp.value);
        block.args[a.key] = isNaN(v) ? a.def : v;
        inp.value = block.args[a.key];
        if (self.hooks.onChange) self.hooks.onChange();
      });
      return inp;
    }
    if (a.type === 'text') {
      var t = document.createElement('input');
      t.type = 'text';
      t.className = 'num txt';
      t.value = block.args[a.key];
      t.addEventListener('click', function (e) { e.stopPropagation(); });
      t.addEventListener('change', function () {
        block.args[a.key] = t.value;
        if (self.hooks.onChange) self.hooks.onChange();
      });
      return t;
    }
    if (a.type === 'select') {
      var sel = document.createElement('select');
      a.options.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        sel.appendChild(op);
      });
      sel.value = String(block.args[a.key]);
      sel.addEventListener('click', function (e) { e.stopPropagation(); });
      sel.addEventListener('change', function () {
        block.args[a.key] = sel.value;
        if (self.hooks.onChange) self.hooks.onChange();
      });
      return sel;
    }
    if (a.type === 'cond') {
      var wrap = document.createElement('span');
      wrap.style.display = 'inline-flex';
      wrap.style.gap = '6px';
      var c = block.args.cond;

      var sensor = document.createElement('select');
      SENSORS.forEach(function (s) {
        var op = document.createElement('option');
        op.value = s[0]; op.textContent = s[1];
        sensor.appendChild(op);
      });
      sensor.value = c.sensor;

      var op2 = document.createElement('select');
      OPS.forEach(function (o) {
        var e = document.createElement('option');
        e.value = o; e.textContent = o;
        op2.appendChild(e);
      });
      op2.value = c.op;

      var val = document.createElement('input');
      val.type = 'number';
      val.className = 'num';
      val.value = c.value;

      [sensor, op2, val].forEach(function (el) {
        el.addEventListener('click', function (e) { e.stopPropagation(); });
        el.addEventListener('change', function () {
          c.sensor = sensor.value;
          c.op = op2.value;
          var v = parseFloat(val.value);
          c.value = isNaN(v) ? 0 : v;
          val.value = c.value;
          if (self.hooks.onChange) self.hooks.onChange();
        });
      });

      wrap.appendChild(sensor);
      wrap.appendChild(op2);
      wrap.appendChild(val);
      return wrap;
    }
    return document.createTextNode('');
  };

  /* Append a new block where the user is currently pointed. */
  Editor.prototype.add = function (type) {
    var block = makeBlock(type);
    var list = this.program;
    if (this.selected) {
      var slot = findSlot(this.program, this.selected);
      if (slot && DEFS[slot.block.type].body) {
        list = slot.block[DEFS[slot.block.type].body[0]];
      }
    }
    list.push(block);
    this.render();
    return block;
  };

  Editor.prototype.highlight = function (id) {
    var prev = this.host.querySelector('.block.executing');
    if (prev) prev.classList.remove('executing');
    if (!id) return;
    var el = this.host.querySelector('.block[data-id="' + id + '"]');
    if (el) el.classList.add('executing');
  };

  global.RF.blocks = {
    DEFS: DEFS,
    CATEGORY: CATEGORY,
    SENSORS: SENSORS,
    OPS: OPS,
    makeBlock: makeBlock,
    renderPalette: renderPalette,
    Editor: Editor,
    walk: walk,
    findSlot: findSlot,
    removeBlock: removeBlock,
    countBlocks: countBlocks,
    newId: newId
  };
})(window);
