/* Market-window research views. Provider access remains in the service worker. */
(() => {
  const helpers = TickerViewResearch;
  const ranges = ['1D', '5D', '1M', '6M', '1Y'];
  const colors = ['#FF6600', '#66c2ff', '#c5a3ff', '#f4d35e'];
  const selected = new Set(), resources = new Map(), queue = [];
  let running = 0, sparkRange = '1M', compareRange = '1M', compareMode = false;
  let activeTicker = null, view = null, comparisonGeneration = 0, comparisonData = null, chartIndex = 0, returnAnchor = null;
  const body = document.body, library = $('.library-layout'), modal = $('#tickerview-modal');
  body.classList.add('tv-research-enabled');
  modal.removeAttribute('aria-modal');
  const panel = document.createElement('section'); panel.id = 'research-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Ticker research');
  const navigation = document.createElement('div'); navigation.className = 'research-navigation';
  const back = button('Back', 'Back to watchlist', closePanel);
  const previous = button('↑ Previous', 'Previous watchlist ticker', () => navigate(-1));
  const next = button('Next ↓', 'Next watchlist ticker', () => navigate(1));
  navigation.append(back, previous, next);
  const comparison = document.createElement('div'); comparison.id = 'ticker-comparison'; comparison.hidden = true;
  panel.append(navigation, modal, comparison); library.append(panel);

  const tools = document.createElement('div'); tools.className = 'research-tools';
  const rangeLabel = document.createElement('label'); rangeLabel.textContent = 'Trend ';
  const sparkSelect = rangeSelect('Watchlist trend timeframe', range => { sparkRange = range; decorate(); });
  rangeLabel.append(sparkSelect);
  const modeButton = button('Compare', 'Select tickers to compare', () => {
    compareMode = !compareMode; modeButton.setAttribute('aria-pressed', String(compareMode));
    decorate();
  }); modeButton.setAttribute('aria-pressed', 'false');
  const launch = button('Compare selected', 'Compare selected tickers', () => {
    returnAnchor = launch;
    document.dispatchEvent(new CustomEvent('tickerview:close', { detail: { after: () => {
      activeTicker = null; view = 'compare'; showPanel(); void renderComparison();
    } } }));
  });
  const selection = document.createElement('div'); selection.className = 'comparison-selection'; selection.setAttribute('aria-label', 'Selected comparison tickers');
  const selectionStatus = document.createElement('span'); selectionStatus.setAttribute('role', 'status');
  tools.append(rangeLabel, modeButton, launch, selection, selectionStatus);
  $('.watch-filter').before(tools);

  function button(text, label, action) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
    element.setAttribute('aria-label', label); element.addEventListener('click', action); return element;
  }
  function rangeSelect(label, change, value = '1M') {
    const select = document.createElement('select'); select.setAttribute('aria-label', label);
    for (const range of ranges) select.add(new Option(range, range));
    select.value = value; select.addEventListener('change', () => change(select.value)); return select;
  }
  function visibleSymbols() { return [...$('#watchlist').querySelectorAll('.watch-row')].map(row => row.dataset.symbol); }
  function updateNavigation() {
    const symbols = visibleSymbols(), index = symbols.indexOf(activeTicker);
    previous.hidden = next.hidden = view !== 'ticker';
    previous.disabled = index <= 0; next.disabled = index < 0 || index >= symbols.length - 1;
  }
  function navigate(direction) {
    const symbols = visibleSymbols(), index = symbols.indexOf(activeTicker);
    const ticker = symbols[index + direction];
    if (index < 0 || !ticker) return;
    const anchor = [...$('#watchlist').querySelectorAll('[data-open-ticker]')].find(element => element.dataset.openTicker === ticker);
    openCard(ticker, anchor);
  }
  function showPanel() {
    panel.hidden = false; body.classList.add('research-open');
    comparison.hidden = view !== 'compare'; updateNavigation();
    if (view === 'compare') back.focus();
  }
  function hidePanel() {
    view = null; activeTicker = null; comparisonGeneration++; comparisonData = null;
    panel.hidden = true; comparison.hidden = true; body.classList.remove('research-open');
    markActiveRow(); scheduleFit();
  }
  function closePanel() {
    if (view === 'ticker') document.dispatchEvent(new CustomEvent('tickerview:close', { detail: { after: () => {
      hidePanel(); restoreFocus();
    } } }));
    else { hidePanel(); restoreFocus(); }
  }
  function restoreFocus() {
    const replacement = returnAnchor?.dataset.openTicker && [...$('#watchlist').querySelectorAll('[data-open-ticker]')].find(element => element.dataset.openTicker === returnAnchor.dataset.openTicker);
    const target = returnAnchor?.isConnected ? returnAnchor : replacement || $('#watch-filter'); target.focus({ preventScroll: true });
  }
  document.addEventListener('tickerview:opened', event => {
    comparisonGeneration++; comparisonData = null;
    activeTicker = event.detail.ticker; view = 'ticker';
    returnAnchor = [...$('#watchlist').querySelectorAll('[data-open-ticker]')].find(element => element.dataset.openTicker === activeTicker) || $('#search-symbol');
    showPanel();
    markActiveRow();
  });
  document.addEventListener('tickerview:closed', hidePanel);
  document.addEventListener('keydown', event => {
    if ($('#settings-dialog').open) return;
    if (event.key === 'Escape' && view === 'compare') { event.preventDefault(); closePanel(); }
    if (view === 'ticker' && ['ArrowUp', 'ArrowDown'].includes(event.key) &&
        (event.target === previous || event.target === next || event.target.closest('.watch-open'))) {
      event.preventDefault(); navigate(event.key === 'ArrowUp' ? -1 : 1);
    }
  });

  // A bounded session cache shares pending chart work between both views.
  function loadChart(symbol, range) {
    const key = `${symbol}:${range}`, cached = resources.get(key);
    const failed = cached?.error || cached?.result?.status?.stale || cached?.result?.status?.error;
    const ttl = failed ? 20000 : ['1D', '5D'].includes(range) ? 60000 : 6 * 3600000;
    const fetchedAt = cached?.result?.status?.fetchedAt;
    const time = !failed && Number.isFinite(fetchedAt) ? fetchedAt : cached?.time;
    if (cached && (cached.pending || Date.now() - time < ttl)) return cached.promise;
    const entry = { time: Date.now(), pending: true };
    entry.promise = new Promise(resolve => queue.push({ symbol, range, entry, resolve }));
    resources.delete(key); resources.set(key, entry);
    for (const [oldKey, old] of resources) {
      if (resources.size <= 160) break;
      if (!old.pending) resources.delete(oldKey);
    }
    drain(); return entry.promise;
  }
  function drain() {
    while (!document.hidden && running < 3 && queue.length) {
      const job = queue.shift(); running++;
      request('chart', { ticker: job.symbol, range: job.range }).then(result => {
        job.entry.result = result;
      }).catch(error => { job.entry.error = error.message; }).finally(() => {
        job.entry.pending = false; job.entry.time = Date.now(); running--;
        job.resolve(job.entry); drain();
      });
    }
  }
  const rowObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      rowObserver.unobserve(entry.target); void drawSpark(entry.target);
    }
  }, { rootMargin: '100px' });
  function updateSelection() {
    selection.replaceChildren();
    for (const symbol of selected) selection.append(button(`${symbol} ×`, `Remove ${symbol} from comparison`, () => {
      selected.delete(symbol); decorate(); if (view === 'compare') void renderComparison();
    }));
    launch.hidden = selection.hidden = selectionStatus.hidden = !compareMode;
    launch.disabled = selected.size < 2 || selected.size > 4;
    launch.textContent = `Compare (${selected.size}/4)`;
    selectionStatus.textContent = selected.size === 4 ? 'Four selected · remove one to choose another.' : 'Select 2–4 watchlist tickers.';
    for (const input of $('#watchlist').querySelectorAll('.compare-checkbox')) {
      input.checked = selected.has(input.dataset.symbol);
      input.disabled = reorderMode || (!input.checked && selected.size >= 4);
    }
  }
  function pruneQueue() {
    const visible = new Set(visibleSymbols());
    for (let i = queue.length - 1; i >= 0; i--) {
      const job = queue[i];
      if (job.range === sparkRange && visible.has(job.symbol) || view === 'compare' && job.range === compareRange && selected.has(job.symbol)) continue;
      queue.splice(i, 1); resources.delete(`${job.symbol}:${job.range}`);
      job.entry.pending = false; job.entry.error = 'Chart request superseded'; job.resolve(job.entry);
    }
  }
  function markActiveRow() {
    for (const row of $('#watchlist').querySelectorAll('.watch-row')) {
      row.classList.toggle('research-selected', view === 'ticker' && row.dataset.symbol === activeTicker);
      const open = row.querySelector('.watch-open');
      if (view === 'ticker' && row.dataset.symbol === activeTicker) open.setAttribute('aria-current', 'true'); else open.removeAttribute('aria-current');
    }
  }
  function decorate() {
    rowObserver.disconnect(); pruneQueue();
    body.classList.toggle('comparison-picking', compareMode);
    let removed = false;
    for (const symbol of selected) if (!currentWatchlist.includes(symbol)) { selected.delete(symbol); removed = true; }
    const table = $('#watchlist table');
    if (table) {
      if (!table.querySelector('.trend-heading')) {
        const heading = document.createElement('th'); heading.className = 'trend-heading'; heading.scope = 'col'; heading.textContent = 'Trend';
        table.querySelector('thead tr').insertBefore(heading, table.querySelector('thead tr').lastElementChild);
        const col = document.createElement('col'); col.className = 'trend-column';
        table.querySelector('colgroup').insertBefore(col, table.querySelector('colgroup').lastElementChild);
      }
      table.querySelector('.trend-heading').textContent = `Trend · ${sparkRange}`;
      for (const row of table.querySelectorAll('.watch-row')) {
        let checkbox = row.querySelector('.compare-checkbox');
        if (!checkbox) {
          checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'compare-checkbox'; checkbox.dataset.symbol = row.dataset.symbol;
          checkbox.setAttribute('aria-label', `Compare ${row.dataset.symbol}`);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked && selected.size < 4) selected.add(row.dataset.symbol); else selected.delete(row.dataset.symbol);
            updateSelection(); if (view === 'compare') void renderComparison();
          }); row.firstElementChild.prepend(checkbox);
        }
        checkbox.hidden = !compareMode;
        row.onclick = event => { if (!event.target.closest('button, input, a')) openCard(row.dataset.symbol, row.querySelector('.watch-open')); };
        let cell = row.querySelector('.watch-trend');
        if (!cell) { cell = document.createElement('td'); cell.className = 'watch-trend'; row.insertBefore(cell, row.lastElementChild); }
        cell.dataset.symbol = row.dataset.symbol; cell.dataset.range = sparkRange;
        cell.replaceChildren(); const spark = button('Loading…', `Open ${row.dataset.symbol} research`, () => openCard(row.dataset.symbol, spark));
        cell.append(spark); rowObserver.observe(cell);
      }
    }
    modeButton.disabled = reorderMode; updateSelection(); updateNavigation(); markActiveRow();
    if (removed && view === 'compare') void renderComparison();
  }
  async function drawSpark(cell) {
    const { symbol, range } = cell.dataset;
    const entry = await loadChart(symbol, range);
    if (!cell.isConnected || cell.dataset.range !== range) return;
    const target = cell.querySelector('button'); if (!target) return;
    const points = helpers.points(entry.result?.chart);
    if (entry.error || points.length < 2) {
      target.textContent = 'Unavailable'; target.title = entry.error || 'Not enough chart data'; return;
    }
    const values = points.map(point => point.close), performance = helpers.returnPercent(values[0], values.at(-1));
    target.replaceChildren();
    const svg = svgElement('svg', { viewBox: '0 0 100 28', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    svg.append(svgElement('polyline', { points: helpers.coordinates(values, 100, 28), fill: 'none', stroke: performance === null || performance === 0 ? 'var(--tv-muted)' : performance > 0 ? 'var(--tv-positive, #38e889)' : 'var(--tv-negative, #ff6666)', 'stroke-width': '1.5' }));
    const label = document.createElement('small'); label.textContent = `${percent(performance)}${entry.result.status?.stale ? ' · STALE' : ''}`;
    target.append(svg, label);
    const description = `${symbol} ${range} price return ${label.textContent}. Open research.`;
    target.setAttribute('aria-label', description); target.title = description;
  }
  function svgElement(name, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }
  function percent(value) { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—'; }
  function paragraph(text) { const element = document.createElement('p'); element.textContent = text; return element; }
  async function renderComparison() {
    pruneQueue();
    const id = ++comparisonGeneration, symbols = [...selected];
    const chartFocused = !!document.activeElement?.closest('.comparison-chart'), rangeFocused = document.activeElement?.getAttribute('aria-label') === 'Comparison timeframe';
    const priorIndex = chartIndex;
    comparisonData = null; comparison.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'Ticker comparison';
    const range = rangeSelect('Comparison timeframe', value => { compareRange = value; void renderComparison(); }, compareRange);
    const readout = paragraph('Loading comparison…'); readout.id = 'comparison-readout'; readout.setAttribute('role', 'status');
    comparison.append(title, range, paragraph('Price performance · excludes dividends and currency conversion. Shared observations only.'), readout);
    if (rangeFocused) range.focus({ preventScroll: true });
    if (symbols.length < 2) { readout.textContent = 'Select at least two watchlist tickers to compare.'; return; }
    const entries = await Promise.all(symbols.map(async symbol => ({ symbol, ...await loadChart(symbol, compareRange) })));
    if (id !== comparisonGeneration || view !== 'compare') return;
    const valid = entries.filter(entry => !entry.error && helpers.points(entry.result?.chart).length >= 2);
    for (const entry of entries) {
      if (!valid.includes(entry)) comparison.append(paragraph(`${entry.symbol}: ${entry.error || 'Not enough chart data'} · excluded.`));
      else if (entry.result.status?.stale) comparison.append(paragraph(`${entry.symbol}: STALE cached chart.`));
    }
    const aligned = helpers.compare(valid.map(entry => ({ symbol: entry.symbol, chart: entry.result.chart })));
    if (aligned.keys.length < 2) { readout.textContent = 'Insufficient overlapping observations for comparison.'; appendStats(symbols, aligned); return; }
    comparisonData = aligned; chartIndex = aligned.keys.length - 1;
    const all = aligned.series.flatMap(series => series.values), bounds = [Math.min(0, ...all), Math.max(0, ...all)];
    const chart = svgElement('svg', { viewBox: '0 0 600 220', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const zeroY = helpers.coordinates([0, 0], 600, 220, bounds).split(' ')[0].split(',')[1];
    chart.append(svgElement('line', { x1: 0, x2: 600, y1: zeroY, y2: zeroY, stroke: 'var(--tv-muted)', 'stroke-dasharray': '4 4' }));
    const axis = paragraph(`${percent(bounds[1])} top · ${percent(bounds[0])} bottom · 0% baseline`); axis.className = 'comparison-axis';
    const legend = document.createElement('div'); legend.className = 'comparison-legend';
    aligned.series.forEach((series, i) => {
      chart.append(svgElement('polyline', { points: helpers.coordinates(series.values, 600, 220, bounds), fill: 'none', stroke: colors[i], 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }));
      const label = document.createElement('span'); label.style.color = colors[i]; label.textContent = `${series.symbol} ${percent(series.values.at(-1))}`; legend.append(label);
    });
    const crosshair = svgElement('line', { class: 'comparison-crosshair', x1: 600, x2: 600, y1: 0, y2: 220, stroke: 'var(--tv-muted)', 'stroke-dasharray': '3 3' }); chart.append(crosshair);
    const chartBox = document.createElement('div'); chartBox.className = 'comparison-chart'; chartBox.tabIndex = 0; chartBox.setAttribute('role', 'group');
    chartBox.setAttribute('aria-label', 'Comparison price performance chart. Use left and right arrow keys to inspect shared observations.'); chartBox.setAttribute('aria-describedby', readout.id);
    chartBox.append(chart); comparison.append(legend, axis, chartBox);
    const inspect = index => {
      chartIndex = Math.max(0, Math.min(aligned.keys.length - 1, index));
      const key = aligned.keys[chartIndex], when = /^\d+$/.test(key) ? `${new Date(Number(key) * 1000).toLocaleString(undefined, { timeZone: 'UTC' })} UTC` : key;
      readout.textContent = `${when} · ${aligned.series.map(series => `${series.symbol} ${percent(series.values[chartIndex])}`).join(' · ')}`;
      const x = chartIndex / (aligned.keys.length - 1) * 600; crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
    };
    chartBox.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); inspect(chartIndex + (event.key === 'ArrowLeft' ? -1 : 1)); } });
    chartBox.addEventListener('pointermove', event => { const rect = chartBox.getBoundingClientRect(); inspect(Math.round((event.clientX - rect.left) / rect.width * (aligned.keys.length - 1))); });
    inspect(chartFocused ? priorIndex : chartIndex); appendStats(symbols, aligned);
    if (chartFocused) chartBox.focus({ preventScroll: true });
  }
  function appendStats(symbols, aligned) {
    const wrapper = document.createElement('div'); wrapper.className = 'comparison-stats';
    const table = document.createElement('table'); table.setAttribute('aria-label', 'Ticker comparison statistics');
    const head = document.createElement('thead'), header = document.createElement('tr');
    for (const label of ['Ticker', 'Period return', 'Latest price', 'Daily change', 'RSI (14)']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell); }
    head.append(header); table.append(head);
    const tbody = document.createElement('tbody');
    for (const symbol of symbols) {
      const quote = snapshots[symbol], series = aligned.series.find(item => item.symbol === symbol), row = document.createElement('tr');
      const indicator = quote?.quickIndicators;
      const rsi = indicator?.sessionDate === quote?.sessionDate && Number.isFinite(indicator?.rsi) ? indicator.rsi.toFixed(1) : '—';
      const values = [symbol, percent(series?.values.at(-1)), Number.isFinite(quote?.price) ? `${quote.currency || ''} ${quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—', percent(quote?.changePercent), `${rsi}${indicator?.stale || indicator?.error ? ' · cached' : ''}`];
      values.forEach((value, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = value; if (index === 0) cell.scope = 'row'; row.append(cell); });
      if (quote?.stale || quote?.fallback || refreshOutcomes[symbol]?.error) row.firstElementChild.append(' · cached/stale');
      if (quote?.quoteTime) row.title = `Quote time: ${new Date(quote.quoteTime * 1000).toLocaleString()}`;
      tbody.append(row);
    }
    table.append(tbody); wrapper.append(table); comparison.append(wrapper);
  }
  document.addEventListener('tickerview:library-rendered', event => {
    decorate();
    const focused = event.detail?.focusedCompare;
    if (focused) [...$('#watchlist').querySelectorAll('.compare-checkbox')].find(input => input.dataset.symbol === focused)?.focus({ preventScroll: true });
    if (view === 'compare' && comparisonData) { comparison.querySelector('.comparison-stats')?.remove(); appendStats([...selected], comparisonData); }
  });
  document.addEventListener('tickerview:dashboard-refreshed', () => { decorate(); if (view === 'compare') void renderComparison(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { drain(); decorate(); if (view === 'compare') void renderComparison(); } });
  decorate();
})();
