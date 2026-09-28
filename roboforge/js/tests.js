/* tests.js — scenarios the program can be graded against. */
(function (global) {
  'use strict';

  var RF = global.RF;

  var SCENARIOS = [
    {
      id: 'corridor',
      name: 'Straight corridor',
      brief: 'Drive from the west end to the goal pad without touching a wall.',
      map: 'corridor',
      battery: 100,
      checks: [
        { label: 'reached the goal pad', test: function (s) { return s.robot.targetsHit >= 1; } },
        { label: 'no wall bumps', test: function (s) { return s.robot.bumps === 0; } },
        { label: 'battery above 40%', test: function (s) { return s.robot.battery > 40; } }
      ]
    },
    {
      id: 'avoid',
      name: 'Obstacle avoidance',
      brief: 'Scattered walls. Keep moving for 60 steps and never bump.',
      map: 'open',
      scatter: 0.14,
      battery: 100,
      checks: [
        { label: 'at least 40 steps driven', test: function (s) { return s.robot.steps >= 40; } },
        { label: 'no wall bumps', test: function (s) { return s.robot.bumps === 0; } },
        { label: 'motors stayed under 95°C', test: function (s) { return s.robot.heat < 95; } }
      ]
    },
    {
      id: 'maze',
      name: 'Maze run',
      brief: 'Find the goal pad in the maze. Wall-following usually cracks it.',
      map: 'maze',
      battery: 100,
      checks: [
        { label: 'reached the goal pad', test: function (s) { return s.robot.targetsHit >= 1; } },
        { label: 'fewer than 5 bumps', test: function (s) { return s.robot.bumps < 5; } },
        { label: 'battery not empty', test: function (s) { return s.robot.battery > 0; } }
      ]
    },
    {
      id: 'collect',
      name: 'Collect four pads',
      brief: 'Four goal pads are spread across the map. Clear them all.',
      map: 'collect',
      battery: 100,
      checks: [
        { label: 'all four pads cleared', test: function (s) { return s.robot.targetsHit >= 4; } },
        { label: 'fewer than 10 bumps', test: function (s) { return s.robot.bumps < 10; } }
      ]
    },
    {
      id: 'battery',
      name: 'Battery discipline',
      brief: 'Starts at 30%. Use the charger before making the run to the goal pad.',
      map: 'battery',
      battery: 30,
      checks: [
        { label: 'reached the goal pad', test: function (s) { return s.robot.targetsHit >= 1; } },
        { label: 'robot still alive', test: function (s) { return s.robot.alive; } },
        { label: 'used the charger', test: function (s) { return s.charged; } }
      ]
    },
    {
      id: 'heat',
      name: 'Thermal limit',
      brief: 'Long runs heat the motors. Finish with heat under 70°C.',
      map: 'open',
      battery: 100,
      checks: [
        { label: 'at least 30 steps driven', test: function (s) { return s.robot.steps >= 30; } },
        { label: 'motor heat under 70°C', test: function (s) { return s.robot.heat < 70; } },
        { label: 'no wall bumps', test: function (s) { return s.robot.bumps === 0; } }
      ]
    }
  ];

  function buildWorld(scenario) {
    var world = RF.preset(scenario.map);
    if (scenario.scatter) world.scatter(scenario.scatter);
    return world;
  }

  /* Runs the program with no animation and grades it. */
  function run(scenario, program, options) {
    var maxTicks = (options && options.maxTicks) || 4000;
    var world = buildWorld(scenario);
    var robot = new RF.Robot(world, options && options.robotOpts);
    robot.battery = scenario.battery;

    var compiled, optimised, vm;
    try {
      compiled = RF.compiler.compile(program);
      optimised = RF.compiler.optimise(compiled.ir);
      vm = new RF.VM(optimised.ir, robot);
    } catch (e) {
      return { ok: false, compileError: e.message };
    }

    var charged = false, ticks = 0, lastError = null;
    while (!vm.halted && ticks < maxTicks) {
      var r = vm.tick();
      ticks++;
      if (r && r.action && r.action.indexOf('charging') === 0) charged = true;
      if (r && r.error) { lastError = r.error; break; }
    }

    var state = { robot: robot, vm: vm, charged: charged, ticks: ticks };
    var results = scenario.checks.map(function (c) {
      var passed = false;
      try { passed = !!c.test(state); } catch (e) { passed = false; }
      return { label: c.label, passed: passed };
    });

    return {
      ok: true,
      scenario: scenario,
      results: results,
      passed: results.every(function (r) { return r.passed; }),
      ticks: ticks,
      timeout: ticks >= maxTicks && !vm.halted,
      error: lastError || vm.error,
      stats: {
        steps: robot.steps,
        bumps: robot.bumps,
        battery: Math.round(robot.battery),
        heat: Math.round(robot.heat),
        goals: robot.targetsHit + '/' + robot.targetsTotal,
        instructions: RF.compiler.countReal(optimised.ir)
      }
    };
  }

  function report(result) {
    if (!result.ok) return 'Compile error\n\n' + result.compileError;
    var lines = [];
    lines.push(result.scenario.name);
    lines.push(result.passed ? 'RESULT: PASS' : 'RESULT: FAIL');
    lines.push('');
    result.results.forEach(function (r) {
      lines.push((r.passed ? '[pass] ' : '[fail] ') + r.label);
    });
    lines.push('');
    lines.push('steps        ' + result.stats.steps);
    lines.push('bumps        ' + result.stats.bumps);
    lines.push('battery      ' + result.stats.battery + '%');
    lines.push('motor heat   ' + result.stats.heat + '°C');
    lines.push('goal pads    ' + result.stats.goals);
    lines.push('instructions ' + result.stats.instructions);
    lines.push('ticks        ' + result.ticks);
    if (result.timeout) lines.push('\nThe run hit the tick ceiling — the program never finished.');
    if (result.error) lines.push('\nRuntime stop: ' + result.error);
    return lines.join('\n');
  }

  RF.tests = { SCENARIOS: SCENARIOS, run: run, report: report, buildWorld: buildWorld };
})(window);
