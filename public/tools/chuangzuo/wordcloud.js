class WordCloud {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) throw new Error(`WordCloud: container #${containerId} not found`);

    // 可配置项
    this.maxFont = options.maxFont || 48;
    this.minFont = options.minFont || 14;
    this.height = options.height || 260;
    this.colors = options.colors || [
      '#4f8cff','#ff6b6b','#51cf66','#fcc419',
      '#cc5de8','#20c997','#ff922b','#339af0'
    ];
    this.onWordClick = options.onWordClick || null; // 点击回调

    this.canvas = null;
    this.ctx = null;
    this.words = [];
    this.hitAreas = [];
    this._resizeHandler = null;
    this._boundResize = this._onResize.bind(this);

    window.addEventListener('resize', this._boundResize);
  }

  destroy() {
    window.removeEventListener('resize', this._boundResize);
    if (this.canvas) {
      this.canvas.removeEventListener('click', this._onClick.bind(this));
    }
    this.container.innerHTML = '';
    this.canvas = null;
    this.ctx = null;
    this.words = [];
    this.hitAreas = [];
  }

  render(words) {
    this.words = words || [];
    this.hitAreas = [];
    this.container.innerHTML = '';

    if (this.words.length === 0) {
      this.container.innerHTML =
        '<div style="padding:20px;text-align:center;color:#999;">暂无数据</div>';
      return;
    }

    this._createCanvas();
    this._draw();
  }

  _createCanvas() {
    const W = this.container.clientWidth || window.innerWidth - 40;
    const isMobile = window.innerWidth < 768;
    const H = isMobile ? Math.min(this.height, window.innerWidth * 0.55) : this.height;
    const dpr = window.devicePixelRatio || 1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.style.maxWidth = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'pointer';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    this._W = W;
    this._H = H;

    this.canvas.addEventListener('click', this._onClick.bind(this));
  }

  _draw() {
    const ctx = this.ctx;
    const isMobile = window.innerWidth < 768;
    const maxFont = isMobile ? Math.min(this.maxFont, 28) : this.maxFont;
    const minFont = isMobile ? Math.min(this.minFont, 12) : this.minFont;

    const maxW = this.words[0].count;
    const minW = this.words[this.words.length - 1].count;

    const items = this.words.map(w => {
      const ratio = maxW === minW ? 1 : (w.count - minW) / (maxW - minW);
      const size = minFont + ratio * (maxFont - minFont);
      return { ...w, size };
    });

    const placed = [];
    this.hitAreas = [];

    for (const item of items) {
      ctx.font = `bold ${item.size}px system-ui, sans-serif`;
      const tw = ctx.measureText(item.word).width;
      const th = item.size * 1.2;
      const pos = this._findPos(tw, th, placed);
      if (!pos) continue;

      ctx.fillStyle = this.colors[Math.floor(Math.random() * this.colors.length)];
      ctx.fillText(item.word, pos.x, pos.y + item.size);

      placed.push({ x: pos.x, y: pos.y, w: tw, h: th });
      this.hitAreas.push({ x: pos.x, y: pos.y, w: tw, h: th, word: item.word });
    }
  }

  _findPos(tw, th, placed) {
    let angle = 0, radius = 0;
    const cx = this._W / 2, cy = this._H / 2;
    for (let i = 0; i < 800; i++) {
      const x = cx + Math.cos(angle) * radius - tw / 2;
      const y = cy + Math.sin(angle) * radius - th / 2;
      if (x >= 4 && x + tw <= this._W - 4 && y >= 4 && y + th <= this._H - 4) {
        if (!this._overlaps(x, y, tw, th, placed)) return { x, y };
      }
      angle += 0.4;
      radius += 3;
    }
    return null;
  }

  _overlaps(nx, ny, nw, nh, placed) {
    for (const p of placed) {
      const dx = (nx + nw / 2) - (p.x + p.w / 2);
      const dy = (ny + nh / 2) - (p.y + p.h / 2);
      if (Math.abs(dx) < (nw + p.w) / 2 * 0.85 &&
          Math.abs(dy) < (nh + p.h) / 2 * 0.85) return true;
    }
    return false;
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (const area of this.hitAreas) {
      if (mx >= area.x && mx <= area.x + area.w &&
          my >= area.y && my <= area.y + area.h) {
        if (this.onWordClick) {
          this.onWordClick(area.word);
        }
        break;
      }
    }
  }

  _onResize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      if (this.words.length > 0) this.render(this.words);
    }, 200);
  }
}
