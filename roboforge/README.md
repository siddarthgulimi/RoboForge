# RoboForge Lite

A virtual robot you can program with Scratch-style blocks, watch drive around a grid,
and grade against test scenarios. No hardware, no build step, no server — open
`index.html` in a browser and it runs.

## Run it

    unzip roboforge.zip
    cd roboforge
    open index.html          # macOS
    xdg-open index.html      # Linux
    start index.html         # Windows

Everything is plain HTML/CSS/JS. No npm install, no internet connection needed.
If you prefer a local server: `python3 -m http.server 8000` then visit
`http://localhost:8000`.

## What is in the app

**Studio** — the palette on the left, the block program in the middle, the live
grid simulator on the right, and a timeline of everything the robot did along the
bottom. Click a palette block to add it. Drag blocks to reorder them. Click a
container block (repeat / while / if) to select it — new blocks then drop inside it.
Click it again to deselect.

Toggle the program panel between **Blocks** and **RoboScript**. The text form and
the block form are the same tree, so you can write code, press *Apply to blocks*,
and keep editing visually.

**Compiler** — the pipeline, stage by stage: source → tokens → AST → IR →
optimised IR → bytecode. Click any stage to inspect it. The optimiser panel reports
what it stripped and the instruction-count reduction.

**Test lab** — six scenarios (corridor, obstacle field, maze, four-pad collection,
battery discipline, thermal limit). *Load map* puts the scenario on the simulator;
*Run checks* runs your program headless and grades it against the scenario's checks.

**World editor** — paint walls, goal pads, chargers, crates, pits and the start tile
straight onto the grid. Export the map as JSON.

**Robot** — four chassis with different speed / drain / armour / sensor range,
a paint colour, a name, and toggles for chatty moods and the motion trail.

## The robot

State: grid position, heading, battery, motor heat, step count, bump count,
goal pads collected, and a mood.

Moods react to what happens: *curious* when idle, *focused* while running, *happy*
on a goal pad, *proud* when every pad is cleared, *bruised* after a bump, *tired*
under 20% battery, *overheated* past 85°C, *charging* on a charger pad, *flat* when
the battery hits zero. The face on the robot and the mood card both follow.

Sensors readable from a condition:

| sensor | meaning |
| --- | --- |
| `distance` | clear cells ahead, up to the chassis sensor range |
| `left` / `right` | clear cells to each side |
| `battery` | charge percent |
| `heat` | motor temperature in °C |
| `onTarget` / `onCharger` | 1 when standing on that tile |
| `goalsLeft` | goal pads not yet collected |
| `bumps` / `steps` | running counters |
| `x` / `y` | grid position |

## RoboScript

    MOVE 3                 # drive 3 cells forward
    BACK 1                 # reverse one cell
    TURN LEFT              # or TURN RIGHT
    FACE NORTH             # NORTH | EAST | SOUTH | WEST
    WAIT 2                 # idle for 2 ticks
    SPEED 2                # 0.25 to 4
    CHARGE 20              # only works on a charger pad
    SAY "text"
    STOP

    REPEAT 4
      MOVE 2
    END

    FOREVER                # loops until every goal pad is collected
      MOVE 1
    END

    WHILE battery > 20
      MOVE 1
    END

    IF distance < 1
      TURN RIGHT
    ELSE
      MOVE 1
    END

    # lines starting with # are comments

Conditions are `sensor op number`, where op is `<`, `<=`, `=`, `!=`, `>=` or `>`.

Example programs are in `examples/`. Paste one into the RoboScript tab and press
*Apply to blocks*. `wall-follower.robo` and `sensor-bounce.robo` both solve the maze
scenario.

## How it is put together

    index.html          shell and panels
    css/styles.css      the whole UI
    js/world.js         grid model, tiles, preset maps, JSON import/export
    js/robot.js         robot state, sensors, battery/heat, mood engine
    js/blocks.js        block definitions, program tree, palette, drag-and-drop editor
    js/roboscript.js    lexer, parser (text -> blocks), generator (blocks -> text)
    js/compiler.js      blocks -> IR -> optimiser -> bytecode, plus the stage dumps
    js/vm.js            the VM that steps the IR one tick at a time
    js/render.js        canvas drawing of grid, props, sensor cone and robot
    js/tests.js         scenarios and the headless grading runner
    js/app.js           wiring: transport controls, HUD, pages, saves

The compiler is the real thing, not a translation table: the block tree and the
RoboScript text both reduce to one AST, the AST lowers to a labelled IR, the
optimiser runs six passes over that IR (dead no-ops, motion folding, turn
cancelling, unreachable code after STOP, jumps to the next line, unused labels),
and the result is assembled into two-byte instructions. The VM executes the
optimised IR so that what you watch on the grid is what the optimiser produced.

## Saving work

*Save* stores the program and map in browser localStorage under a name.
*Export .json* writes a project file (script + map + robot) you can share, and
*Import* reads it back. Maps can be exported on their own from the world editor.

## Limits worth knowing

- Conditions compare a sensor to a number, not to another sensor.
- A loop that never moves aborts after 400 instructions in one tick, and any run
  stops at 20,000 ticks, so a bad loop cannot hang the tab.
- localStorage is per-browser. Clearing site data clears the saves; use export for
  anything you care about.
