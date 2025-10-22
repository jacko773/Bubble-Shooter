import React, { useRef, useEffect, useState } from "react";

// Mobile-first Bubble Shooter - single-file React component
// TailwindCSS required in the hosting project (index.css)

export default function BubbleShooter() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [score, setScore] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const rows = 10;
  const cols = 8; // grid size
  // reduced overall bubble size to half
  const cellSize = 18; // was 36 -> now half
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

  // grid: null or { color }
  const gridRef = useRef(generateInitialGrid(rows, cols, colors));

  // shooter state (exactly two bubbles shown at bottom)
  const shooterRef = useRef({
    x: 0,
    y: 0,
    radius: cellSize / 2 - 1, // slightly smaller stroke
    main: randomColor(colors),
    secondary: randomColor(colors),
    projectile: null,
    moving: false,
    hudAnim: null, // { start, duration, type }
    animLock: false, // when true, physics & firing paused during grid animation
  });

  // aiming preview
  const aimRef = useRef({ angle: -Math.PI / 2, active: false });

  // animation ref for whole-grid shifts
  // animRef.current = { active: bool, start: timestamp, duration: ms, dir: 1|-1 }
  const animRef = useRef({ active: false, start: 0, duration: 300, dir: 0 });

  function randomColor(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function generateInitialGrid(r, c, colors) {
    const grid = Array.from({ length: r }, (_, row) =>
      Array.from({ length: c }, (_, col) => {
        // create a few filled rows at top
        if (row < 4) return { color: colors[Math.floor(Math.random() * colors.length)] };
        return null;
      })
    );
    return grid;
  }

  function gridToPos(row, col) {
    const x = col * cellSize + ((row % 2) * (cellSize / 2));
    const y = row * (cellSize - 3);
    return { x, y };
  }

  function posToGrid(x, y) {
    let best = { row: 0, col: 0, d: Infinity };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const p = gridToPos(row, col);
        const cx = p.x + cellSize / 2;
        const cy = p.y + cellSize / 2;
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < best.d) best = { row, col, d };
      }
    }
    return { row: best.row, col: best.col };
  }

  // easing
  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  // ---------- Grid shift animation helpers ----------
  function startGridShift(direction = -1, duration = 300) {
    // direction: -1 => move whole screen UP (rows move up visually), 1 => move DOWN
    if (animRef.current.active) return; // already animating
    animRef.current = { active: true, start: performance.now(), duration, dir: direction };
    // lock firing/physics
    shooterRef.current.animLock = true;
    // schedule the data mutation at animation end
    setTimeout(() => {
      // perform actual grid data shift
      if (direction === -1) {
        // move logical grid up: row 0 <- row1, ..., last <- empty row
        for (let r = 0; r < rows - 1; r++) {
          gridRef.current[r] = gridRef.current[r + 1];
        }
        // new bottom row empty
        gridRef.current[rows - 1] = Array.from({ length: cols }, () => null);
      } else {
        // move logical grid down: last <- second-last, ..., row0 <- empty
        for (let r = rows - 1; r >= 1; r--) {
          gridRef.current[r] = gridRef.current[r - 1];
        }
        gridRef.current[0] = Array.from({ length: cols }, () => null);
      }
      // unlock after a tiny delay to ensure final frame shows new data
      setTimeout(() => {
        animRef.current.active = false;
        shooterRef.current.animLock = false;
      }, 16);
    }, duration);
  }

  // expose two buttons for testing: shift up and shift down
  // (in-game you can call startGridShift when certain events happen)

  // ---------- rest of existing gameplay (trajectory, fire, snap, floodfill...) ----------
  // line-segment / circle collision helper
  function segmentIntersectsCircle(sx, sy, ex, ey, cx, cy, r) {
    const dx = ex - sx;
    const dy = ey - sy;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(cx - sx, cy - sy) <= r;
    let t = ((cx - sx) * dx + (cy - sy) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = sx + t * dx;
    const py = sy + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    return dist <= r;
  }

  function computeTrajectory(startX, startY, angle, maxBounces = 4) {
    const canvas = canvasRef.current;
    const scale = window.devicePixelRatio || 1;
    const width = canvas.width / scale;
    const segments = [];

    let x = startX;
    let y = startY;
    let vx = Math.cos(angle);
    let vy = Math.sin(angle);
    const speed = 1;

    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      let tx = Infinity;
      if (vx > 0) tx = (width - (x + shooterRef.current.radius)) / (vx * speed);
      else if (vx < 0) tx = ((shooterRef.current.radius) - x) / (vx * speed);
      let ty = Infinity;
      if (vy < 0) ty = ((shooterRef.current.radius) - y) / (vy * speed);
      const tEvent = Math.min(tx, ty);
      if (!isFinite(tEvent)) break;
      const endX = x + vx * speed * tEvent;
      const endY = y + vy * speed * tEvent;

      // collision check only on visible rows when computing preview
      let collision = null;
      const projR = shooterRef.current.radius;
      const cellR = cellSize / 2 - 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = gridRef.current[r][c];
          if (!cell) continue;
          const pos = gridToPos(r, c);
          const cx = pos.x + cellSize / 2;
          const cy = pos.y + cellSize / 2;
          const hit = segmentIntersectsCircle(x, y, endX, endY, cx, cy, cellR + projR - 0.5);
          if (hit) {
            const dx = endX - x;
            const dy = endY - y;
            const l2 = dx * dx + dy * dy || 1;
            let t = ((cx - x) * dx + (cy - y) * dy) / l2;
            t = Math.max(0, Math.min(1, t));
            const px = x + dx * t;
            const py = y + dy * t;
            collision = { row: r, col: c, x: px, y: py };
            break;
          }
        }
        if (collision) break;
      }

      if (collision) {
        segments.push({ x1: x, y1: y, x2: collision.x, y2: collision.y });
        return { segments, hit: true, point: { x: collision.x, y: collision.y }, row: collision.row, col: collision.col };
      }

      segments.push({ x1: x, y1: y, x2: endX, y2: endY });
      if (ty <= tx) return { segments, hit: false };
      x = endX;
      y = endY;
      vx = -vx;
    }
    return { segments, hit: false };
  }

  // fire main ball
  function fire(angle) {
    const s = shooterRef.current;
    if (s.moving || s.animLock) return; // don't allow firing while grid animating
    const minVy = -0.02;
    let vy = Math.sin(angle);
    let vx = Math.cos(angle);
    if (vy > minVy) {
      vy = minVy;
      angle = Math.atan2(vy, vx);
    }
    const speed = 8;
    s.projectile = { x: s.x, y: s.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: s.radius, color: s.main, alive: true };
    s.moving = true;
    s.main = s.secondary;
    s.secondary = randomColor(colors);
    s.hudAnim = { start: performance.now(), duration: 180, type: "fire" };
    aimRef.current.active = false;
  }

  function stopProjectileAndSnap() {
    const s = shooterRef.current;
    const p = s.projectile;
    if (!p) return;
    const { row, col } = posToGrid(p.x, p.y);
    if (row < 0) {
      s.projectile = null;
      s.moving = false;
      return;
    }
    if (!gridRef.current[row][col]) {
      gridRef.current[row][col] = { color: p.color };
      const matched = floodFill(row, col, p.color);
      if (matched.length >= 3) {
        matched.forEach(([r, co]) => (gridRef.current[r][co] = null));
        setScore((s) => s + matched.length * 10);
        removeFloating();
      }
    }
    s.projectile = null;
    s.moving = false;
  }

  function floodFill(sr, sc, color) {
    const visited = new Set();
    const stack = [[sr, sc]];
    while (stack.length) {
      const [r, c] = stack.pop();
      const key = r + ":" + c;
      if (visited.has(key)) continue;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const cell = gridRef.current[r][c];
      if (!cell || cell.color !== color) continue;
      visited.add(key);
      const offsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, r % 2 === 0 ? -1 : 1],
        [1, r % 2 === 0 ? -1 : 1],
      ];
      offsets.forEach(([dr, dc]) => stack.push([r + dr, c + dc]));
    }
    return Array.from(visited).map((k) => k.split(":").map(Number));
  }

  function removeFloating() {
    const reachable = new Set();
    const stack = [];
    for (let col = 0; col < cols; col++) {
      if (gridRef.current[0][col]) stack.push([0, col]);
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      const key = r + ":" + c;
      if (reachable.has(key)) continue;
      reachable.add(key);
      const offsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, r % 2 === 0 ? -1 : 1],
        [1, r % 2 === 0 ? -1 : 1],
      ];
      offsets.forEach(([dr, dc]) => {
        const nr = r + dr,
          nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridRef.current[nr][nc]) {
          stack.push([nr, nc]);
        }
      });
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = r + ":" + c;
        if (gridRef.current[r][c] && !reachable.has(key)) {
          gridRef.current[r][c] = null;
          setScore((s) => s + 5);
        }
      }
    }
  }

  // input handling: pointermove for aiming preview; tap anywhere except secondary to shoot (only upward allowed); tap secondary to swap
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;

    function getCanvasPosFromClient(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        rect,
      };
    }

    function onPointerMove(e) {
      const s = shooterRef.current;
      if (s.moving) return;
      const clientX = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX);
      const clientY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
      if (clientX == null || clientY == null) return;
      const { x, y } = getCanvasPosFromClient(clientX, clientY);
      aimRef.current.angle = Math.atan2(y - s.y, x - s.x);
      aimRef.current.active = true;
    }

    function onPointerDown(e) {
      const clientX = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX);
      const clientY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
      if (clientX == null || clientY == null) return;

      const s = shooterRef.current;
      const { x: clickX, y: clickY, rect } = getCanvasPosFromClient(clientX, clientY);

      // HUD positions computed on a circle centered at shooter position with 90deg separation
      const centerCanvasX = s.x; // already in canvas coords
      const centerCanvasY = s.y; // bottom center
      const orbitR = 48; // radius of the circle where HUD bubbles sit
      const mainAngle = -Math.PI * 3 / 4; // -135deg
      const secAngle = -Math.PI / 4; // -45deg
      const mainX = centerCanvasX + Math.cos(mainAngle) * orbitR;
      const mainY = centerCanvasY + Math.sin(mainAngle) * orbitR;
      const secX = centerCanvasX + Math.cos(secAngle) * orbitR;
      const secY = centerCanvasY + Math.sin(secAngle) * orbitR;

      const distMain = Math.hypot(clickX - mainX, clickY - mainY);
      const distSec = Math.hypot(clickX - secX, clickY - secY);
      const hitRadius = s.radius + 6;

      // If clicked on secondary bubble -> swap (no fire)
      if (distSec <= hitRadius) {
        const t = s.main;
        s.main = s.secondary;
        s.secondary = t;
        // trigger swap animation
        s.hudAnim = { start: performance.now(), duration: 220, type: "swap" };
        e.preventDefault();
        return;
      }

      // Otherwise attempt to shoot: update aim to click position
      aimRef.current.angle = Math.atan2(clickY - s.y, clickX - s.x);
      aimRef.current.active = true;
      const angle = aimRef.current.angle;
      const vy = Math.sin(angle);
      // Only shoot if aiming upward
      if (vy < 0 && !s.moving) {
        fire(angle);
        e.preventDefault();
      } else {
        // downward click -> ignore
        e.preventDefault();
      }
    }

    container.addEventListener("pointermove", onPointerMove, { passive: false });
    container.addEventListener("pointerdown", onPointerDown, { passive: false });

    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      const parent = canvas.parentElement;
      const width = Math.min(parent.clientWidth, cols * cellSize + 10);
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor((rows * (cellSize - 3) + 110) * scale);
      canvas.style.width = width + "px";
      canvas.style.height = Math.floor(rows * (cellSize - 3) + 110) + "px";
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const s = shooterRef.current;
      s.x = canvas.width / scale / 2;
      s.y = canvas.height / scale - 30;
    }

    resize();
    window.addEventListener("resize", resize);

    function loop() {
      if (!isRunning) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // compute current animation offset
      let drawOffset = 0;
      if (animRef.current.active) {
        const a = animRef.current;
        const t = Math.min(1, (performance.now() - a.start) / Math.max(1, a.duration));
        const eased = easeOutQuad(t);
        // dir: -1 means visually move rows up (we shift positions by -rowHeight * eased)
        const rowH = cellSize - 3;
        drawOffset = -a.dir * eased * rowH; // negative for up
      }

      drawGrid(ctx, drawOffset);
      drawShooterHUD(ctx);
      drawAimPreview(ctx);
      // pause physics during whole-grid animation to avoid race conditions
      if (!animRef.current.active) updatePhysics();

      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [isRunning]);

  function drawGrid(ctx, drawOffset = 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = gridRef.current[r][c];
        const pos = gridToPos(r, c);
        const cx = pos.x + cellSize / 2;
        const cy = pos.y + cellSize / 2 + drawOffset;
        ctx.beginPath();
        ctx.arc(cx, cy, cellSize / 2 - 1, 0, Math.PI * 2);
        ctx.fillStyle = cell ? cell.color : "#111827";
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        if (!cell) {
          ctx.beginPath();
          ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = "#0b1220";
          ctx.fill();
        }
      }
    }
  }

  function drawShooterHUD(ctx) {
    const s = shooterRef.current;
    const centerX = s.x;
    const centerY = s.y;
    const orbitR = 48;
    const mainAngle = -Math.PI * 3 / 4; // -135deg
    const secAngle = -Math.PI / 4; // -45deg
    const mainX = centerX + Math.cos(mainAngle) * orbitR;
    const mainY = centerY + Math.sin(mainAngle) * orbitR;
    const secX = centerX + Math.cos(secAngle) * orbitR;
    const secY = centerY + Math.sin(secAngle) * orbitR;

    // compute animation scales
    let mainScale = 1;
    let secScale = 1;
    if (s.hudAnim) {
      const now = performance.now();
      const elapsed = now - s.hudAnim.start;
      const t = Math.min(1, Math.max(0, elapsed / s.hudAnim.duration));
      const eased = easeOutQuad(t);
      if (s.hudAnim.type === "swap") {
        mainScale = 1 + 0.32 * eased;
        secScale = 1 - 0.12 * eased;
      } else if (s.hudAnim.type === "fire") {
        mainScale = 1 + 0.12 * eased;
      }
      if (t >= 1) s.hudAnim = null;
    }

    // draw connecting arc (quarter circle) for visual
    ctx.beginPath();
    ctx.arc(centerX, centerY, orbitR + 6, -Math.PI * 3 / 4, -Math.PI / 4);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // main (on the left-upper of the circle) - clickable to fire
    ctx.save();
    ctx.translate(mainX, mainY);
    ctx.beginPath();
    ctx.arc(0, 0, s.radius * mainScale, 0, Math.PI * 2);
    ctx.fillStyle = s.main;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // secondary (on the right-upper of the circle) - clickable to swap into main
    ctx.save();
    ctx.translate(secX, secY);
    ctx.beginPath();
    ctx.arc(0, 0, s.radius * secScale, 0, Math.PI * 2);
    ctx.fillStyle = s.secondary;
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // draw projectile if present
    if (s.projectile) {
      const p = s.projectile;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // draw aim preview with multi-bounce trajectory
  function drawAimPreview(ctx) {
    const s = shooterRef.current;
    const aim = aimRef.current;
    if (s.moving || !aim.active) return;
    const startX = s.x;
    const startY = s.y;
    const angle = aim.angle;

    // compute predicted path with up to 5 bounces
    const traj = computeTrajectory(startX, startY, angle, 5);

    // draw segments
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    traj.segments.forEach((seg) => {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // draw ghost at final collision point or at end of last segment
    if (traj.hit) {
      const p = traj.point;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.stroke();
    } else {
      const last = traj.segments[traj.segments.length - 1];
      if (last) {
        ctx.beginPath();
        ctx.arc(last.x2, last.y2, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function updatePhysics() {
    const s = shooterRef.current;
    const canvas = canvasRef.current;
    if (s.projectile && s.projectile.alive) {
      const p = s.projectile;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x - p.radius < 0) {
        p.x = p.radius;
        p.vx *= -1;
      }
      if (p.x + p.radius > canvas.width / (window.devicePixelRatio || 1)) {
        p.x = canvas.width / (window.devicePixelRatio || 1) - p.radius;
        p.vx *= -1;
      }
      if (p.y - p.radius <= 0) {
        p.y = p.radius;
        stopProjectileAndSnap();
        return;
      }
      // check collision with grid
      for (let r = 0; r < rows; r++) {
        for (let co = 0; co < cols; co++) {
          const cell = gridRef.current[r][co];
          if (!cell) continue;
          const pos = gridToPos(r, co);
          const cx = pos.x + cellSize / 2;
          const cy = pos.y + cellSize / 2;
          const dist = Math.hypot(cx - p.x, cy - p.y);
          if (dist <= p.radius + cellSize / 2 - 1) {
            stopProjectileAndSnap();
            return;
          }
        }
      }
    }
  }

  // initialize random main & secondary
  useEffect(() => {
    const s = shooterRef.current;
    s.main = randomColor(colors);
    s.secondary = randomColor(colors);
  }, []);

  // UI helpers to trigger a full-screen shift with animation
  function shiftScreenUp() {
    startGridShift(-1, 300);
  }
  function shiftScreenDown() {
    startGridShift(1, 300);
  }

  return (
    <div className="w-full max-w-md mx-auto p-3 touch-none select-none">
      <div className="bg-slate-900 text-white rounded-2xl p-3 shadow-lg">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm">Score: {score}</div>
          <div className="flex gap-2">
            <button className="px-2 py-1 bg-slate-700 rounded text-xs" onClick={shiftScreenUp}>
              Shift Up
            </button>
            <button className="px-2 py-1 bg-slate-700 rounded text-xs" onClick={shiftScreenDown}>
              Shift Down
            </button>
          </div>
        </div>
        <div className="relative bg-slate-800 rounded-lg overflow-hidden">
          <canvas ref={canvasRef} className="w-full h-[520px] block" />
          {/* HUD instructions */}
          <div className="absolute bottom-3 left-3 text-xs opacity-80">Tap the upper-left bubble to shoot. Tap the upper-right bubble to swap.</div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded"
            onClick={() => {
              gridRef.current = generateInitialGrid(rows, cols, colors);
              setScore(0);
            }}
          >
            Restart
          </button>
          <button
            className="px-3 py-2 bg-slate-700 rounded"
            onClick={() => setIsRunning((r) => !r)}
          >
            {isRunning ? "Pause" : "Resume"}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
Added:
- startGridShift(direction,duration): animates the entire grid visually up/down by one row height and on completion mutates the logical grid (shift up or down) to match.
- drawGrid accepts a drawOffset parameter (applied to vertical position) so the whole screen appears to move smoothly.
- During the animation, firing and physics are locked (shooterRef.current.animLock) to avoid race conditions.
- UI buttons "Shift Up" / "Shift Down" were added for testing; replace these calls with your game triggers.
*/
