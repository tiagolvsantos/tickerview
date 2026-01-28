const TICKER_REGEX = /\$([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\b/gi;
let hoverTimer;
let currentTicker = "";

// Create Modal Element
const modal = document.createElement('div');
modal.id = 'tickerview-modal';
modal.style.display = 'none';
document.body.appendChild(modal);

// Function to scan and highlight tickers
function scanAndHighlight(node) {
  // Guard: Don't scan the modal or anything inside it
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.id === 'tickerview-modal' || node.closest('#tickerview-modal')) return;
  } else if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentElement && node.parentElement.closest('#tickerview-modal')) return;
  }

  // Also skip if already highlighted
  if (node.classList && node.classList.contains('tickerview-highlight')) {
    return;
  }

  if (node.nodeType === Node.TEXT_NODE && node.parentElement && !['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName)) {
    const text = node.nodeValue;
    if (TICKER_REGEX.test(text)) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      TICKER_REGEX.lastIndex = 0;

      while ((match = TICKER_REGEX.exec(text)) !== null) {
        // Text before match
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));

        // The highlight span
        const span = document.createElement('span');
        span.className = 'tickerview-highlight';
        span.textContent = match[0];
        // Clean ticker but preserve dots for symbols like BRK.B
        const cleanTicker = match[1].replace(/[^a-zA-Z0-9.]/g, '').toUpperCase();

        span.dataset.ticker = cleanTicker;
        fragment.appendChild(span);

        lastIndex = TICKER_REGEX.lastIndex;
      }

      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.parentNode.replaceChild(fragment, node);
      TICKER_REGEX.lastIndex = 0; // Reset after use
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Clone children array to avoid modification issues during iteration
    const children = Array.from(node.childNodes);
    for (const child of children) {
      scanAndHighlight(child);
    }
  }
}

// Observe mutations to handle dynamically loaded content
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      scanAndHighlight(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan
scanAndHighlight(document.body);

let hideTimeout;

// Hover Event Handling
document.addEventListener('mouseover', (e) => {
  const target = e.target;
  if (target.classList.contains('tickerview-highlight')) {
    const ticker = target.dataset.ticker;
    const rect = target.getBoundingClientRect();

    clearTimeout(hideTimeout);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      showModal(ticker, rect);
    }, 300); // 300ms delay for better UX
  }
});

document.addEventListener('mouseout', (e) => {
  if (e.target.classList.contains('tickerview-highlight')) {
    clearTimeout(hoverTimer);
    hideTimeout = setTimeout(() => {
      if (!modal.matches(':hover')) {
        modal.style.display = 'none';
      }
    }, 400); // 400ms grace period to move to modal
  }
});

modal.addEventListener('mouseenter', () => {
  clearTimeout(hideTimeout);
});

modal.addEventListener('mouseleave', () => {
  hideTimeout = setTimeout(() => {
    modal.style.display = 'none';
  }, 200);
});

async function showModal(ticker, rect) {
  currentTicker = ticker;
  modal.innerHTML = `
    <div class="tv-loader">
      <div class="tv-spinner"></div>
      <span>Fetching ${ticker}...</span>
    </div>
  `;

  // Position the modal
  modal.style.display = 'block';

  const modalWidth = 320;
  const modalHeight = 250; // Estimated initially

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 10;

  // Check horizontal bounds
  if (left + modalWidth > window.innerWidth + window.scrollX - 20) {
    left = window.innerWidth + window.scrollX - modalWidth - 20;
  }

  // Check vertical bounds (show above ticker if no space below)
  if (rect.bottom + modalHeight > window.innerHeight) {
    top = rect.top + window.scrollY - modalHeight - 10;
  }

  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;

  // Fetch Data
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error("Extension context invalidated");
    }

    chrome.runtime.sendMessage({ action: "fetchStockData", ticker: ticker }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('TickerView: Connection error', chrome.runtime.lastError);
        modal.innerHTML = `<div class="tv-error">Extension context invalidated. Please refresh the page.</div>`;
        return;
      }

      if (response && response.success) {
        renderModalData(response.quote, response.chart);
        // Re-adjust height if needed after content is loaded
        const finalHeight = modal.offsetHeight;
        if (rect.bottom + finalHeight > window.innerHeight) {
          modal.style.top = `${rect.top + window.scrollY - finalHeight - 10}px`;
        }
      } else {
        const errorDetail = (response && response.error) ? response.error : "Unknown connection error";
        modal.innerHTML = `
          <div class="tv-error">
            <p>Error loading $${ticker}</p>
            <span style="font-size: 10px; opacity: 0.6;">${errorDetail}</span>
          </div>`;
      }
    });
  } catch (e) {
    const isInvalidated = e.message.includes("Extension context invalidated");
    if (isInvalidated) {
      console.log("TickerView: Context invalidated (Extension updated). Page refresh required.");
      modal.innerHTML = `<div class="tv-error" style="padding:20px;">Extension Updated.<br/>Please Refresh Page.</div>`;
    } else {
      console.error('TickerView: Execution error', e);
      modal.innerHTML = `<div class="tv-error">Internal error. Check console.</div>`;
    }
  }
}

function renderModalData(data, chart) {
  const isPositive = (data.regularMarketChange || 0) >= 0;
  const changeColor = isPositive ? '#00ffa3' : '#ff4d4d';

  // Helper for safe decimal formatting
  const f = (val, dec = 2, prefix = '') => {
    if (val === null || val === undefined) return 'N/A';
    if (typeof val === 'string') return val;
    return prefix + val.toFixed(dec);
  };

  // Helper for volume/cap specifically
  const fNum = (val) => {
    if (!val) return 'N/A';
    if (typeof val === 'string') return val;
    return formatNumber(val);
  };

  // --- Display Logic ---

  // Gap %
  const gap = data.gapPct;
  let gapDisplay = 'N/A';
  if (gap !== null && gap !== undefined) {
    const gColor = gap >= 0 ? '#00ffa3' : '#ff4d4d';
    const gSign = gap >= 0 ? '+' : '';
    gapDisplay = `<span style="color: ${gColor}; font-weight: bold;">${gSign}${gap.toFixed(1)}%</span>`;
  }

  // RVOL
  const rvol = data.rvol;
  let rvolDisplay = '';
  if (rvol !== null && rvol !== undefined) {
    const rvolColor = rvol > 1.5 ? '#00ffa3' : (rvol > 1.0 ? '#ffffff' : 'rgba(255,255,255,0.6)');
    const fontWeight = rvol > 1.5 ? 'bold' : 'normal';
    rvolDisplay = `<span style="color: ${rvolColor}; font-weight: ${fontWeight}; margin-left: 4px;">(${rvol.toFixed(1)}x)</span>`;
  }

  // 200MA Distance
  const dist = data.dist200;
  let distDisplay = '';
  if (dist !== null && dist !== undefined) {
    const dColor = dist >= 0 ? '#00ffa3' : '#ff4d4d';
    const dSign = dist >= 0 ? '+' : '';
    distDisplay = `<span style="color: ${dColor}; margin-left: 4px; font-size: 0.9em;">(${dSign}${dist.toFixed(1)}%)</span>`;
  }

  // VWAP
  const vwap = data.vwap;
  const vwapDist = data.vwapDist;
  let vwapDisplay = 'N/A';
  if (vwap) {
    const vColor = vwapDist >= 0 ? '#00ffa3' : '#ff4d4d';
    const vSign = vwapDist >= 0 ? '+' : '';
    vwapDisplay = `${f(vwap, 2, '$')} <span style="color: ${vColor}; font-size: 0.9em;">(${vSign}${f(vwapDist, 1)}%)</span>`;
  }

  // RSI
  const rsi = data.rsi;
  let rsiColor = '#ffffff';
  if (rsi !== null && rsi !== undefined) {
    if (rsi > 70) rsiColor = '#ff4d4d';
    else if (rsi < 30) rsiColor = '#00ffa3';
  }

  // RS SPY
  const rs = data.relStrength;
  const rsColor = (rs || 0) >= 0 ? '#00ffa3' : '#ff4d4d';
  const rsSign = (rs || 0) >= 0 ? '+' : '';
  const rsDisplay = rs !== null && rs !== undefined ? `<span style="color: ${rsColor}">(${rsSign}${rs.toFixed(1)}%)</span>` : 'N/A';

  // RS Sector
  const rss = data.relStrengthSector;
  const rssColor = (rss || 0) >= 0 ? '#00ffa3' : '#ff4d4d';
  const rssSign = (rss || 0) >= 0 ? '+' : '';
  const rssDisplay = rss !== null && rss !== undefined ? `<span style="color: ${rssColor}">(${rssSign}${rss.toFixed(1)}%)</span>` : 'N/A';
  const rssLabel = data.sectorEtf ? `RS (${data.sectorEtf})` : 'RS (Sector)';

  // Status (Pulse Effect)
  const status = data.keyLevelStatus;
  let statusColor = '#ffffff';
  if (status === 'Breakout') statusColor = '#00ffa3';
  if (status === 'Breakdown') statusColor = '#ff4d4d';
  const statusClass = (status === 'Breakout' || status === 'Breakdown') ? 'tv-pulse' : '';
  const statusDisplay = status ? `<span class="${statusClass}" style="color: ${statusColor}; font-weight: ${status !== 'Inside' ? 'bold' : 'normal'}">${status}</span>` : 'Inside';

  // Extended Hours
  let extDisplay = '';
  if (data.extendedPrice) {
    const extColor = (data.extendedChangePct || 0) >= 0 ? '#00ffa3' : '#ff4d4d';
    const extSign = (data.extendedChangePct || 0) >= 0 ? '+' : '';
    extDisplay = `<div style="font-size: 10px; color: #888; margin-top: 2px;">
         Ext: <span style="color:#fff">${f(data.extendedPrice, 2, '$')}</span> 
         <span style="color: ${extColor}">(${extSign}${f(data.extendedChangePct, 1)}%)</span>
      </div>`;
  }

  // Sector & Industry Tag
  const sectorDisplay = data.sector ? `<div style="font-size: 10px; color: #888; margin-top: 2px; line-height: 1.2;">
    ${data.sector} <span style="opacity: 0.5;">•</span> ${data.industry || ''}
  </div>` : '';

  // Earnings Radar (Upgraded)
  let earningDisplay = '';
  const d = data.earningsDays;
  const eStatus = data.earningsStatus;
  const hasEarningsData = data.earningsDate || (eStatus && eStatus.includes('Reported'));

  if (hasEarningsData) {
    const isClose = d !== null && d <= 7 && d >= 0;
    const isRecentlyReported = eStatus && eStatus.includes('Reported');

    let eColor = isClose ? '#ffcc00' : '#aaa';
    let eEmoji = isClose ? '🚨 ' : '';
    let eText = data.earningsDate ? `Earnings: ${data.earningsDate} (${d}d)` : 'Earnings Reported';

    if (isRecentlyReported) {
      eColor = '#00ffa3';
      eEmoji = '📊 ';
      eText = eStatus;
    } else if (eStatus === 'Today') {
      eColor = '#ffcc00';
      eEmoji = '🔥 ';
      eText = "Earnings TODAY";
    }

    earningDisplay = `<div style="font-size: 10px; color: ${eColor}; margin-top: 4px; font-weight: ${isClose || isRecentlyReported ? 'bold' : 'normal'}; display: flex; align-items: center; gap: 4px;">
      ${eEmoji}${eText}
    </div>`;
  }

  modal.innerHTML = `
    <div class="tv-header" style="position: relative; display: flex; flex-direction: column; gap: 4px;">
      <div class="tv-title-section" style="max-width: 100%;">
        <span class="tv-symbol" style="cursor: pointer;" onclick="window.open('https://www.tradingview.com/chart/?symbol=${data.symbol}', '_blank')">$${data.symbol}</span>
        <div class="tv-fullname" style="white-space: normal; line-height: 1.2; font-size: 11px;">${data.longName || data.shortName || ''}</div>
        ${sectorDisplay}
        ${earningDisplay}
      </div>
    <div class="tv-price-section">
        <span class="tv-price">${f(data.regularMarketPrice, 2, '$')}</span>
        <span class="tv-change" style="color: ${changeColor}">
          ${isPositive ? '+' : ''}${f(data.regularMarketChange, 2)}${f(data.regularMarketChangePercent, 2, ' (') + '%)'}
        </span>
        ${extDisplay}
      </div>
    </div>

    <!-- Indicator Info Overlay -->
    <div class="tv-info-icon">?</div>
    <div class="tv-legend">
      <div class="tv-legend-title">Indicator Guide</div>
      
      <div class="tv-legend-item">
        <span class="tv-legend-label">RS (SPY)</span>
        <span class="tv-legend-desc">Performance vs. SPY. Positive means outperforming the market today.</span>
      </div>

      <div class="tv-legend-item">
        <span class="tv-legend-label">RS (Sector)</span>
        <span class="tv-legend-desc">Performance vs. its Sector ETF (e.g., XLK, SMH). Shows strength against peers.</span>
      </div>

      <div class="tv-legend-item">
        <span class="tv-legend-label">RVOL</span>
        <span class="tv-legend-desc">Current volume vs. 50-day average. > 1.5x is high conviction.</span>
      </div>

      <div class="tv-legend-item">
        <span class="tv-legend-label">Stretch (Z)</span>
        <span class="tv-legend-desc">Distance from 20 SMA in StdDevs. > 2.0 = Overbought.</span>
      </div>


      <div class="tv-legend-item">
        <span class="tv-legend-label">Status</span>
        <span class="tv-legend-desc">Breakout/Down vs. Yesterday's High/Low.</span>
      </div>
      
       <div class="tv-legend-item">
        <span class="tv-legend-desc" style="font-style: italic; margin-top: 4px; opacity: 0.8;">Hover over "?" to view definitions.</span>
      </div>
    </div>

    <div class="tv-chart-container" id="tv-sparkline"></div>
    
    <!-- Grid 1: Fundamentals & Momentum -->
    <div class="tv-stats-grid">
      <div class="tv-stat-item">
        <span class="tv-stat-label">Market Cap</span>
        <span class="tv-stat-value">${fNum(data.marketCap)}</span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">Volume</span>
        <span class="tv-stat-value">${fNum(data.regularMarketVolume)}${rvolDisplay}</span>
      </div>
       <div class="tv-stat-item">
        <span class="tv-stat-label">RS (SPY)</span>
        <span class="tv-stat-value">${rsDisplay}</span>
      </div>
    </div>

    <!-- Grid 2: Technicals & Context -->
    <div class="tv-stats-grid" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
       <div class="tv-stat-item">
        <span class="tv-stat-label">RSI (14)</span>
        <span class="tv-stat-value" style="color: ${rsiColor}">${f(data.rsi, 1)}</span> 
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">ATR</span>
        <span class="tv-stat-value">${f(data.atr, 2, '$')}<span style="opacity: 0.7; font-size: 0.9em"> (${f(data.atrPct, 1)}%)</span></span>
      </div>
       <div class="tv-stat-item">
        <span class="tv-stat-label">VWAP</span>
        <span class="tv-stat-value">${vwapDisplay}</span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">${rssLabel}</span>
        <span class="tv-stat-value">${rssDisplay}</span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">Range</span>
        <span class="tv-stat-value">${data.fiftyTwoWeekRange || 'N/A'}</span>
      </div>
    </div>

    <!-- Grid 3: Moving Averages -->
    <div class="tv-stats-grid" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
      <div class="tv-stat-item">
        <span class="tv-stat-label">50 DMA</span>
        <span class="tv-stat-value">${f(data.fiftyDayAverage, 2, '$')}</span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">200 DMA</span>
        <span class="tv-stat-value">${f(data.twoHundredDayAverage, 2, '$')}${distDisplay}</span>
      </div>
    </div>

    <!-- Grid 4: Market Mechanics -->
    <div class="tv-stats-grid" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
      <div class="tv-stat-item">
        <span class="tv-stat-label">Stretch (Z)</span>
        <span class="tv-stat-value" style="color: ${Math.abs(data.zScore) > 2 ? (data.zScore > 0 ? '#ff4d4d' : '#00ffa3') : '#fff'}">
          ${f(data.zScore, 1)}
        </span>
      </div>
       <div class="tv-stat-item">
        <span class="tv-stat-label">Status</span>
        <span class="tv-stat-value">${statusDisplay}</span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">BB Pos</span>
        <span class="tv-stat-value" style="color: ${data.bbPct > 90 ? '#00ffa3' : (data.bbPct < 10 ? '#ff4d4d' : '#fff')}">
          ${f(data.bbPct, 0)}%
        </span>
      </div>
      <div class="tv-stat-item">
        <span class="tv-stat-label">ADR (20)</span>
        <span class="tv-stat-value">${f(data.adrPct, 1)}%</span>
      </div>
    </div>

    <div class="tv-footer">
      Powered by Scap Cerberus
    </div>
  `;

  // Render Sparkline with Chart Data
  if (chart && chart.closes && chart.closes.length > 0) {
    // Use all available data points (intraday or daily)
    renderSparkline(chart.closes, chart.volumes, isPositive);
  }
}

// Sparkline Renderer (Normalized ViewBox)
function renderSparkline(closes, volumes, isPositive) {
  const container = document.getElementById('tv-sparkline');
  if (!container || closes.length < 2) {
    if (container) container.innerHTML = '<div style="text-align:center; padding-top:20px; color:#555; font-size:10px;">No Chart Data</div>';
    return;
  }

  // Normalize Prices
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;

  // Normalize Volumes
  let volPoints = '';
  if (volumes && volumes.length === closes.length) {
    const maxVol = Math.max(...volumes) || 1;
    const viewWidth = 300;
    const viewHeight = 50;
    const barWidth = (viewWidth / volumes.length) * 0.8; // 80% width with gap

    volPoints = volumes.map((v, i) => {
      const x = (i / (volumes.length - 1)) * viewWidth;
      const h = (v / maxVol) * (viewHeight * 0.4); // Max 40% height
      const y = viewHeight - h;
      return `<rect x="${x}" y="${y}" width="${Math.max(1, barWidth)}" height="${h}" fill="#fff" fill-opacity="0.1" />`;
    }).join('');
  }

  // ViewBox
  const viewWidth = 300;
  const viewHeight = 50;
  const pad = 5;
  const drawHeight = viewHeight - (pad * 2);

  const points = closes.map((price, i) => {
    const x = (i / (closes.length - 1)) * viewWidth;
    const normalizedY = (price - min) / (range || 1);
    const y = (viewHeight - pad) - (normalizedY * drawHeight);
    return `${x},${y}`;
  }).join(' ');

  const color = isPositive ? '#00ffa3' : '#ff4d4d';

  const svg = `
    <svg width="100%" height="100%" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="none" style="overflow: visible;">
      ${volPoints}
      <path d="M0,${viewHeight} L${points.split(' ')[0]} ${points} L${viewWidth},${viewHeight} Z" fill="url(#grad)" stroke="none" />
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:0.2" />
          <stop offset="100%" style="stop-color:${color};stop-opacity:0" />
        </linearGradient>
      </defs>
    </svg>
  `;

  container.innerHTML = svg;
}

function formatNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  return num.toLocaleString();
}
