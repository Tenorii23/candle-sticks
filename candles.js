  let boostInProgress = false;
let boostCandlesLeft = 0;
let boostPerCandle = 0;
let bearishInProgress = false;
let bearishCandlesLeft = 0;
let bearishPerCandle = 0;


/* ======================
   Enhanced Candlestick Trading Simulator
   ====================== */

/* ---------- Config & State ---------- */
const chartCanvas = document.getElementById('chartCanvas');
const overlay = document.getElementById('overlay');
const miniCanvas = document.getElementById('mini');
const ctx = chartCanvas.getContext('2d');
const octx = overlay.getContext('2d');
const mctx = miniCanvas.getContext('2d');

let DPR = window.devicePixelRatio || 1;

let state = {
    position: null, // For long positions
  shortPosition: null, 
  candles: [],         // array of {open,high,low,close,ts}
  candleWidth: 20,
  gap: 2,
  volatility: 0.003,
  speed: 200,
  seedPrice: 3.3075,
  zoomY: 1,
  offsetX: 0,
  offsetY: 0,
  autoFollow: true,
  running: false,
  intervalId: null,
  lastMouse: {x:0,y:0},
  isPanning: false,
  hoverIndex: -1,
  showSMA: true,
  showSMA50: false,
  trades: [],
  balance: 1000,
  autoGenerate: false,
  marketCapSupply: 19000000, // used to compute market cap scale (price * supply)
  indicators: {
    sma20: [],
    sma50: [],
    rsi: [],
    macd: {macd: [], signal: [], histogram: []}
  },
  sessionStart: Date.now(),
  tradeAmount: 100
};

/* ---------- Utilities ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return Date.now(); }
function formatPrice(p) { return Number(p).toFixed(4); }
function setEl(id, v) { 
  const el = document.getElementById(id);
  if (el) el.textContent = v; 
}

// Format market cap numbers with suffixes
function formatNumberShort(num) {
  const sign = num < 0 ? '-' : '';
  const n = Math.abs(num);
  if (n >= 1e12) return sign + (n/1e12).toFixed(2) + 'T';
  if (n >= 1e9) return sign + (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return sign + (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return sign + (n/1e3).toFixed(2) + 'K';
  return sign + n.toFixed(2);
}

// Compute nice tick step for a range
function computeNiceStep(range, targetTicks) {
  const rough = range / targetTicks;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * pow10);
  // pick closest to rough
  let best = candidates[0];
  let bestDiff = Math.abs(candidates[0] - rough);
  for (let i=1;i<candidates.length;i++) {
    const d = Math.abs(candidates[i] - rough);
    if (d < bestDiff) { best = candidates[i]; bestDiff = d; }
  }
  return best;
}

function getVisiblePriceStats() {
  const vis = getVisibleIndices();
  const visibleCandles = state.candles.slice(vis.start, vis.end+1);
  if (visibleCandles.length === 0) return null;
  const prices = visibleCandles.flatMap(c=>[c.high,c.low,c.open,c.close]);
  let maxP = Math.max(...prices);
  let minP = Math.min(...prices);
  const pad = (maxP - minP) * 0.12 || 1;
  maxP += pad;
  minP -= pad;
  const range = (maxP - minP) / state.zoomY;
  const scaleY = (chartCanvas.height / DPR - 40) / range;
  return {vis, minP, maxP, range, scaleY};
}

/* Format time */
function formatTime(ts) {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

/* Update time display */
function updateTime() {
  document.getElementById('currentTime').textContent = formatTime(Date.now());
}

/* ---------- Canvas resize ---------- */
function resizeCanvases() {
  const wrap = document.getElementById('canvasWrap');
  if (!wrap) return;
  
  chartCanvas.width = Math.floor(wrap.clientWidth * DPR);
  chartCanvas.height = Math.floor(wrap.clientHeight * DPR);
  chartCanvas.style.width = wrap.clientWidth + 'px';
  chartCanvas.style.height = wrap.clientHeight + 'px';

  overlay.width = chartCanvas.width;
  overlay.height = chartCanvas.height;
  overlay.style.width = chartCanvas.style.width;
  overlay.style.height = chartCanvas.style.height;

  const minimap = document.getElementById('minimap');
  if (minimap) {
    miniCanvas.width = Math.floor((minimap.clientWidth - 12) * DPR);
    miniCanvas.height = Math.floor((minimap.clientHeight - 12) * DPR);
    miniCanvas.style.width = (minimap.clientWidth - 12) + 'px';
    miniCanvas.style.height = (minimap.clientHeight - 12) + 'px';
  }

  drawAll();
}

/* ---------- Seed / Reset ---------- */
function resetState() {
  state.candles = [];
  state.offsetX = 0;
  state.offsetY = 0;
  state.zoomY = 1;
  state.trades = [];
  state.balance = 1000;
  state.position = null;
  state.autoGenerate = false;
  state.running = false;
  state.sessionStart = Date.now();
  
  if (state.intervalId) { 
    clearInterval(state.intervalId); 
    state.intervalId = null; 
  }
  
  // Seed first candle using given seedPrice
  const seedInput = document.getElementById('seedPrice');
  const s = seedInput ? Number(seedInput.value) || state.seedPrice : state.seedPrice;
  state.seedPrice = s;
  const open = s;
  const close = s - (Math.random()-0.5)*0.02*s;
  const high = Math.max(open,close) + Math.random()*0.01*s;
  const low = Math.min(open,close) - Math.random()*0.01*s;
  state.candles.push({open,high,low,close,ts: now()});
  
  updateUI();
  refreshTradesTable();
  drawAll();
}

/* ---------- Indicator: SMA ---------- */
function simpleSMA(arr, period) {
  if (arr.length < period) return [];
  const res = [];
  let sum = 0;
  for (let i=0; i<arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i-period];
    if (i >= period-1) res.push(sum/period);
    else res.push(null);
  }
  return res;
}

/* ---------- Candle Generator (realistic trend) ---------- */
let trendState = {direction:0, momentum:0, counter:0};

function nextTrendDirection(vol) {
  if (trendState.counter <= 0) {
    const r = Math.random();
    if (r < 0.35) trendState.direction = 1;
    else if (r < 0.7) trendState.direction = -1;
    else trendState.direction = 0;
    trendState.momentum = Math.random() * 0.7 + 0.3;
    trendState.counter = Math.floor(5 + Math.random()*8);
  }
  trendState.counter--;
  if (Math.random() < 0.06) trendState.direction = 0;
  return trendState.direction;
}
function generateCandleOnce() {
    if (state.candles.length === 0) return;

    const last = state.candles[state.candles.length - 1];
    const vol = state.volatility;
    const dir = nextTrendDirection(vol);

    let magnitude = (Math.random() * vol) * (dir === 0 ? 0.5 : (0.8 + trendState.momentum));
    if (Math.random() < 0.12) magnitude *= -0.5;

    let open = last.close;
    let close = open * (1 + (Math.random() - 0.5) * vol * 5 + dir * magnitude);

    // Apply boost if in progress
    if (boostInProgress && boostCandlesLeft > 0) {
        if (Math.random() < 0.2) {
            // Occasionally create a short candle that goes against the trend
            close -= boostPerCandle * 2;
        } else {
            close += boostPerCandle;
        }
        boostCandlesLeft--;
        if (boostCandlesLeft === 0) {
            boostInProgress = false;
        }
    }

    // Apply bearish if in progress
    if (bearishInProgress && bearishCandlesLeft > 0) {
        if (Math.random() < 0.2) {
            // Occasionally create a short candle that goes against the trend
            close += bearishPerCandle * 2;
        } else {
            close -= bearishPerCandle;
        }
        bearishCandlesLeft--;
        if (bearishCandlesLeft === 0) {
            bearishInProgress = false;
        }
    }

    if (close <= 0) close = open * (1 + (Math.random() - 0.5) * 0.001);
    const high = Math.max(open, close) * (1 + Math.random() * vol * 2);
    const low = Math.min(open, close) * (1 - Math.random() * vol * 2);
    const ts = now();
    state.candles.push({ open, high, low, close, ts });

    // Auto-follow camera
    if (state.autoFollow) {
        const totalWidth = state.candles.length * (state.candleWidth + state.gap);
        const viewWidth = chartCanvas.width / DPR;
        state.offsetX = Math.max(0, totalWidth - viewWidth + 20);
    }
}


/* ---------- Drawing ---------- */
function drawCandles() {
  ctx.save();
  ctx.clearRect(0,0,chartCanvas.width,chartCanvas.height);
  
  const vis = getVisibleIndices();
  const visibleCandles = state.candles.slice(vis.start, vis.end+1);
  if (visibleCandles.length === 0) { 
    ctx.restore(); 
    return; 
  }

  const prices = visibleCandles.flatMap(c=>[c.high,c.low,c.open,c.close]);
  let maxP = Math.max(...prices);
  let minP = Math.min(...prices);
  
  const pad = (maxP - minP) * 0.12 || 1;
  maxP += pad; 
  minP -= pad;

  const range = (maxP - minP) / state.zoomY;
  const scaleY = (chartCanvas.height / DPR - 40) / range;

  const cw = state.candleWidth;
  const step = cw + state.gap;
  
  for (let i=vis.start; i<=vis.end; i++) {
    const c = state.candles[i];
    const x = i * step - state.offsetX;
    const xR = Math.round(x * DPR);
    const yOpen = Math.round((maxP - c.open) * scaleY + 20 + state.offsetY);
    const yClose = Math.round((maxP - c.close) * scaleY + 20 + state.offsetY);
    const yHigh = Math.round((maxP - c.high) * scaleY + 20 + state.offsetY);
    const yLow = Math.round((maxP - c.low) * scaleY + 20 + state.offsetY);

    if (x + cw < 0 || x > chartCanvas.width / DPR) continue;

    // Wick
    ctx.beginPath();
    ctx.strokeStyle = c.close >= c.open ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
    ctx.lineWidth = Math.max(1, DPR * 1);
    ctx.moveTo((x + cw/2)*DPR + 0.5, yHigh*DPR + 0.5);
    ctx.lineTo((x + cw/2)*DPR + 0.5, yLow*DPR + 0.5);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(yOpen,yClose) * DPR;
    const bodyH = Math.max(1, Math.abs(yOpen - yClose) * DPR);
    ctx.fillStyle = c.close >= c.open ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
    ctx.fillRect(Math.round(x*DPR)+0.5, Math.round(bodyTop)+0.5, Math.round(cw*DPR), Math.round(bodyH));
    
    // Outline
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.strokeRect(Math.round(x*DPR)+0.5, Math.round(bodyTop)+0.5, Math.round(cw*DPR), Math.round(bodyH));
  }

  ctx.restore();

  // Update UI numbers
  setEl('totalCandles', state.candles.length);
  const last = state.candles[state.candles.length-1];
  if (last) setEl('uiPrice', formatPrice(last.close));
}

/* ---------- Overlay: crosshair, tooltip ---------- */
function drawOverlay() {
  octx.clearRect(0,0,overlay.width,overlay.height);
  // Draw axes & grid first
  drawAxesAndGrid();
  
  if (state.hoverIndex >=0 && state.hoverIndex < state.candles.length) {
    const i = state.hoverIndex;
    const cw = state.candleWidth;
    const step = cw + state.gap;
    const x = i * step - state.offsetX;
    
    // Vertical line
    octx.strokeStyle = 'rgba(255,255,255,0.12)';
    octx.beginPath();
    octx.moveTo((x+cw/2)*DPR, 0);
    octx.lineTo((x+cw/2)*DPR, overlay.height);
    octx.stroke();
    
    // Tooltip
    const c = state.candles[i];
    const txt = `O:${formatPrice(c.open)} H:${formatPrice(c.high)} L:${formatPrice(c.low)} C:${formatPrice(c.close)}`;
    
    octx.fillStyle = 'rgba(10,10,10,0.8)';
    const width = Math.max(txt.length * 8 * DPR, 150);
    octx.fillRect(8*DPR, 8*DPR, width, 20*DPR);
    
    octx.fillStyle = '#fff';
    octx.textBaseline='top';
    octx.font = `${12*DPR}px monospace`;
    octx.fillText(txt, 10*DPR, 10*DPR);
  }
}

// Draw right-side price scale and left-side market cap scale + horizontal grid lines
function drawAxesAndGrid() {
  const stats = getVisiblePriceStats();
  if (!stats) return;
  const { minP, maxP, range } = stats;
  const padLeft = 6*DPR;   // extra padding inside overlay
  const padRight = 56*DPR; // space for price labels
  const padLeftScale = 68*DPR; // space for market cap labels
  const w = overlay.width;
  const h = overlay.height;

  // Background strips for scales
  octx.fillStyle = 'rgba(0,0,0,0.35)';
  octx.fillRect(0, 0, padLeftScale, h);
  octx.fillRect(w - padRight, 0, padRight, h);

  // Compute ticks
  const targetTicks = 6;
  const step = computeNiceStep(range, targetTicks);
  const firstTick = Math.ceil(minP / step) * step;

  // Draw grid lines + labels
  octx.font = `${12*DPR}px monospace`;
  octx.textBaseline = 'middle';
  for (let p = firstTick; p <= maxP; p += step) {
    // Y from price p
    const y = ((maxP - p) / range) * (h / DPR - 40) + 20 + state.offsetY;
    const yPx = Math.round(y * DPR) + 0.5;

    // grid line
    octx.strokeStyle = 'rgba(255,255,255,0.06)';
    octx.beginPath();
    octx.moveTo(padLeftScale, yPx);
    octx.lineTo(w - padRight, yPx);
    octx.stroke();

    // right price label
    octx.fillStyle = '#e5e7eb';
    const priceText = formatPrice(p);
    octx.fillText(priceText, w - padRight + 6*DPR, yPx);

    // left market cap label
    const marketCap = p * state.marketCapSupply;
    const mcText = formatNumberShort(marketCap);
    octx.fillText(mcText, 6*DPR, yPx);
  }
}

/* ---------- Mini map ---------- */
function drawMini() {
  mctx.clearRect(0,0,miniCanvas.width,miniCanvas.height);
  const w = miniCanvas.width, h = miniCanvas.height;
  const arr = state.candles;
  if (!arr.length) return;
  
  const maxP = Math.max(...arr.map(c=>c.high));
  const minP = Math.min(...arr.map(c=>c.low));
  const range = maxP - minP || 1;
  const step = Math.max(1, Math.floor(w / arr.length));
  
  for (let i=0; i<arr.length; i++) {
    const c = arr[i];
    const x = i * step;
    const yH = (1 - (c.high - minP) / range) * h;
    const yL = (1 - (c.low - minP) / range) * h;
    mctx.strokeStyle = c.close >= c.open ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)';
    mctx.beginPath();
    mctx.moveTo(x, yH);
    mctx.lineTo(x, yL);
    mctx.stroke();
  }
  
  // View window rectangle
  const viewW = (chartCanvas.width / DPR) / ( (state.candles.length*(state.candleWidth+state.gap)) / (w) );
  const viewX = (state.offsetX / (state.candles.length*(state.candleWidth+state.gap))) * w;
  mctx.strokeStyle = 'rgba(255,255,255,0.4)';
  mctx.strokeRect(viewX,0,viewW,h);
}

/* ---------- Helpers: visible indices ---------- */
function getVisibleIndices() {
  const cw = state.candleWidth + state.gap;
  const start = Math.floor(state.offsetX / cw);
  const count = Math.ceil((chartCanvas.width / DPR) / cw) + 2;
  const end = Math.min(state.candles.length-1, start + count);
  return {
    start: clamp(start,0,state.candles.length-1), 
    end, 
    count
  };
}

/* ---------- Trades & UI ---------- */
function buy() {
  if (state.position) {
    alert('Already in position');
    return;
  }
  
  const last = state.candles[state.candles.length-1];
  if (!last) return;
  
  const amount = state.tradeAmount;
  const qty = amount / last.close;
  
  if (amount > state.balance) {
    alert('Insufficient balance');
    return;
  }
  
  state.position = {price: last.close, qty, ts: now()};
  state.balance = state.balance - amount;
  state.trades.push({
    type: 'buy', 
    price: last.close, 
    qty, 
    pnl: null, 
    entry: last.close, 
    ts: now()
  });
  
  updateUI();
  refreshTradesTable();
}

function sell() {
  const last = state.candles[state.candles.length-1];
  if (!last) return;

  // If we have a long, sell closes the long
  if (state.position) {
    const pnl = (last.close - state.position.price) * state.position.qty;
    const entryPrice = state.position.price;
    const qty = state.position.qty;
    state.balance = state.balance + state.position.qty * last.close;
    state.trades.push({ type: 'sell', price: last.close, qty, pnl, entry: entryPrice, ts: now() });
    state.position = null;
    updateUI();
    refreshTradesTable();
    return;
  }

  // If no long but we have a short, sell acts as cover to close the short
  if (state.shortPosition) {
    const qty = state.shortPosition.qty;
    const entryPrice = state.shortPosition.price;
    const pnl = (entryPrice - last.close) * qty;
    state.balance -= qty * last.close;
    // Log as SELL to match existing UI badges
    state.trades.push({ type: 'sell', price: last.close, qty, pnl, entry: entryPrice, ts: now() });
    state.shortPosition = null;
    updateUI();
    refreshTradesTable();
    return;
  }

  alert('No position');
}

/* ---------- UI updates ---------- */
function updateUI() {
  setEl('uiBalance', state.balance.toFixed(2));

  let equity = state.balance;

  // Calculate equity for long positions
  if (state.position) {
    const lastPrice = state.candles[state.candles.length - 1].close;
    equity += state.position.qty * lastPrice;
  }

  // Calculate equity for short positions
  if (state.shortPosition) {
    const lastPrice = state.candles[state.candles.length - 1].close;
    equity -= state.shortPosition.qty * lastPrice; // Subtract because it's a liability
  }

  setEl('uiEquity', equity.toFixed(2));

  const sessionName = document.getElementById('sessionName');
  if (sessionName) {
    setEl('sessionLabel', sessionName.value || 'New Session');
  }

  setEl('autoFollowState', state.autoFollow ? 'ON' : 'OFF');
  setEl('windowInfo', `${getVisibleIndices().count}`);

  const lastCandle = state.candles[state.candles.length - 1];
  setEl('uiPrice', lastCandle ? formatPrice(lastCandle.close) : '0.00');

  // Update slider values
  setEl('volValue', state.volatility.toFixed(4));
  setEl('widthValue', state.candleWidth);
  setEl('gapValue', state.gap);
  setEl('speedValue', state.speed);

  // Update time
  updateTime();

  // Orders tab position box (single panel)
  const box = document.querySelector('#ordersTab .position-indicator .value');
  const uplEl = document.querySelector('#ordersTab .position-indicator .pl .value-change');
  const last = state.candles[state.candles.length - 1];
  const lastPrice = last ? last.close : 0;
  if (box && uplEl) {
    if (state.position) {
      box.textContent = `${state.position.qty.toFixed(4)} BTC`;
      const upl = (lastPrice - state.position.price) * state.position.qty;
      uplEl.textContent = `${upl >= 0 ? '+' : ''}$${upl.toFixed(2)}`;
      uplEl.classList.toggle('positive', upl >= 0);
      uplEl.classList.toggle('negative', upl < 0);
    } else if (state.shortPosition) {
      box.textContent = `${state.shortPosition.qty.toFixed(4)} BTC (SHORT)`;
      const upl = (state.shortPosition.price - lastPrice) * state.shortPosition.qty;
      uplEl.textContent = `${upl >= 0 ? '+' : ''}$${upl.toFixed(2)}`;
      uplEl.classList.toggle('positive', upl >= 0);
      uplEl.classList.toggle('negative', upl < 0);
    } else {
      box.textContent = '0.00 BTC';
      uplEl.textContent = '+$0.00';
      uplEl.classList.add('positive');
      uplEl.classList.remove('negative');
    }
  }
}

/* ---------- Trades table ---------- */
function refreshTradesTable() {
  const tbody = document.querySelector('#tradeTable tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // Show last 10 trades
  const tradesToShow = state.trades.slice(-10).reverse();
  
  for (const t of tradesToShow) {
    const tr = document.createElement('tr');
    
    const typeBadge = document.createElement('span');
    typeBadge.className = `badge ${t.type}`;
    typeBadge.textContent = t.type.toUpperCase();
    
    const typeCell = document.createElement('td');
    typeCell.appendChild(typeBadge);
    
    const pnlCell = document.createElement('td');
    if (t.pnl !== null) {
      pnlCell.className = `value-change ${t.pnl >= 0 ? 'positive' : 'negative'}`;
      pnlCell.textContent = `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`;
    } else {
      pnlCell.textContent = '—';
    }
    
    tr.appendChild(typeCell);
    tr.appendChild(createTd(formatPrice(t.price)));
    tr.appendChild(createTd(t.qty.toFixed(4)));
    tr.appendChild(pnlCell);
    
    tbody.appendChild(tr);
  }
}

function createTd(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

/* ---------- Auto generation / controls ---------- */
function startAuto() {
  if (state.intervalId) clearInterval(state.intervalId);
  
  state.intervalId = setInterval(() => {
    generateCandleOnce();
    drawAll();
  }, state.speed);
  
  state.running = true;
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnStop').disabled = false;
}

function stopAuto() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  
  state.running = false;
  document.getElementById('btnStart').disabled = false;
  document.getElementById('btnStop').disabled = true;
}

/* ---------- Full draw orchestration ---------- */
function drawAll() {
  if (!chartCanvas || !overlay) return;
  
  // Scale canvases for DPR
  chartCanvas.style.width = chartCanvas.clientWidth + 'px';
  chartCanvas.style.height = chartCanvas.clientHeight + 'px';
  
  ctx.save();
  ctx.setTransform(DPR,0,0,DPR,0,0);
  drawCandles();
  ctx.restore();

  // Overlay draws
  drawOverlay();
  drawMini();
  updateUI();
}

/* ---------- Event wiring ---------- */
function setupEventListeners() {
  // Reset button
  document.getElementById('btnReset').addEventListener('click', () => { 
    resetState(); 
  });
  
  // Auto-follow toggle (robust label update)
  document.getElementById('btnAutoFollow').addEventListener('click', () => {
    state.autoFollow = !state.autoFollow;
    setEl('autoFollowState', state.autoFollow ? 'ON' : 'OFF');
  });
  
  // Sliders
  document.getElementById('volSlider').addEventListener('input', (e) => {
    state.volatility = Number(e.target.value);
  });
  
  document.getElementById('widthSlider').addEventListener('input', (e) => {
    state.candleWidth = Number(e.target.value);
  });
  
  document.getElementById('gapSlider').addEventListener('input', (e) => {
    state.gap = Number(e.target.value);
  });
  
  document.getElementById('speedSlider').addEventListener('input', (e) => {
    state.speed = Number(e.target.value);
    if (state.running) { 
      stopAuto(); 
      startAuto(); 
    }
  });
document.getElementById('btnBoost').addEventListener('click', () => {
    const numberOfCandles = 7;
    const totalBoost = (Math.random() * 0.25 + 0.25).toFixed(2);
    boostPerCandle = parseFloat(totalBoost) / numberOfCandles;
    boostCandlesLeft = numberOfCandles;
    boostInProgress = true;

    console.log(`Starting gradual price boost over ${numberOfCandles} candles, total boost: $${totalBoost}`);
});

document.getElementById('btnBearish').addEventListener('click', () => {
    const numberOfCandles = 7;
    const totalBearish = (Math.random() * 0.25 + 0.25).toFixed(2);
    bearishPerCandle = parseFloat(totalBearish) / numberOfCandles;
    bearishCandlesLeft = numberOfCandles;
    bearishInProgress = true;

    console.log(`Starting gradual bearish trend over ${numberOfCandles} candles, total bearish: $${totalBearish}`);
});

document.getElementById('btnShort').addEventListener('click', () => {
    const last = state.candles[state.candles.length - 1];
    if (!last) {
        alert('No market data available');
        return;
    }

    if (state.position) {
        alert('Close long before opening a short');
        return;
    }

    if (state.shortPosition) {
        alert('Already in short position');
        return;
    }

    const amount = state.tradeAmount;
    const qty = amount / last.close;

    if (amount > state.balance) {
        alert('Insufficient balance');
        return;
    }

    // Record the short position
    state.shortPosition = { price: last.close, qty: qty, ts: now() };
    state.balance += amount; // Increase balance by the sale amount
    state.trades.push({
        type: 'short',
        price: last.close,
        qty: qty,
        pnl: null,
        entry: last.close,
        ts: now()
    });

    updateUI();
    refreshTradesTable();
});
  
  // Seed price
  document.getElementById('seedPrice').addEventListener('change', (e) => {
    state.seedPrice = Number(e.target.value);
  });
  
  // Start/stop buttons
  document.getElementById('btnStart').addEventListener('click', () => startAuto());
  document.getElementById('btnStop').addEventListener('click', () => stopAuto());
  
  // Trade buttons
  document.getElementById('btnBuy').addEventListener('click', buy);
  document.getElementById('btnSell').addEventListener('click', sell);
  
  // Trade amount
  document.getElementById('tradeAmount').addEventListener('change', (e) => {
    state.tradeAmount = Number(e.target.value);
  });
  
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and content
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab') + 'Tab';
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Timeframe selector
  const timeframeConfig = {
    '1M': { speed: 200, width: 20, gap: 2 },
    '5M': { speed: 300, width: 18, gap: 2 },
    '15M': { speed: 450, width: 16, gap: 2 },
    '1H': { speed: 650, width: 14, gap: 2 },
    '4H': { speed: 900, width: 12, gap: 2 }
  };
  document.querySelectorAll('.timeframe').forEach(tf => {
    tf.addEventListener('click', () => {
      document.querySelectorAll('.timeframe').forEach(el => el.classList.remove('active'));
      tf.classList.add('active');
      const label = tf.textContent.trim();
      const cfg = timeframeConfig[label] || timeframeConfig['1M'];
      state.speed = cfg.speed;
      state.candleWidth = cfg.width;
      state.gap = cfg.gap;

      // sync sliders
      document.getElementById('speedSlider').value = state.speed;
      document.getElementById('widthSlider').value = state.candleWidth;
      document.getElementById('gapSlider').value = state.gap;

      if (state.running) { 
        stopAuto();
        startAuto();
      }
      drawAll();
    });
  });
  
  // Canvas interaction
  overlay.addEventListener('mousedown', (e) => {
    state.isPanning = true; 
    state.lastMouse.x = e.clientX; 
    state.lastMouse.y = e.clientY;
    // disable auto-follow when user pans
    state.autoFollow = false;
    setEl('autoFollowState', 'OFF');
  });
  
  overlay.addEventListener('mouseup', () => { 
    state.isPanning = false; 
  });
  
  overlay.addEventListener('mouseleave', () => { 
    state.isPanning = false; 
    state.hoverIndex = -1; 
    drawOverlay(); 
  });
  
  overlay.addEventListener('mousemove', (e) => {
    const rect = overlay.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / (rect.width) * (chartCanvas.width / DPR);
    const prevMouse = { x: state.lastMouse.x, y: state.lastMouse.y };
    state.lastMouse = {x: e.clientX, y: e.clientY};
    
    // Compute hover index
    const cw = state.candleWidth + state.gap;
    const idx = Math.floor((state.offsetX + mx) / cw);
    state.hoverIndex = clamp(idx,0,state.candles.length-1);
    
    if (state.isPanning) {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      state.offsetX = clamp(
        state.offsetX - dx,
        0,
        Math.max(0, state.candles.length*(state.candleWidth+state.gap) - (chartCanvas.width / DPR))
      );
      state.offsetY = clamp(state.offsetY - dy, -1000, 1000);
      drawAll();
    } else {
      drawOverlay();
    }
  });
  
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (e.ctrlKey) {
      const prev = state.zoomY;
      state.zoomY *= e.deltaY < 0 ? 1.08 : 0.92;
      state.zoomY = clamp(state.zoomY, 0.3, 5);
      
      const rect = overlay.getBoundingClientRect();
      const my = e.clientY - rect.top;
      state.offsetY = (state.offsetY + my) * (state.zoomY / prev) - my;
      drawAll();
    } else {
      // horizontal scroll
      state.offsetX = clamp(
        state.offsetX + (e.deltaY > 0 ? 40 : -40),
        0,
        Math.max(0, state.candles.length*(state.candleWidth+state.gap) - (chartCanvas.width / DPR))
      );
      // user-controlled scroll disables auto-follow
      state.autoFollow = false;
      setEl('autoFollowState', 'OFF');
      drawAll();
    }
  }, {passive:false});
  
  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (!state.autoGenerate) {
        state.autoGenerate = true;
        state.candleInterval = setInterval(() => { 
          generateCandleOnce(); 
          drawAll(); 
        }, state.speed);
      }
    } else if (e.key.toLowerCase() === 'b') { 
      buy(); 
    } else if (e.key.toLowerCase() === 's') { 
      sell(); 
    } else if (e.key === 'ArrowLeft') { 
      state.offsetX = clamp(state.offsetX - 40, 0, 999999); 
      drawAll(); 
    } else if (e.key === 'ArrowRight') { 
      state.offsetX = clamp(state.offsetX + 40, 0, 999999); 
      drawAll(); 
    } else if (e.key === 'ArrowUp') { 
      state.offsetY -= 40; 
      drawAll(); 
    } else if (e.key === 'ArrowDown') { 
      state.offsetY += 40; 
      drawAll(); 
    }
  });
  
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.autoGenerate = false;
      if (state.candleInterval) { 
        clearInterval(state.candleInterval); 
        state.candleInterval = null; 
      }
    }
  });
  
  // Save/Load
  document.getElementById('btnSave').addEventListener('click', () => {
    const name = document.getElementById('sessionName').value || 'session';
    const data = JSON.stringify({
      candles: state.candles,
      settings: {
        candleWidth: state.candleWidth,
        gap: state.gap,
        volatility: state.volatility,
        zoomY: state.zoomY
      },
      balance: state.balance,
      trades: state.trades
    });
    localStorage.setItem('sim:' + name, data);
    alert('Saved as ' + name);
  });
  
  document.getElementById('btnLoad').addEventListener('click', () => {
    const name = document.getElementById('sessionName').value || 'session';
    const raw = localStorage.getItem('sim:' + name);
    if (!raw) return alert('No session found: ' + name);
    
    try {
      const obj = JSON.parse(raw);
      state.candles = obj.candles || [];
      state.candleWidth = obj.settings?.candleWidth || state.candleWidth;
      state.gap = obj.settings?.gap || state.gap;
      state.volatility = obj.settings?.volatility || state.volatility;
      state.balance = obj.balance || state.balance;
      state.trades = obj.trades || [];
      refreshTradesTable();
      drawAll();
      alert('Loaded ' + name);
    } catch(err) { 
      alert('Load failed: ' + err.message); 
    }
  });
  
  document.getElementById('btnClearStorage').addEventListener('click', () => {
    if (confirm('Clear all saved sessions?')) {
      Object.keys(localStorage).forEach(k => { 
        if (k.startsWith('sim:')) localStorage.removeItem(k); 
      });
      alert('Cleared');
    }
  });
  
  // CSV export/import
  document.getElementById('btnExportCSV').addEventListener('click', () => {
    const rows = ['ts,open,high,low,close'];
    for (const c of state.candles) rows.push(`${c.ts},${c.open},${c.high},${c.low},${c.close}`);
    const blob = new Blob([rows.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = 'candles.csv'; 
    a.click();
    URL.revokeObjectURL(url);
  });
  
  document.getElementById('btnImportCSV').addEventListener('click', () => {
    const raw = document.getElementById('csvArea').value.trim();
    if (!raw) return alert('Paste CSV into the textarea first');
    
    try {
      const lines = raw.split('\n').filter(Boolean);
      const result = [];
      for (let i=1; i<lines.length; i++) {
        const [ts,open,high,low,close] = lines[i].split(',');
        result.push({
          ts: Number(ts), 
          open: Number(open), 
          high: Number(high), 
          low: Number(low), 
          close: Number(close)
        });
      }
      state.candles = result;
      drawAll();
      alert('Imported ' + result.length + ' candles');
    } catch(err) { 
      alert('Import failed: ' + err.message); 
    }
  });
  
  // Export CSV
  document.getElementById('btnExport').addEventListener('click', () => {
    const rows = ['ts,open,high,low,close'];
    for (const c of state.candles) rows.push(`${c.ts},${c.open},${c.high},${c.low},${c.close}`);
    const blob = new Blob([rows.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = 'candles_export.csv'; 
    a.click();
    URL.revokeObjectURL(url);
  });

  // Open Orders: Cancel buttons
  const ordersTab = document.getElementById('ordersTab');
  if (ordersTab) {
    ordersTab.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('button.danger');
      if (cancelBtn && cancelBtn.classList.contains('small')) {
        const row = cancelBtn.closest('.order-row');
        if (row) row.remove();
      }
    });
  }
}

/* ---------- Initialization ---------- */
function init() {
  // Initialize UI values
  document.getElementById('widthSlider').value = state.candleWidth;
  document.getElementById('gapSlider').value = state.gap;
  document.getElementById('volSlider').value = state.volatility;
  document.getElementById('speedSlider').value = state.speed;
  document.getElementById('seedPrice').value = state.seedPrice;
  
  // Setup tabs
  document.querySelectorAll('.tab').forEach((tab, index) => {
    tab.setAttribute('data-tab', tab.textContent.toLowerCase().replace(/\s/g, ''));
    if (index === 0) {
      document.getElementById(tab.getAttribute('data-tab') + 'Tab').classList.add('active');
    }
  });
  
  // Setup event listeners
  setupEventListeners();
  
  // Initialize state
  resetState();
  resizeCanvases();
  
  // Animation loop
  function loop() {
    requestAnimationFrame(loop);
    
    // Smooth auto-follow
    if (state.autoFollow && state.candles.length) {
      const totalW = state.candles.length * (state.candleWidth + state.gap);
      const target = Math.max(0, totalW - (chartCanvas.width/DPR) + 50);
      state.offsetX += (target - state.offsetX) * 0.12;

      // Vertical auto-follow: keep last price near an anchor while it moves
      const stats = getVisiblePriceStats();
      if (stats) {
        const last = state.candles[state.candles.length - 1];
        const canvasHeightPx = chartCanvas.height / DPR;
        const anchorY = canvasHeightPx * 0.4; // 40% from top
        const lastYNoOffset = (stats.maxP - last.close) * stats.scaleY + 20; // before offsetY applied
        const currentLastY = lastYNoOffset + state.offsetY;
        const edgeMargin = 60; // px
        if (currentLastY < edgeMargin || currentLastY > canvasHeightPx - edgeMargin) {
          const desiredOffsetY = anchorY - lastYNoOffset;
          state.offsetY += (desiredOffsetY - state.offsetY) * 0.12;
          state.offsetY = clamp(state.offsetY, -2000, 2000);
        }
      }
    }
    
    drawAll();
  }
  
  loop();
  
  // Update time every second
  setInterval(updateTime, 1000);
}

// Start the application
document.addEventListener('DOMContentLoaded', init);