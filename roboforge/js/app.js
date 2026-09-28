/* app.js — wires the editor, compiler, VM and simulator together. */
(function (global) {
  'use strict';

  var RF = global.RF;
  var TILE = RF.TILE;
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULT_SCRIPT = [
    'SAY "systems online"',
    'FOREVER',
    '  IF distance < 1',
    '    TURN RIGHT',
    '  ELSE',
    '    MOVE 1',
    '  END',
    'END'
  ].join('\n');

  var STORE_KEY = 'roboforge.saves.v1';

  var app = {
    world: null,
    robot: null,
    program: [],
    editor: null,
    sim: null,
    mapEditor: null,
    vm: null,
    running: false,
    timer: null,
    tickMs: 120,
    brush: TILE.WALL,
    painting: false,
    stage: 'source',
    compiled: null
  };

  /* ---------------- boot ---------------- */

  function boot() {
    app.world = RF.preset('open');
    app.world.scatter(0.10);
    app.robot = new RF.Robot(app.world, { name: 'Scrappy', color: '#5fb7f0' });

    try {
      app.program = RF.script.parse(DEFAULT_SCRIPT);
    } catch (e) {
      app.program = [];
    }

    app.editor = new RF.blocks.Editor($('scriptRoot'), app.program, {
      onChange: onProgramChanged
    });
    app.editor.render();

    RF.blocks.renderPalette($('palette'), function (type) {
      app.editor.add(type);
      $('emptyNote').classList.add('hidden');
    });

    app.sim = new RF.Renderer($('grid'), app.world);
    app.mapEditor = new RF.Renderer($('editorGrid'), app.world);

    wireTabs();
    wireTransport();
    wireEditorModes();
    wireCompilerPage();
    wireTestsPage();
    wireWorldPage();
    wireRobotPage();
    wireSaves();

    onProgramChanged();
    log('lab ready — press Run', 'good');
    requestAnimationFrame(frame);
  }

  /* ---------------- top bar ---------------- */

  function wireTabs() {
    $('viewTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      var view = btn.dataset.view;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        t.classList.toggle('is-active', t === btn);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
        v.classList.toggle('is-active', v.dataset.view === view);
      });
      if (view === 'compiler') refreshStage();
      if (view === 'world') { app.mapEditor.fit(); drawEditor(); }
      if (view === 'robot') renderSpecs();
    });
  }

  function wireTransport() {
    $('btnRun').addEventListener('click', run);
    $('btnPause').addEventListener('click', pause);
    $('btnStep').addEventListener('click', stepOnce);
    $('btnReset').addEventListener('click', function () { resetRun(true); });
    $('btnClearLog').addEventListener('click', function () { $('log').innerHTML = ''; });
    $('speed').addEventListener('input', function () {
      app.tickMs = Math.round(1000 / (parseInt($('speed').value, 10) * 2));
      if (app.running) { stopTimer(); startTimer(); }
    });
    app.tickMs = Math.round(1000 / (parseInt($('speed').value, 10) * 2));
  }

  /* ---------------- run control ---------------- */

  function buildVM() {
    try {
      var c = RF.compiler.compile(app.program);
      var o = RF.compiler.optimise(c.ir);
      app.compiled = { raw: c.ir, opt: o.ir, notes: o.notes, asm: RF.compiler.assemble(o.ir) };
      return new RF.VM(app.compiled.opt, app.robot);
    } catch (e) {
      log('compile error: ' + e.message, 'bad');
      setState('error');
      return null;
    }
  }

  function run() {
    if (!app.program.length) { log('nothing to run — add some blocks first', 'warn'); return; }
    if (!app.vm || app.vm.halted) {
      resetRun(false);
      app.vm = buildVM();
      if (!app.vm) return;
      log('program started — ' + RF.compiler.countReal(app.compiled.opt) + ' instructions', 'good');
    }
    app.running = true;
    setState('running');
    startTimer();
  }

  function pause() {
    if (!app.running) return;
    app.running = false;
    stopTimer();
    setState('paused');
    log('paused at instruction ' + (app.vm ? app.vm.pc : 0), 'warn');
  }

  function stepOnce() {
    if (!app.vm || app.vm.halted) {
      resetRun(false);
      app.vm = buildVM();
      if (!app.vm) return;
    }
    app.running = false;
    stopTimer();
    setState('paused');
    tick();
  }

  function resetRun(announce) {
    stopTimer();
    app.running = false;
    app.vm = null;
    app.robot.reset();
    app.editor.highlight(null);
    setState('idle');
    updateHUD();
    if (announce) log('robot returned to the start tile');
  }

  function startTimer() {
    stopTimer();
    app.timer = setInterval(tick, app.tickMs);
  }

  function stopTimer() {
    if (app.timer) { clearInterval(app.timer); app.timer = null; }
  }

  function tick() {
    if (!app.vm) return;
    var r = app.vm.tick();
    app.robot.tickMood(app.running);

    if (r) {
      if (r.src) app.editor.highlight(r.src);
      if (r.action) log(r.action, r.level);
      if (r.error) log(r.error, 'bad');
      if (r.halted) {
        stopTimer();
        app.running = false;
        setState(r.error ? 'error' : 'idle');
        app.editor.highlight(null);
        log(r.error ? 'run aborted' : 'run finished — ' + app.robot.steps + ' steps, ' +
            app.robot.bumps + ' bumps, ' + Math.round(app.robot.battery) + '% battery left',
            r.error ? 'bad' : 'good');
      }
    }
    updateHUD();
  }

  function setState(state) {
    var chip = $('runState');
    chip.textContent = state;
    chip.className = 'chip ' + (state === 'running' ? 'running' : state === 'paused' ? 'paused' : state === 'error' ? 'error' : '');
  }

  /* ---------------- render loop ---------------- */

  var last = 0;
  function frame(ts) {
    var dt = Math.min(0.1, (ts - last) / 1000 || 0.016);
    last = ts;
    app.robot.animate(dt);
    app.sim.draw(app.robot);
    requestAnimationFrame(frame);
  }

  /* ---------------- HUD ---------------- */

  function updateHUD() {
    var r = app.robot;
    $('gBattery').style.width = r.battery + '%';
    $('vBattery').textContent = Math.round(r.battery) + '%';
    var heatPct = Math.max(0, Math.min(100, ((r.heat - 26) / 74) * 100));
    $('gHeat').style.width = heatPct + '%';
    $('vHeat').textContent = Math.round(r.heat) + '°C';
    var d = r.distance(), range = r.spec().sensorRange;
    $('gDist').style.width = (d / range) * 100 + '%';
    $('vDist').textContent = d + ' cells';
    $('vPos').textContent = r.x + ',' + r.y;
    $('vHead').textContent = r.heading().name;
    $('vSteps').textContent = r.steps;
    $('vBumps').textContent = r.bumps;
    $('vPicked').textContent = r.targetsHit + '/' + r.targetsTotal;

    var m = r.moodInfo();
    $('moodFace').textContent = m.face;
    $('moodLabel').textContent = m.label;
    $('moodLine').textContent = m.line;
  }

  function log(text, level) {
    var list = $('log');
    var li = document.createElement('li');
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = stamp();
    var body = document.createElement('span');
    if (level) body.className = level;
    body.textContent = text;
    li.appendChild(t);
    li.appendChild(body);
    list.appendChild(li);
    while (list.children.length > 300) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }

  function stamp() {
    var d = new Date();
    return pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' +
      String(Math.floor(d.getMilliseconds() / 10)).padStart(2, '0');
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* ---------------- blocks <-> code ---------------- */

  function wireEditorModes() {
    $('editorMode').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      var code = btn.dataset.mode === 'code';
      $('codeMode').classList.toggle('hidden', !code);
      $('blocksMode').classList.toggle('hidden', code);
      if (code) $('codeArea').value = RF.script.generate(app.program);
    });

    $('btnCodeToBlocks').addEventListener('click', function () {
      var status = $('parseStatus');
      try {
        var tree = RF.script.parse($('codeArea').value);
        app.program.length = 0;
        tree.forEach(function (b) { app.program.push(b); });
        app.editor.selected = null;
        app.editor.render();
        status.textContent = 'parsed ' + RF.blocks.countBlocks(app.program) + ' blocks';
        status.className = 'parse-status ok';
        log('code applied to blocks', 'good');
      } catch (e) {
        status.textContent = e.message;
        status.className = 'parse-status bad';
      }
    });
  }

  function onProgramChanged() {
    var n = RF.blocks.countBlocks(app.program);
    $('emptyNote').classList.toggle('hidden', n > 0);
    if (!$('codeMode').classList.contains('hidden')) {
      $('codeArea').value = RF.script.generate(app.program);
    }
    app.compiled = null;
    if (document.querySelector('.view[data-view="compiler"]').classList.contains('is-active')) {
      refreshStage();
    }
  }

  /* ---------------- compiler page ---------------- */

  function wireCompilerPage() {
    $('pipeline').addEventListener('click', function (e) {
      var li = e.target.closest('li');
      if (!li) return;
      app.stage = li.dataset.stage;
      refreshStage();
    });
    $('btnCompile').addEventListener('click', function () {
      app.compiled = null;
      refreshStage();
      log('recompiled', 'good');
    });
  }

  function ensureCompiled() {
    if (app.compiled) return app.compiled;
    try {
      var c = RF.compiler.compile(app.program);
      var o = RF.compiler.optimise(c.ir);
      app.compiled = { raw: c.ir, opt: o.ir, notes: o.notes, asm: RF.compiler.assemble(o.ir) };
    } catch (e) {
      app.compiled = { error: e.message };
    }
    return app.compiled;
  }

  function refreshStage() {
    Array.prototype.forEach.call($('pipeline').children, function (li) {
      li.classList.toggle('is-active', li.dataset.stage === app.stage);
    });
    var c = ensureCompiled();
    var dump = $('stageDump');
    var titles = {
      source: 'Source', tokens: 'Tokens', ast: 'AST',
      ir: 'IR', opt: 'Optimised IR', bytecode: 'Bytecode'
    };
    $('stageTitle').textContent = titles[app.stage] || 'Source';

    if (c.error && app.stage !== 'source' && app.stage !== 'tokens') {
      dump.textContent = 'Compile error\n\n' + c.error;
      $('optStats').textContent = '';
      return;
    }

    var src = RF.script.generate(app.program);
    switch (app.stage) {
      case 'source': dump.textContent = src || '(empty program)'; break;
      case 'tokens':
        try { dump.textContent = RF.script.dumpTokens(src) || '(no tokens)'; }
        catch (e) { dump.textContent = 'Lex error\n\n' + e.message; }
        break;
      case 'ast': dump.textContent = RF.compiler.dumpAST(app.program); break;
      case 'ir': dump.textContent = RF.compiler.dumpIR(c.raw); break;
      case 'opt': dump.textContent = RF.compiler.dumpIR(c.opt); break;
      case 'bytecode': dump.textContent = RF.compiler.dumpBytecode(c.asm); break;
    }

    if (!c.error) {
      var before = RF.compiler.countReal(c.raw), after = RF.compiler.countReal(c.opt);
      var cut = before ? Math.round(((before - after) / before) * 100) : 0;
      var notes = c.notes.length ? '\n' + c.notes.map(function (n) { return '· ' + n; }).join('\n') : '\n· nothing to strip';
      $('optStats').textContent =
        'instructions before ' + before + '\ninstructions after  ' + after +
        '\nreduction           ' + cut + '%\nbytecode size       ' + c.asm.bytes.length + ' bytes' + notes;
    }
  }

  /* ---------------- test lab ---------------- */

  function wireTestsPage() {
    var host = $('testList');
    host.innerHTML = '';
    RF.tests.SCENARIOS.forEach(function (sc) {
      var li = document.createElement('li');
      var h = document.createElement('h3');
      h.textContent = sc.name;
      var p = document.createElement('p');
      p.textContent = sc.brief;
      var runBtn = document.createElement('button');
      runBtn.className = 'btn btn-sm';
      runBtn.textContent = 'Run checks';
      runBtn.addEventListener('click', function () {
        var result = RF.tests.run(sc, app.program, { robotOpts: robotOpts() });
        $('testResult').textContent = RF.tests.report(result);
        log('scenario "' + sc.name + '": ' + (result.ok && result.passed ? 'pass' : 'fail'),
            result.ok && result.passed ? 'good' : 'warn');
      });
      var loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-sm';
      loadBtn.textContent = 'Load map';
      loadBtn.addEventListener('click', function () {
        loadWorld(RF.tests.buildWorld(sc));
        app.robot.battery = sc.battery;
        log('map loaded: ' + sc.name);
      });
      li.appendChild(h);
      li.appendChild(p);
      li.appendChild(loadBtn);
      li.appendChild(document.createTextNode(' '));
      li.appendChild(runBtn);
      host.appendChild(li);
    });
  }

  /* ---------------- world editor ---------------- */

  var BRUSHES = [
    { tile: TILE.EMPTY, label: 'Floor' },
    { tile: TILE.WALL, label: 'Wall' },
    { tile: TILE.TARGET, label: 'Goal pad' },
    { tile: TILE.CHARGER, label: 'Charger' },
    { tile: TILE.CRATE, label: 'Crate' },
    { tile: TILE.PIT, label: 'Pit' },
    { tile: 'start', label: 'Start tile' }
  ];

  function wireWorldPage() {
    var host = $('brushes');
    host.innerHTML = '';
    BRUSHES.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'brush' + (b.tile === app.brush ? ' is-active' : '');
      var sw = document.createElement('i');
      sw.style.background = b.tile === 'start' ? '#8fa3b5' : RF.TILE_META[b.tile].color;
      btn.appendChild(sw);
      btn.appendChild(document.createTextNode(b.label));
      btn.addEventListener('click', function () {
        app.brush = b.tile;
        Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
      host.appendChild(btn);
    });

    var canvas = $('editorGrid');
    canvas.addEventListener('mousedown', function (e) { app.painting = true; paint(e); });
    canvas.addEventListener('mousemove', function (e) { if (app.painting) paint(e); });
    window.addEventListener('mouseup', function () { app.painting = false; });
    canvas.addEventListener('touchstart', function (e) { app.painting = true; paint(e.touches[0]); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { paint(e.touches[0]); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', function () { app.painting = false; });

    $('btnClearWorld').addEventListener('click', function () {
      app.world.clear();
      afterWorldEdit('map cleared');
    });
    $('btnBorderWorld').addEventListener('click', function () {
      app.world.border();
      afterWorldEdit('border added');
    });
    $('btnRandomWorld').addEventListener('click', function () {
      app.world.scatter(0.12);
      afterWorldEdit('walls scattered');
    });
    $('btnExportWorld').addEventListener('click', function () {
      download('roboforge-map.json', JSON.stringify(app.world.toJSON(), null, 2));
    });

    $('worldSize').textContent = app.world.cols + ' × ' + app.world.rows;
    drawEditor();
  }

  function paint(evt) {
    var cell = app.mapEditor.cellAt(evt.clientX, evt.clientY);
    if (!app.world.inside(cell.x, cell.y)) return;
    if (app.brush === 'start') {
      if (app.world.blocked(cell.x, cell.y)) return;
      app.world.start.x = cell.x;
      app.world.start.y = cell.y;
      if (!app.running) { app.robot.reset(); }
    } else {
      app.world.set(cell.x, cell.y, app.brush);
      app.robot.targetsTotal = app.world.countTile(TILE.TARGET);
    }
    drawEditor();
    updateHUD();
  }

  function afterWorldEdit(message) {
    app.robot.targetsTotal = app.world.countTile(TILE.TARGET);
    drawEditor();
    updateHUD();
    log(message);
  }

  function drawEditor() {
    app.mapEditor.draw(app.robot, { showSensor: false });
  }

  function loadWorld(world) {
    app.world = world;
    app.robot.world = world;
    app.sim = new RF.Renderer($('grid'), world);
    app.mapEditor = new RF.Renderer($('editorGrid'), world);
    resetRun(false);
    $('worldSize').textContent = world.cols + ' × ' + world.rows;
    drawEditor();
  }

  /* ---------------- robot page ---------------- */

  var COLORS = ['#5fb7f0', '#4fd6a6', '#f2a93b', '#ef6b6b', '#a98bf0', '#e6edf3'];

  function wireRobotPage() {
    var chassisHost = $('chassisList');
    chassisHost.innerHTML = '';
    Object.keys(RF.CHASSIS).forEach(function (key) {
      var btn = document.createElement('button');
      btn.textContent = RF.CHASSIS[key].label;
      btn.classList.toggle('is-active', key === app.robot.chassis);
      btn.addEventListener('click', function () {
        app.robot.chassis = key;
        Array.prototype.forEach.call(chassisHost.children, function (c) { c.classList.remove('is-active'); });
        btn.classList.add('is-active');
        renderSpecs();
        log('chassis swapped to ' + RF.CHASSIS[key].label);
      });
      chassisHost.appendChild(btn);
    });

    var swHost = $('swatches');
    swHost.innerHTML = '';
    COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.style.background = c;
      b.classList.toggle('is-active', c === app.robot.color);
      b.title = c;
      b.addEventListener('click', function () {
        app.robot.color = c;
        Array.prototype.forEach.call(swHost.children, function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
      swHost.appendChild(b);
    });

    $('robotName').addEventListener('change', function () {
      app.robot.name = $('robotName').value || 'Scrappy';
    });
    $('chatty').addEventListener('change', function () { app.robot.chatty = $('chatty').checked; });
    $('trail').addEventListener('change', function () { app.robot.showTrail = $('trail').checked; });

    renderSpecs();
  }

  function renderSpecs() {
    var s = app.robot.spec();
    $('specs').innerHTML = '';
    [
      ['Drive speed', s.speed + '×'],
      ['Battery drain per cell', s.drain + '%'],
      ['Armour', s.armor],
      ['Sensor range', s.sensorRange + ' cells']
    ].forEach(function (row) {
      var d = document.createElement('div');
      d.className = 'row';
      var a = document.createElement('span'); a.textContent = row[0];
      var b = document.createElement('b'); b.textContent = row[1];
      d.appendChild(a); d.appendChild(b);
      $('specs').appendChild(d);
    });
  }

  function robotOpts() {
    return { chassis: app.robot.chassis, color: app.robot.color, name: app.robot.name };
  }

  /* ---------------- saves ---------------- */

  function wireSaves() {
    $('btnSave').addEventListener('click', function () {
      var name = ($('saveName').value || '').trim();
      if (!name) { log('name the build before saving', 'warn'); return; }
      var saves = readSaves();
      saves[name] = {
        script: RF.script.generate(app.program),
        world: app.world.toJSON(),
        saved: new Date().toISOString()
      };
      writeSaves(saves);
      renderSaves();
      log('saved "' + name + '"', 'good');
    });

    $('btnExport').addEventListener('click', function () {
      download('roboforge-project.json', JSON.stringify({
        version: 1,
        script: RF.script.generate(app.program),
        world: app.world.toJSON(),
        robot: robotOpts()
      }, null, 2));
    });

    $('fileImport').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          applyProject(data);
          log('project imported', 'good');
        } catch (err) {
          log('import failed: ' + err.message, 'bad');
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });

    renderSaves();
  }

  function applyProject(data) {
    if (data.script) {
      var tree = RF.script.parse(data.script);
      app.program.length = 0;
      tree.forEach(function (b) { app.program.push(b); });
      app.editor.render();
    }
    if (data.world) loadWorld(RF.World.fromJSON(data.world));
    if (data.robot) {
      app.robot.chassis = data.robot.chassis || app.robot.chassis;
      app.robot.color = data.robot.color || app.robot.color;
      app.robot.name = data.robot.name || app.robot.name;
      $('robotName').value = app.robot.name;
      wireRobotPage();
    }
  }

  function readSaves() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function writeSaves(saves) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saves)); }
    catch (e) { log('browser storage refused the save: ' + e.message, 'bad'); }
  }

  function renderSaves() {
    var host = $('saveList');
    host.innerHTML = '';
    var saves = readSaves();
    var names = Object.keys(saves).sort();
    if (!names.length) {
      var li = document.createElement('li');
      li.textContent = 'No saved builds yet.';
      li.style.color = '#8fa3b5';
      host.appendChild(li);
      return;
    }
    names.forEach(function (name) {
      var li = document.createElement('li');
      var load = document.createElement('button');
      load.textContent = name;
      load.addEventListener('click', function () {
        try {
          applyProject(saves[name]);
          log('loaded "' + name + '"', 'good');
        } catch (e) {
          log('could not load "' + name + '": ' + e.message, 'bad');
        }
      });
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'delete';
      del.addEventListener('click', function () {
        var all = readSaves();
        delete all[name];
        writeSaves(all);
        renderSaves();
      });
      li.appendChild(load);
      li.appendChild(del);
      host.appendChild(li);
    });
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);
