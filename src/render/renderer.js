// Canvas 2D drawing, in world units.
//
// The camera maps world coordinates (metres, y up) to screen pixels (y down). Every
// drawing call below takes world coordinates except the text helpers, which take
// pixels — labels should stay upright and the same size however far the camera is
// zoomed out.

import { Vec2, v2 } from '../core/vec2.js';
import { SHAPE } from '../core/body.js';
import { C, alpha } from './palette.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    // World point sitting at the centre of the canvas, and pixels per metre.
    this.camera = { x: 0, y: 0, scale: 40 };
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.resize();
  }

  /**
   * Match the backing store to the CSS size times the device pixel ratio, so lines
   * are crisp on a retina tablet instead of soft.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    // Cap the ratio: a 3x phone screen triples the fill cost for no visible gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clear(colour = C.bg) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // --- camera -----------------------------------------------------------------

  toScreen(w) {
    return {
      x: (w.x - this.camera.x) * this.camera.scale + this.width / 2,
      y: this.height / 2 - (w.y - this.camera.y) * this.camera.scale,
    };
  }

  toWorld(px, py) {
    return v2(
      (px - this.width / 2) / this.camera.scale + this.camera.x,
      (this.height / 2 - py) / this.camera.scale + this.camera.y,
    );
  }

  /** Length in pixels of a world-space length. */
  px(worldLen) {
    return worldLen * this.camera.scale;
  }

  /** World length of a pixel distance — for hit radii that should feel constant. */
  world(pxLen) {
    return pxLen / this.camera.scale;
  }

  /**
   * Frame a world rectangle, leaving `pad` pixels of margin. `insets` reserves room
   * for the panels drawn over the canvas, so the action never hides behind the HUD.
   */
  fit(min, max, pad = 40, insets = { top: 0, right: 0, bottom: 0, left: 0 }, opts = {}) {
    const availW = Math.max(50, this.width - insets.left - insets.right - pad * 2);
    const availH = Math.max(50, this.height - insets.top - insets.bottom - pad * 2);
    const w = Math.max(max.x - min.x, 1e-3);
    const h = Math.max(max.y - min.y, 1e-3);

    this.camera.scale = Math.min(availW / w, availH / h);

    // Shift the centre so the framed region lands in the free area rather than
    // under the panels.
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const offX = (insets.left - insets.right) / 2;
    const offY = (insets.bottom - insets.top) / 2;
    this.camera.x = cx - offX / this.camera.scale;
    this.camera.y = cy - offY / this.camera.scale;

    /*
     * A wide, short scene is framed by its width, which leaves far more vertical
     * room than it needs — and centring in it buries the ground halfway up the
     * screen with dead space below. `anchor` pins one world height to a fraction
     * of the free area instead, so the horizon lands where a horizon belongs.
     */
    if (opts.anchor) {
      const { y, frac = 0.82 } = opts.anchor;
      const top = insets.top + pad;
      const targetPx = top + (this.height - insets.top - insets.bottom - pad * 2) * frac;
      this.camera.y = y - (this.height / 2 - targetPx) / this.camera.scale;
    }
  }

  // --- world-space primitives --------------------------------------------------

  /** Background grid, with heavier lines every `major` cells. */
  grid(spacing = 1, major = 5, opts = {}) {
    const { ctx } = this;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.width, this.height);

    // Do not attempt to draw a grid finer than a few pixels; it turns to mush and
    // costs thousands of strokes.
    if (this.px(spacing) < 6) return;

    const x0 = Math.floor(tl.x / spacing) * spacing;
    const x1 = Math.ceil(br.x / spacing) * spacing;
    const y0 = Math.floor(br.y / spacing) * spacing;
    const y1 = Math.ceil(tl.y / spacing) * spacing;

    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += spacing) {
      const isMajor = Math.abs(Math.round(x / spacing) % major) === 0;
      ctx.strokeStyle = isMajor ? (opts.major ?? C.gridMajor) : (opts.minor ?? C.grid);
      const s = this.toScreen(v2(x, 0));
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, 0);
      ctx.lineTo(Math.round(s.x) + 0.5, this.height);
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y += spacing) {
      const isMajor = Math.abs(Math.round(y / spacing) % major) === 0;
      ctx.strokeStyle = isMajor ? (opts.major ?? C.gridMajor) : (opts.minor ?? C.grid);
      const s = this.toScreen(v2(0, y));
      ctx.beginPath();
      ctx.moveTo(0, Math.round(s.y) + 0.5);
      ctx.lineTo(this.width, Math.round(s.y) + 0.5);
      ctx.stroke();
    }
  }

  circle(centre, radius, opts = {}) {
    const { ctx } = this;
    const s = this.toScreen(centre);
    const r = this.px(radius);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(r, 0.5), 0, Math.PI * 2);
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.width ?? 2;
      ctx.stroke();
    }
  }

  poly(worldPts, opts = {}) {
    const { ctx } = this;
    if (worldPts.length < 2) return;
    ctx.beginPath();
    const first = this.toScreen(worldPts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < worldPts.length; i++) {
      const s = this.toScreen(worldPts[i]);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.width ?? 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /** An open polyline through world points. */
  path(worldPts, opts = {}) {
    const { ctx } = this;
    if (worldPts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    const first = this.toScreen(worldPts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < worldPts.length; i++) {
      const s = this.toScreen(worldPts[i]);
      ctx.lineTo(s.x, s.y);
    }
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.strokeStyle = opts.stroke ?? C.text;
    ctx.lineWidth = opts.width ?? 2;
    ctx.lineCap = opts.cap ?? 'round';
    ctx.lineJoin = 'round';
    if (opts.glow) {
      ctx.shadowColor = opts.stroke ?? C.text;
      ctx.shadowBlur = opts.glow;
    }
    ctx.stroke();
    ctx.restore();
  }

  /** A trail that fades out towards its oldest end. */
  trail(worldPts, colour, opts = {}) {
    const { ctx } = this;
    if (worldPts.length < 2) return;
    const width = opts.width ?? 2;
    for (let i = 1; i < worldPts.length; i++) {
      const t = i / worldPts.length;
      const a = this.toScreen(worldPts[i - 1]);
      const b = this.toScreen(worldPts[i]);
      ctx.strokeStyle = alpha(colour, t * (opts.alpha ?? 0.7));
      ctx.lineWidth = width * (0.4 + 0.6 * t);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /**
   * The workhorse. Arrows carry every physical quantity in the exhibit, so they get
   * a real arrowhead sized in pixels — a head scaled in world units disappears when
   * the camera pulls back, exactly when you need it most.
   */
  arrow(fromWorld, toWorld, opts = {}) {
    const { ctx } = this;
    const a = this.toScreen(fromWorld);
    const b = this.toScreen(toWorld);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1.5) return;

    const colour = opts.colour ?? C.velocity;
    const width = opts.width ?? 3;
    // Head is capped so short arrows stay readable and long ones stay in proportion.
    const head = Math.min(opts.head ?? 13, len * 0.45);
    const ux = dx / len;
    const uy = dy / len;
    // Stop the shaft short so the head's point, not the shaft's end, is the tip.
    const shaftEnd = { x: b.x - ux * head * 0.85, y: b.y - uy * head * 0.85 };

    ctx.save();
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(shaftEnd.x, shaftEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * head + -uy * head * 0.45, b.y - uy * head + ux * head * 0.45);
    ctx.lineTo(b.x - ux * head - -uy * head * 0.45, b.y - uy * head - ux * head * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (opts.label) {
      // Sit the label beside the midpoint, offset perpendicular to the shaft so it
      // never lies along the line it is naming.
      const mx = (a.x + b.x) / 2 - uy * (opts.labelOffset ?? 14);
      const my = (a.y + b.y) / 2 + ux * (opts.labelOffset ?? 14);
      this.text(opts.label, mx, my, {
        colour,
        size: opts.labelSize ?? 14,
        align: 'center',
        baseline: 'middle',
        weight: 700,
        halo: true,
      });
    }
  }

  /** A rigid body, drawn according to its shape. */
  body(b, opts = {}) {
    const fill = opts.fill ?? b.colour ?? (b.isStatic ? C.ground : C.body);
    const stroke = opts.stroke ?? (b.isStatic ? C.groundEdge : C.bodyStroke);
    const width = opts.width ?? 2;

    if (b.shape === SHAPE.CIRCLE) {
      this.circle(b.pos, b.radius, { fill, stroke, width });
      // A spoke, so spin is visible on a plain disc.
      if (opts.spoke !== false && !b.isStatic) {
        const tip = b.pos.add(Vec2.fromAngle(b.angle, b.radius * 0.82));
        this.path([b.pos, tip], { stroke: alpha(stroke, 0.85), width: 2 });
      }
    } else {
      this.poly(b.worldVerts(), { fill, stroke, width });
    }
  }

  /** A small filled dot, in pixels, for contact points and markers. */
  dot(worldPos, rPx = 4, colour = C.text) {
    const { ctx } = this;
    const s = this.toScreen(worldPos);
    ctx.beginPath();
    ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  /** A ring marker, used for targets and goals. */
  ring(worldPos, radiusWorld, colour, opts = {}) {
    const { ctx } = this;
    const s = this.toScreen(worldPos);
    const r = this.px(radiusWorld);
    ctx.save();
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.strokeStyle = colour;
    ctx.lineWidth = opts.width ?? 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Right-angle tick, for showing that two components meet squarely. */
  rightAngle(cornerWorld, dirA, dirB, sizePx = 12, colour = C.textDim) {
    const { ctx } = this;
    const c = this.toScreen(cornerWorld);
    const a = dirA.norm();
    const b = dirB.norm();
    // Screen y is flipped relative to world y.
    const sa = { x: a.x, y: -a.y };
    const sb = { x: b.x, y: -b.y };
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x + sa.x * sizePx, c.y + sa.y * sizePx);
    ctx.lineTo(c.x + (sa.x + sb.x) * sizePx, c.y + (sa.y + sb.y) * sizePx);
    ctx.lineTo(c.x + sb.x * sizePx, c.y + sb.y * sizePx);
    ctx.stroke();
  }

  /** An arc showing an angle at a vertex, with an optional label. */
  angleArc(vertexWorld, fromAngle, toAngle, radiusPx, colour, label = null) {
    const { ctx } = this;
    const s = this.toScreen(vertexWorld);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Negated because screen angles run clockwise.
    ctx.arc(s.x, s.y, radiusPx, -fromAngle, -toAngle, fromAngle < toAngle);
    ctx.stroke();

    if (label) {
      const mid = (fromAngle + toAngle) / 2;
      this.text(label, s.x + Math.cos(mid) * (radiusPx + 16),
        s.y - Math.sin(mid) * (radiusPx + 16), {
          colour, size: 14, align: 'center', baseline: 'middle', weight: 700, halo: true,
        });
    }
  }

  // --- screen-space text -------------------------------------------------------

  /**
   * @param opts.halo draws a dark outline behind the glyphs so labels stay legible
   *                  when they cross a bright body. Cheaper and sharper than a shadow.
   */
  text(str, x, y, opts = {}) {
    const { ctx } = this;
    const size = opts.size ?? 15;
    const weight = opts.weight ?? 500;
    ctx.font = `${weight} ${size}px ${opts.mono
      ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
      : 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif'}`;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = opts.baseline ?? 'alphabetic';

    if (opts.halo) {
      ctx.lineWidth = opts.haloWidth ?? 4;
      ctx.strokeStyle = opts.haloColour ?? 'rgba(8, 11, 20, 0.88)';
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = opts.colour ?? C.text;
    ctx.fillText(str, x, y);
  }

  /** Text positioned by a world point, with a pixel offset. */
  worldText(str, worldPos, opts = {}) {
    const s = this.toScreen(worldPos);
    this.text(str, s.x + (opts.dx ?? 0), s.y + (opts.dy ?? 0), opts);
  }

  measure(str, size = 15, weight = 500, mono = false) {
    this.ctx.font = `${weight} ${size}px ${mono
      ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
      : 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif'}`;
    return this.ctx.measureText(str).width;
  }

  /** Rounded rectangle in screen pixels — panels, chips, bars. */
  roundRect(x, y, w, h, r, opts = {}) {
    const { ctx } = this;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    if (opts.fill) {
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.width ?? 1.5;
      ctx.stroke();
    }
  }

  /** A horizontal meter, used for energy and the slip bars. */
  bar(x, y, w, h, fraction, colour, opts = {}) {
    this.roundRect(x, y, w, h, h / 2, { fill: opts.track ?? 'rgba(255,255,255,0.08)' });
    const f = Math.max(0, Math.min(1, fraction));
    if (f > 0.001) {
      this.roundRect(x, y, Math.max(w * f, h * 0.6), h, h / 2, { fill: colour });
    }
    if (opts.marker !== undefined) {
      const { ctx } = this;
      const mx = x + w * Math.max(0, Math.min(1, opts.marker));
      ctx.strokeStyle = opts.markerColour ?? C.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx, y - 3);
      ctx.lineTo(mx, y + h + 3);
      ctx.stroke();
    }
  }
}
