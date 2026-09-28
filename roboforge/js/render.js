/* render.js — draws the grid, the props and the robot onto a canvas. */
(function (global) {
  'use strict';

  var TILE = global.RF.TILE;

  function Renderer(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.fit();
  }

  Renderer.prototype.fit = function () {
    this.cell = Math.floor(Math.min(
      this.canvas.width / this.world.cols,
      this.canvas.height / this.world.rows
    ));
    this.offX = Math.floor((this.canvas.width - this.cell * this.world.cols) / 2);
    this.offY = Math.floor((this.canvas.height - this.cell * this.world.rows) / 2);
  };

  Renderer.prototype.cellAt = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var scale = this.canvas.width / rect.width;
    var px = (clientX - rect.left) * scale - this.offX;
    var py = (clientY - rect.top) * scale - this.offY;
    return { x: Math.floor(px / this.cell), y: Math.floor(py / this.cell) };
  };

  Renderer.prototype.draw = function (robot, opts) {
    var ctx = this.ctx, c = this.cell, w = this.world;
    opts = opts || {};
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#0b121a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (var y = 0; y < w.rows; y++) {
      for (var x = 0; x < w.cols; x++) {
        var px = this.offX + x * c, py = this.offY + y * c;
        var tile = w.get(x, y);
        ctx.fillStyle = (x + y) % 2 ? '#101a24' : '#0e1720';
        ctx.fillRect(px, py, c, c);

        if (tile === TILE.WALL) {
          ctx.fillStyle = '#31475a';
          ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
          ctx.fillStyle = 'rgba(255,255,255,.06)';
          ctx.fillRect(px + 1, py + 1, c - 2, 3);
        } else if (tile === TILE.CRATE) {
          ctx.fillStyle = '#7d5fd0';
          roundRect(ctx, px + 3, py + 3, c - 6, c - 6, 4);
          ctx.fill();
        } else if (tile === TILE.TARGET) {
          var taken = robot && robot.collected[x + ',' + y];
          ctx.strokeStyle = taken ? '#2d6a55' : '#4fd6a6';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px + c / 2, py + c / 2, c * 0.28, 0, Math.PI * 2);
          ctx.stroke();
          if (!taken) {
            ctx.fillStyle = 'rgba(79,214,166,.25)';
            ctx.fill();
          }
        } else if (tile === TILE.CHARGER) {
          ctx.fillStyle = '#f2a93b';
          ctx.globalAlpha = 0.22;
          ctx.fillRect(px + 2, py + 2, c - 4, c - 4);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#f2a93b';
          ctx.font = Math.floor(c * 0.5) + 'px ' + monoFont();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⚡', px + c / 2, py + c / 2 + 1);
        } else if (tile === TILE.PIT) {
          ctx.fillStyle = '#20070a';
          ctx.fillRect(px + 2, py + 2, c - 4, c - 4);
          ctx.strokeStyle = '#ef6b6b';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 2.5, py + 2.5, c - 5, c - 5);
        }
      }
    }

    // grid lines
    ctx.strokeStyle = 'rgba(38,56,74,.55)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= w.cols; gx++) {
      line(ctx, this.offX + gx * c + 0.5, this.offY, this.offX + gx * c + 0.5, this.offY + w.rows * c);
    }
    for (var gy = 0; gy <= w.rows; gy++) {
      line(ctx, this.offX, this.offY + gy * c + 0.5, this.offX + w.cols * c, this.offY + gy * c + 0.5);
    }

    // start marker
    ctx.strokeStyle = '#8fa3b5';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(this.offX + w.start.x * c + 2.5, this.offY + w.start.y * c + 2.5, c - 5, c - 5);
    ctx.setLineDash([]);

    if (!robot) return;

    if (robot.showTrail && robot.trail.length > 1) {
      ctx.strokeStyle = 'rgba(95,183,240,.35)';
      ctx.lineWidth = Math.max(2, c * 0.12);
      ctx.beginPath();
      for (var t = 0; t < robot.trail.length; t++) {
        var p = robot.trail[t];
        var cx = this.offX + p.x * c + c / 2, cy = this.offY + p.y * c + c / 2;
        if (t === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    if (opts.showSensor !== false) this.drawSensorCone(robot);
    this.drawRobot(robot);
  };

  Renderer.prototype.drawSensorCone = function (robot) {
    var ctx = this.ctx, c = this.cell;
    var d = robot.distance();
    if (d <= 0) return;
    var dir = robot.heading();
    var x0 = this.offX + robot.rx * c + c / 2;
    var y0 = this.offY + robot.ry * c + c / 2;
    var x1 = x0 + dir.dx * d * c;
    var y1 = y0 + dir.dy * d * c;
    var grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(79,214,166,.45)');
    grad.addColorStop(1, 'rgba(79,214,166,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, c * 0.2);
    line(ctx, x0, y0, x1, y1);
  };

  Renderer.prototype.drawRobot = function (robot) {
    var ctx = this.ctx, c = this.cell;
    var cx = this.offX + robot.rx * c + c / 2;
    var cy = this.offY + robot.ry * c + c / 2;
    var size = c * 0.72;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((robot.rdir * Math.PI) / 180);

    ctx.fillStyle = 'rgba(0,0,0,.35)';
    roundRect(ctx, -size / 2 + 2, -size / 2 + 3, size, size, size * 0.24);
    ctx.fill();

    ctx.fillStyle = robot.alive ? robot.color : '#5b6b7a';
    roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.24);
    ctx.fill();

    // wheels
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(-size / 2 - 2, -size * 0.28, 3, size * 0.56);
    ctx.fillRect(size / 2 - 1, -size * 0.28, 3, size * 0.56);

    // face plate points toward the heading (up in local space)
    ctx.fillStyle = '#0d1117';
    roundRect(ctx, -size * 0.32, -size * 0.36, size * 0.64, size * 0.34, 4);
    ctx.fill();

    var eye = eyeStyle(robot.mood);
    ctx.fillStyle = eye.color;
    ctx.fillRect(-size * 0.20, -size * 0.30, size * 0.12, eye.h * size);
    ctx.fillRect(size * 0.08, -size * 0.30, size * 0.12, eye.h * size);

    // heading pip
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.moveTo(0, -size / 2 - 5);
    ctx.lineTo(-4, -size / 2 + 1);
    ctx.lineTo(4, -size / 2 + 1);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // battery pip above the robot
    var bw = c * 0.6;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(cx - bw / 2, cy - c * 0.52, bw, 4);
    ctx.fillStyle = robot.battery > 40 ? '#4fd6a6' : robot.battery > 15 ? '#f2a93b' : '#ef6b6b';
    ctx.fillRect(cx - bw / 2, cy - c * 0.52, bw * (robot.battery / 100), 4);
  };

  function eyeStyle(mood) {
    switch (mood) {
      case 'happy': case 'proud': return { color: '#4fd6a6', h: 0.10 };
      case 'hurt': return { color: '#ef6b6b', h: 0.16 };
      case 'tired': case 'charging': return { color: '#f2a93b', h: 0.06 };
      case 'hot': return { color: '#ef6b6b', h: 0.10 };
      case 'dead': return { color: '#5b6b7a', h: 0.06 };
      default: return { color: '#9fe8ff', h: 0.16 };
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function line(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function monoFont() {
    return 'ui-monospace, Menlo, Consolas, monospace';
  }

  global.RF.Renderer = Renderer;
})(window);
