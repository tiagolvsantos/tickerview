const $ = selector => document.querySelector(selector);
let currentSettings = TickerView.defaults, currentWatchlist = [], currentSite = null, snapshots = {}, currentRecent = [], libraryGeneration = 0, watchSort = 'saved', refreshOutcomes = {}, customAliases = {};
let dashboardPreferences = TickerView.dashboardPreferences(), overviewSnapshots = {}, overviewRequested = false, dashboardBusy = false, autoTimer, lastRefreshAttempt = 0, nextRefreshAt = null;
let noteSymbols = new Set(), lastRemoval = null, retryingQuotes = false;
let reorderMode = false, reorderBusy = false, draggedSymbol = null;
let windowReady = false, fitTimer, resizeTimer, lastAppliedBounds;
const message = text => { $('#status').textContent = text; };
const feedback = (text, error = false) => {
  $('#symbol-feedback').textContent = text;
  $('#symbol-feedback').classList.toggle('error', error);
  $('#symbol').setAttribute('aria-invalid', String(error));
};
async function request(action, extra = {}) {
  const result = await chrome.runtime.sendMessage({ action, ...extra });
  if (!result?.success) throw new Error(result?.error || 'Extension unavailable');
  return result;
}
const popupParams = new URLSearchParams(location.search);
const expanded = popupParams.get('expanded') === '1';
if (expanded) {
  document.body.classList.add('tv-expanded');
  $('#expand-popup').hidden = true;
  $('#fit-window').hidden = false;
}
function supportedSite(address) {
  try {
    const url = new URL(address);
    const supported = chrome.runtime.getManifest().content_scripts[0].matches.some(pattern => {
      const host = new URL(pattern.replace('*.', '')).hostname;
      return url.hostname === host || url.hostname.endsWith(`.${host}`);
    });
    return url.protocol === 'https:' && supported ? url.hostname : null;
  } catch { return null; }
}
$('#expand-popup').addEventListener('click', async () => {
  const button = $('#expand-popup'); button.disabled = true;
  try {
    const url = new URL(chrome.runtime.getURL('popup.html'));
    url.searchParams.set('expanded', '1');
    if (currentSite) url.searchParams.set('site', currentSite);
    const stored = await chrome.storage.local.get(['dashboardPreferences', 'windowBounds']);
    const bounds = TickerView.dashboardPreferences(stored.dashboardPreferences).windowMode === 'remember' ? TickerView.windowBounds(stored.windowBounds) : null;
    const height = bounds?.height || 600;
    const width = bounds?.width || Math.min(480, Math.floor(screen.availWidth));
    await chrome.windows.create({ url: url.href, type: 'popup', width, height,
      top: Math.floor(screen.availTop + 20), left: Math.floor(screen.availLeft + Math.max(0, screen.availWidth - width - 20)) });
    window.close();
  } catch (error) { message(`Could not expand TickerView: ${error.message}`); button.disabled = false; }
});
function renderSettings() {
  for (const key of ['enabled', 'compact', 'reducedEffects']) $(`#${key}`).checked = currentSettings[key];
  const delay = $('#hoverDelay');
  if (![...delay.options].some(option => Number(option.value) === currentSettings.hoverDelay)) delay.add(new Option(`${currentSettings.hoverDelay} ms`, currentSettings.hoverDelay));
  delay.value = currentSettings.hoverDelay;
  $('#siteEnabled').checked = !!currentSite && !currentSettings.disabledSites.includes(currentSite);
  $('#siteEnabled').disabled = !currentSite || !currentSettings.enabled;
  $('#site').textContent = currentSite || 'a supported site';
  $('#appearance-summary').textContent = `${currentSettings.hoverDelay ? `${currentSettings.hoverDelay} ms` : 'Instant'} · ${currentSettings.compact ? 'Compact' : 'Detailed'}`;
  $('#indicator-count').textContent = `${currentSettings.indicators.length} selected`;
  for (const button of document.querySelectorAll('[data-preset]')) {
    const preset = TickerView.presets[button.dataset.preset];
    button.setAttribute('aria-pressed', String(preset.length === currentSettings.indicators.length && preset.every(key => currentSettings.indicators.includes(key))));
  }
  const focusedIndicator = document.activeElement?.dataset.indicator;
  const container = $('#indicators'); container.replaceChildren();
  for (const [group, keys] of Object.entries(TickerView.groups)) {
    const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = group; fieldset.append(legend);
    for (const key of keys) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.dataset.indicator = key; input.checked = currentSettings.indicators.includes(key);
      label.append(input, ` ${TickerView.indicators[key]}`); fieldset.append(label);
    }
    container.append(fieldset);
  }
  if (focusedIndicator) container.querySelector(`[data-indicator="${focusedIndicator}"]`)?.focus({ preventScroll: true });
}
async function saveSettings(extra) {
  try { await request('settings', extra); message('Settings saved'); }
  catch (error) { message(error.message); renderSettings(); }
}
function openCard(ticker, anchor) {
  document.dispatchEvent(new CustomEvent('tickerview:open', { detail: { ticker, anchor } }));
}
function symbolButton(symbol, className = '') {
  const button = document.createElement('button'); button.type = 'button'; button.className = className;
  button.dataset.openTicker = symbol; button.setAttribute('aria-label', `Open ${symbol} stock card`);
  button.addEventListener('click', () => openCard(symbol, button)); return button;
}
const columnDescriptions = {
  symbol: 'Canonical ticker and company name. Click a row to open its market card. Click this heading to sort by symbol.',
  price: 'Latest provider quote in the instrument’s quote currency. Quotes may be delayed or cached. Click to sort by numeric price across quote currencies.',
  change: 'Daily percentage change, with the absolute price change underneath, relative to the provider’s previous close. Click to sort by percentage.',
  rsi: 'Daily RSI (14), using Wilder smoothing of gains and losses. Range 0–100; values above 70 or below 30 describe momentum extremes, not buy/sell signals. Needs at least 15 daily closes.',
  ytdVwap: 'Estimated year-to-date anchored VWAP in quote currency: sum(daily close × volume) ÷ sum(volume) over available bars since January 1 of the quote’s exchange-local session year. Includes the current partial session when available. This daily-bar estimate differs from tick VWAP and the card’s session VWAP. * Estimate.',
  vwapDiff: 'Distance of the latest quote from estimated YTD anchored VWAP. Percentage = (price ÷ VWAP − 1) × 100; the amount underneath is price − VWAP in quote currency. Positive means above VWAP, negative below. Uses the same session and cached/stale status as the VWAP estimate.',
  actions: 'Remove a symbol from the watchlist. Undo restores the latest removal. Reorder enables drag handles and keyboard Up/Down moves.'
};
function hideColumnHelp() {
  $('#column-tooltip').hidden = true;
  for (const button of $('#watchlist').querySelectorAll('[aria-describedby="column-tooltip"]')) button.removeAttribute('aria-describedby');
}
function showColumnHelp(button) {
  const text = columnDescriptions[button?.dataset.column]; if (!text) return;
  hideColumnHelp();
  const tooltip = $('#column-tooltip'); tooltip.textContent = text; tooltip.hidden = false;
  button.setAttribute('aria-describedby', 'column-tooltip');
  const box = button.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - tooltip.offsetWidth - 8, box.left))}px`;
  tooltip.style.top = `${Math.max(8, box.bottom + tooltip.offsetHeight + 8 <= innerHeight ? box.bottom + 6 : box.top - tooltip.offsetHeight - 6)}px`;
}
for (const name of ['mouseover', 'focusin']) $('#watchlist').addEventListener(name, event => {
  const button = event.target.closest('th button'); if (button) showColumnHelp(button);
});
for (const name of ['mouseout', 'focusout']) $('#watchlist').addEventListener(name, event => {
  const button = event.target.closest('th button');
  if (button && !button.contains(event.relatedTarget) && !button.matches(':hover, :focus')) hideColumnHelp();
});
function updateColumnHelpPosition() {
  requestAnimationFrame(() => {
    const focused = document.activeElement?.closest('th button');
    if (focused && $('#watchlist').contains(focused)) showColumnHelp(focused);
    else hideColumnHelp();
  });
}
$('#watchlist').addEventListener('scroll', updateColumnHelpPosition);
window.addEventListener('resize', updateColumnHelpPosition);
window.addEventListener('scroll', updateColumnHelpPosition);
function renderLibrary() {
  if (draggedSymbol) return;
  const focusedCompare = document.activeElement?.matches('.compare-checkbox') ? document.activeElement.dataset.symbol : null;
  const focused = document.activeElement?.dataset.openTicker, focusedSort = document.activeElement?.dataset.sortKey, focusedReorder = document.activeElement?.dataset.reorderSymbol;
  const container = $('#watchlist'); container.replaceChildren();
  const query = $('#watch-filter').value.trim().toLowerCase();
  const visible = TickerView.sortSymbols(currentWatchlist, snapshots, watchSort).filter(symbol => !query || symbol.toLowerCase().includes(query) || (snapshots[symbol]?.name || '').toLowerCase().includes(query));
  $('#clear-filter').hidden = !query;
  $('#watch-count').textContent = query ? `${visible.length}/${currentWatchlist.length}` : currentWatchlist.length;
  $('#reorder-watchlist').disabled = reorderBusy || (!reorderMode && currentWatchlist.length < 2);
  $('#reorder-watchlist').textContent = reorderMode ? 'Done' : 'Reorder';
  $('#reorder-watchlist').setAttribute('aria-pressed', String(reorderMode));
  $('#reorder-help').hidden = !reorderMode;
  $('#watch-filter').disabled = reorderMode;
  hideColumnHelp();
  container.classList.toggle('is-reordering', reorderMode);
  $('#cache-note').hidden = !currentWatchlist.length;
  if (!currentWatchlist.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Use + Add, or save a symbol from a card.'; container.append(p); }
  const table = document.createElement('table'); table.className = 'watch-table'; table.setAttribute('aria-label', 'Watchlist quotes');
  table.innerHTML = '<colgroup><col class="symbol-column"><col class="price-column"><col class="change-column"><col class="rsi-column"><col class="vwap-column"><col class="vwap-diff-column"><col class="remove-column"></colgroup><thead><tr><th scope="col"><button type="button" data-sort-key="symbol" aria-label="Sort by symbol">Symbol / company <span></span></button></th><th scope="col"><button type="button" data-sort-key="price" aria-label="Sort by price">Price <span></span></button></th><th scope="col"><button type="button" data-sort-key="change" aria-label="Sort by daily percentage change">Change <span></span></button></th><th scope="col"><button type="button" data-column="rsi" aria-label="About RSI (14)">RSI (14)</button></th><th scope="col"><button type="button" data-column="ytdVwap" aria-label="About YTD anchored VWAP estimate">YTD VWAP*</button></th><th scope="col"><button type="button" data-column="vwapDiff" aria-label="About distance from YTD VWAP">Δ VWAP</button></th><th scope="col"><button type="button" data-column="actions" aria-label="About watchlist actions">×<span class="sr-only"> Actions</span></button></th></tr></thead><tbody></tbody>';
  for (const button of table.querySelectorAll('th button')) {
    button.dataset.column ||= button.dataset.sortKey;
  }

  for (const button of table.querySelectorAll('[data-sort-key]')) {
    button.disabled = reorderMode;
    const key = button.dataset.sortKey, active = key === 'symbol' ? watchSort === 'symbol' || watchSort === 'symbol-desc' : watchSort.startsWith(key + '-');
    const ascending = watchSort === 'symbol' || watchSort.endsWith('-asc');
    button.closest('th').setAttribute('aria-sort', active ? ascending ? 'ascending' : 'descending' : 'none');
    button.querySelector('span').textContent = active ? ascending ? '↑' : '↓' : '↕';
  }
  if (visible.length) container.append(table);
  else if (currentWatchlist.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching symbols'; container.append(empty); }
  for (const symbol of visible) {
    const row = document.createElement('tr'); row.className = 'watch-row'; row.dataset.symbol = symbol;
    const identityCell = document.createElement('td');
    const open = symbolButton(symbol, 'watch-open'); const quote = snapshots[symbol];
    const identity = document.createElement('span'); identity.className = 'watch-identity';
    const ticker = document.createElement('strong'); ticker.textContent = symbol;
    if (noteSymbols.has(symbol)) { const marker = document.createElement('span'); marker.className = 'note-marker'; marker.id = `watch-note-${symbol}`; marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', 'Saved note'); marker.title = 'Saved note'; open.setAttribute('aria-describedby', marker.id); ticker.append(marker); }
    const name = document.createElement('small'); name.textContent = quote?.name && quote.name !== symbol ? quote.name : 'Open card to load data';
    name.title = name.textContent; identity.append(ticker, name); open.append(identity);
    if (reorderMode) {
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'reorder-handle';
      handle.textContent = '⠿'; handle.draggable = true; handle.disabled = reorderBusy; handle.dataset.reorderSymbol = symbol;
      handle.setAttribute('aria-label', `Move ${symbol}`); handle.setAttribute('aria-describedby', 'reorder-help');
      const identityRow = document.createElement('div'); identityRow.className = 'watch-identity-row'; identityRow.append(handle, open); identityCell.append(identityRow);
    } else identityCell.append(open);
    const data = document.createElement('td'); data.className = 'watch-price';
    const change = document.createElement('td'); change.className = 'watch-change';
    if (Number.isFinite(quote?.price)) {
      const currency = document.createElement('small'); currency.className = 'watch-currency'; currency.textContent = quote.currency ? `${quote.currency} ` : '';
      data.append(currency, document.createTextNode(quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })));
      const amount = document.createElement('span'); amount.className = 'watch-change-amount';
      amount.textContent = Number.isFinite(quote.change) ? `${quote.change > 0 ? '+' : ''}${quote.change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
      amount.title = `Daily price change (${quote.currency || 'quote currency'})`;
      const percent = document.createElement('small'); percent.className = 'watch-change-percent';
      percent.textContent = Number.isFinite(quote.changePercent) ? `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%` : '—';
      percent.title = 'Daily percentage change';
      for (const [element, value] of [[amount, quote.change], [percent, quote.changePercent]]) if (Number.isFinite(value)) element.classList.add(value >= 0 ? 'positive' : 'negative');
      change.append(percent, amount);
      open.title = `Cached quote${quote.quoteTime ? ` · ${new Date(quote.quoteTime * 1000).toLocaleString()}` : ''}${quote.stale ? ' · stale' : ''}`;
      data.title = open.title;
    } else { data.textContent = '—'; data.title = 'Not viewed'; change.textContent = '—'; }
    const outcome = refreshOutcomes[symbol];
    if (outcome?.error || outcome?.stale || quote?.stale) {
      const warning = document.createElement('small'); warning.className = 'watch-warning';
      warning.textContent = outcome?.error ? `Refresh: ${outcome.error}` : 'Stale cached quote'; identityCell.append(warning);
    }
    const removeCell = document.createElement('td'); removeCell.className = 'watch-remove';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-symbol'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${symbol}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const index = currentWatchlist.indexOf(symbol);
      try {
        await request('watch', { ticker: symbol, saved: false });
        lastRemoval = { symbol, index }; showRemoval(`Removed ${symbol}`);
        await refreshLibrary(); $('#undo-remove').focus({ preventScroll: true });
      }
      catch (error) { message(error.message); remove.disabled = false; }
    });
    const rsi = document.createElement('td'); rsi.className = 'watch-indicator watch-rsi';
    const vwap = document.createElement('td'); vwap.className = 'watch-indicator watch-ytd-vwap';
    const indicators = quote?.quickIndicators;
    const compatible = indicators?.sessionDate && indicators.sessionDate === quote.sessionDate;
    rsi.textContent = compatible && Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(1) : '—';
    vwap.textContent = compatible && Number.isFinite(indicators.ytdVwap) ? indicators.ytdVwap.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const indicatorStatus = !compatible ? 'Indicators not loaded for this quote session. Refresh quotes to load.' : `${indicators.sessionDate} · Daily history retrieved ${Number.isFinite(indicators.fetchedAt) ? new Date(indicators.fetchedAt).toLocaleString() : 'unknown'}${indicators.stale || quote.stale || quote.fallback ? ' · Cached/stale estimate' : ''}${indicators.error ? ` · ${indicators.error}` : ''}`;
    rsi.title = `${indicatorStatus}${rsi.textContent === '—' ? ' · RSI needs at least 15 daily closes.' : ''}`;
    vwap.title = `${indicatorStatus}${compatible ? ` · Anchored ${indicators.sessionDate.slice(0, 4)}-01-01 · ${quote.currency || 'quote currency'} · Daily close × volume estimate` : ''}${vwap.textContent === '—' ? ' · No usable year-to-date volume data.' : ''}`;
    if (compatible && (indicators.stale || indicators.error || quote.stale || quote.fallback)) {
      for (const cell of [rsi, vwap]) { const label = document.createElement('small'); label.textContent = indicators.error && !Number.isFinite(indicators.rsi) && !Number.isFinite(indicators.ytdVwap) ? 'Unavailable' : 'Cached'; cell.append(label); }
    }
    const distance = document.createElement('td'); distance.className = 'watch-indicator watch-vwap-diff';
    const diffPercent = document.createElement('span'); diffPercent.className = 'watch-vwap-diff-percent';
    const diffAmount = document.createElement('small'); diffAmount.className = 'watch-vwap-diff-amount';
    const difference = compatible && Number.isFinite(quote?.price) && Number.isFinite(indicators.ytdVwap) ? quote.price - indicators.ytdVwap : null;
    const percentDifference = difference != null && indicators.ytdVwap > 0 ? difference / indicators.ytdVwap * 100 : null;
    const validAmount = Number.isFinite(difference), validPercent = Number.isFinite(percentDifference);
    diffAmount.textContent = validAmount ? `${difference > 0 ? '+' : ''}${difference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    diffPercent.textContent = validPercent ? `${percentDifference >= 0 ? '+' : ''}${percentDifference.toFixed(2)}%` : '—';
    diffAmount.title = `Price minus estimated YTD VWAP (${quote?.currency || 'quote currency'})`;
    diffPercent.title = 'Percentage above/below estimated YTD VWAP';
    for (const [element, value] of [[diffPercent, percentDifference], [diffAmount, difference]]) {
      if (Number.isFinite(value)) element.classList.add(value >= 0 ? 'positive' : 'negative');
    }
    distance.append(diffPercent, diffAmount); distance.title = vwap.title;
    if (vwap.querySelector('small')) distance.append(vwap.querySelector('small').cloneNode(true));
    removeCell.append(remove); row.append(identityCell, data, change, rsi, vwap, distance, removeCell); table.querySelector('tbody').append(row);
  }
  const recent = $('#recent'); recent.replaceChildren(); $('#clear-recent').disabled = !currentRecent.length;
  if (!currentRecent.length) { const p = document.createElement('span'); p.className = 'empty'; p.textContent = 'Your recently opened tickers appear here.'; recent.append(p); }
  for (const symbol of currentRecent) {
    const chip = document.createElement('span'); chip.className = 'symbol'; const open = symbolButton(symbol); open.textContent = symbol; chip.append(open);
    const save = document.createElement('button'); save.type = 'button'; save.className = 'save-recent';
    const saved = currentWatchlist.includes(symbol); save.textContent = saved ? '★' : '☆'; save.disabled = saved;
    save.setAttribute('aria-label', saved ? `${symbol} already saved` : `Save ${symbol} to watchlist`);
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await request('watch', { ticker: symbol, saved: true }); await refreshLibrary(); message(`Saved ${symbol}`); }
      catch (error) { message(error.message); save.disabled = false; }
    }); chip.append(save); recent.append(chip);
  }
  if (focused) [...document.querySelectorAll('[data-open-ticker]')].find(button => button.dataset.openTicker === focused)?.focus({ preventScroll: true });
  if (focusedSort) table.querySelector(`[data-sort-key="${focusedSort}"]`)?.focus({ preventScroll: true });
  if (focusedReorder) [...container.querySelectorAll('[data-reorder-symbol]')].find(button => button.dataset.reorderSymbol === focusedReorder)?.focus({ preventScroll: true });
  renderFreshness(); scheduleFit();
  document.dispatchEvent(new CustomEvent('tickerview:library-rendered', { detail: { focusedCompare } }));
}
async function refreshLibrary() {
  const id = ++libraryGeneration;
  const result = await request('library');
  if (id !== libraryGeneration) return;
  currentWatchlist = result.watchlist; currentRecent = result.recent; snapshots = result.snapshots;
  renderLibrary();
}
function finishReorder() {
  reorderMode = false; draggedSymbol = null; renderLibrary(); $('#reorder-watchlist').focus();
}
$('#reorder-watchlist').addEventListener('click', async () => {
  if (reorderMode) { finishReorder(); return; }
  reorderBusy = true; $('#reorder-watchlist').disabled = true;
  try {
    await request('setWatchSort', { sort: 'saved' }); watchSort = 'saved'; $('#watch-sort').value = 'saved';
    $('#watch-filter').value = ''; reorderMode = true; $('#reorder-feedback').textContent = '';
  } catch (error) { $('#reorder-feedback').textContent = error.message; }
  finally { reorderBusy = false; renderLibrary(); }
});
async function moveWatch(symbol, target, position) {
  if (reorderBusy || !reorderMode || symbol === target) return;
  reorderBusy = true; renderLibrary();
  try {
    const result = await request('moveWatch', { ticker: symbol, target, position });
    currentWatchlist = result.watchlist;
    $('#reorder-feedback').textContent = `Moved ${symbol} ${position} ${target}`;
  } catch (error) { $('#reorder-feedback').textContent = error.message; await refreshLibrary().catch(() => {}); }
  finally {
    reorderBusy = false; renderLibrary();
    [...$('#watchlist').querySelectorAll('[data-reorder-symbol]')].find(button => button.dataset.reorderSymbol === symbol)?.focus({ preventScroll: true });
  }
}
function clearDropMarkers() {
  for (const row of $('#watchlist').querySelectorAll('.drop-before, .drop-after')) row.classList.remove('drop-before', 'drop-after');
}
$('#watchlist').addEventListener('dragstart', event => {
  const handle = event.target.closest('[data-reorder-symbol]');
  if (!handle || !reorderMode || reorderBusy) { event.preventDefault(); return; }
  draggedSymbol = handle.dataset.reorderSymbol;
  event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedSymbol);
});
$('#watchlist').addEventListener('dragover', event => {
  const row = event.target.closest('.watch-row');
  if (!draggedSymbol || !row || row.dataset.symbol === draggedSymbol) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearDropMarkers();
  row.classList.add(event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 'drop-before' : 'drop-after');
});
$('#watchlist').addEventListener('drop', event => {
  const row = event.target.closest('.watch-row'), symbol = draggedSymbol;
  if (!symbol || !row) return;
  event.preventDefault();
  const position = event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? 'before' : 'after';
  draggedSymbol = null; clearDropMarkers(); void moveWatch(symbol, row.dataset.symbol, position);
});
$('#watchlist').addEventListener('dragend', () => { draggedSymbol = null; clearDropMarkers(); renderLibrary(); });
$('#watchlist').addEventListener('keydown', event => {
  const symbol = event.target.dataset.reorderSymbol;
  if (!symbol || !reorderMode || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === 'ArrowUp' ? -1 : 1, target = currentWatchlist[currentWatchlist.indexOf(symbol) + direction];
  if (target) void moveWatch(symbol, target, direction === -1 ? 'before' : 'after');
});
function toggleAdd(open) {
  $('#add-symbol').hidden = !open; $('#toggle-add').setAttribute('aria-expanded', String(open));
  (open ? $('#symbol') : $('#toggle-add')).focus(); scheduleFit();
}
$('#toggle-add').addEventListener('click', () => toggleAdd($('#add-symbol').hidden));
$('#add-symbol').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggleAdd(false); }
});
$('#watch-filter').addEventListener('input', renderLibrary);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || $('#settings-dialog').open || document.body.classList.contains('research-open') || !$('#tickerview-modal').hidden) return;
  if (event.key === 'Escape' && !$('#column-tooltip').hidden) { event.preventDefault(); hideColumnHelp(); return; }
  if (event.key === 'Escape' && reorderMode && !reorderBusy) { event.preventDefault(); finishReorder(); }
  else if (event.key === 'Escape' && event.target === $('#watch-filter')) {
    event.preventDefault(); $('#watch-filter').value = ''; renderLibrary();
  } else if (event.key === '/' && !reorderMode && !event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    event.preventDefault(); $('#watch-filter').focus();
  }
});
$('#clear-filter').addEventListener('click', () => { $('#watch-filter').value = ''; renderLibrary(); $('#watch-filter').focus(); });
function showRemoval(text) {
  $('#watch-action').hidden = false; $('#watch-action span').textContent = text; scheduleFit();
}
$('#dismiss-undo').addEventListener('click', () => { lastRemoval = null; $('#watch-action').hidden = true; $('#toggle-add').focus(); scheduleFit(); });
$('#undo-remove').addEventListener('click', async () => {
  if (!lastRemoval) return;
  const removal = lastRemoval; $('#undo-remove').disabled = true;
  try {
    await request('watch', { ticker: removal.symbol, saved: true, index: removal.index });
    if (lastRemoval === removal) { lastRemoval = null; $('#watch-action').hidden = true; }
    await refreshLibrary(); $('#toggle-add').focus();
  } catch (error) { showRemoval(error.message); }
  finally { $('#undo-remove').disabled = false; }
});
$('#settings').addEventListener('change', event => {
  const input = event.target;
  const extra = input.id === 'siteEnabled' ? { site: currentSite, siteEnabled: input.checked } : { patch: input.dataset.indicator ? { indicators: [...document.querySelectorAll('[data-indicator]:checked')].map(x => x.dataset.indicator) } : { [input.id]: input.id === 'hoverDelay' ? Number(input.value) : input.checked } };
  void saveSettings(extra);
});
$('#presets').addEventListener('click', event => {
  const button = event.target.closest('[data-preset]');
  if (button) void saveSettings({ patch: { indicators: [...TickerView.presets[button.dataset.preset]] } });
});
$('#add-symbol').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const input = $('#symbol').value;
    const ticker = TickerView.resolveSymbol(input);
    if (currentWatchlist.includes(ticker)) { feedback(`${ticker} is already saved`); return; }
    feedback(`Checking ${ticker}…`);
    await request('addWatch', { ticker: input }); await refreshLibrary();
    feedback(''); $('#symbol').value = ''; toggleAdd(false);
  } catch (error) { feedback(error.message, true); }
  finally { button.disabled = false; }
});
$('#symbol').addEventListener('input', () => feedback(''));
$('#clear-recent').addEventListener('click', async () => {
  $('#clear-recent').disabled = true;
  try { await request('clearRecent'); await refreshLibrary(); message('Recent tickers cleared'); }
  catch (error) { message(error.message); $('#clear-recent').disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tickerNotes) { noteSymbols = new Set(Object.entries(changes.tickerNotes.newValue || {}).filter(([, note]) => note?.text).map(([symbol]) => symbol)); renderLibrary(); }
  if (changes.marketOverview) { overviewSnapshots = changes.marketOverview.newValue || {}; renderOverview(); }
  if (changes.dashboardPreferences) {
    const previous = dashboardPreferences; dashboardPreferences = TickerView.dashboardPreferences(changes.dashboardPreferences.newValue); renderDashboardPreferences();
    if (previous.autoRefresh !== dashboardPreferences.autoRefresh || previous.refreshInterval !== dashboardPreferences.refreshInterval) scheduleAutoRefresh(!previous.autoRefresh && dashboardPreferences.autoRefresh);
    if (previous.windowMode !== dashboardPreferences.windowMode && windowReady) void applyWindowLayout().catch(error => message(error.message));
  }
  if (changes.customAliases) { customAliases = changes.customAliases.newValue || {}; TickerView.setAliases(customAliases); renderAliases(); }
  if (changes.watchSort) { watchSort = changes.watchSort.newValue || 'saved'; if (watchSort !== 'saved') { reorderMode = false; draggedSymbol = null; } $('#watch-sort').value = watchSort; renderLibrary(); }
  if (changes.watchRefresh) {
    const progress = changes.watchRefresh.newValue;
    refreshOutcomes = retryingQuotes ? { ...refreshOutcomes, ...progress.outcomes } : progress.outcomes || {};
    $('#refresh-feedback').textContent = `Refreshed ${progress.completed}/${progress.total}`; renderLibrary();
  }
  if (changes.settings) { currentSettings = TickerView.settings(changes.settings.newValue); renderSettings(); }
  if (changes.watchlist || changes.recent || changes.quoteSnapshots) void refreshLibrary().catch(error => message(error.message));
});
(async () => {
  try {
    await request('initializeDashboardPreferences');
    const [values, tabs] = await Promise.all([chrome.storage.local.get(['settings', 'customAliases', 'watchSort', 'dashboardPreferences', 'windowBounds', 'marketOverview', 'tickerNotes']), chrome.tabs.query({ active: true, currentWindow: true }), refreshLibrary()]);
    noteSymbols = new Set(Object.entries(values.tickerNotes || {}).filter(([, note]) => note?.text).map(([symbol]) => symbol));
    dashboardPreferences = TickerView.dashboardPreferences(values.dashboardPreferences); overviewSnapshots = values.marketOverview || {}; renderDashboardPreferences(); renderOverview();
    customAliases = values.customAliases || {}; TickerView.setAliases(customAliases); renderAliases();
    watchSort = TickerView.sortModes.includes(values.watchSort) ? values.watchSort : 'saved'; $('#watch-sort').value = watchSort; renderLibrary();
    currentSettings = TickerView.settings(values.settings);
    currentSite = expanded && popupParams.get('site')
      ? supportedSite(`https://${popupParams.get('site')}/`)
      : supportedSite(tabs[0]?.url);
    renderSettings(); $('#settings').disabled = false;
    if (popupParams.get('search') === '1') $('#search-symbol').focus();
    if (expanded) { await applyWindowLayout(values.windowBounds); windowReady = true; }
    if (dashboardPreferences.autoRefresh) scheduleAutoRefresh(true); else void ensureOverview();
    message('Changes save automatically');
  } catch (error) { message(error.message); }
})();

$('#ticker-search').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const input = $('#search-symbol').value, ticker = TickerView.resolveSymbol(input);
    $('#search-feedback').textContent = ticker === TickerView.normalizeSymbol(input) ? '' : `Resolved to ${ticker}`;
    document.dispatchEvent(new CustomEvent('tickerview:open', { detail: { ticker, source: input, anchor: $('#search-symbol') } }));
  } catch (error) { $('#search-feedback').textContent = error.message; }
});
async function setSort(sort) {
  try { await request('setWatchSort', { sort }); watchSort = sort; $('#watch-sort').value = sort; renderLibrary(); }
  catch (error) { message(error.message); $('#watch-sort').value = watchSort; }
}
$('#watch-sort').addEventListener('change', event => void setSort(event.target.value));
$('#watchlist').addEventListener('click', event => {
  const key = event.target.closest('[data-sort-key]')?.dataset.sortKey; if (!key) return;
  const sort = key === 'symbol' ? watchSort === 'symbol' ? 'symbol-desc' : 'symbol' : watchSort === `${key}-desc` ? `${key}-asc` : `${key}-desc`;
  void setSort(sort);
});
$('#refresh-watchlist').addEventListener('click', () => void refreshDashboard(true));
$('#retry-quotes').addEventListener('click', () => void refreshDashboard(true, retrySymbols()));
function retrySymbols() {
  return [...new Set([...TickerView.overviewSymbols, ...currentWatchlist])].filter(symbol => {
    const quote = TickerView.overviewSymbols.includes(symbol) ? overviewSnapshots[symbol] : snapshots[symbol];
    return !Number.isFinite(quote?.price) || quote.stale || quote.fallback || refreshOutcomes[symbol]?.error || refreshOutcomes[symbol]?.stale;
  });
}
async function refreshDashboard(force = false, symbols) {
  if (dashboardBusy || document.hidden || symbols?.length === 0) return;
  retryingQuotes = !!symbols;
  const retryFocused = document.activeElement === $('#retry-quotes');
  dashboardBusy = true; lastRefreshAttempt = Date.now(); clearTimeout(autoTimer);
  const button = $('#refresh-watchlist'); button.disabled = true; button.classList.add('is-refreshing'); button.setAttribute('aria-busy', 'true'); if (!retryingQuotes) refreshOutcomes = {}; overviewRequested = true; renderCountdown();
  $('#retry-quotes').disabled = true;
  $('#refresh-feedback').textContent = retryingQuotes ? `Retrying ${symbols.length} quotes…` : 'Refreshing market overview and watchlist…';
  renderFreshness();
  try {
    const result = await request('refreshDashboard', { force, ...(symbols ? { symbols } : {}) }); refreshOutcomes = retryingQuotes ? { ...refreshOutcomes, ...result.outcomes } : result.outcomes || {}; overviewSnapshots = result.marketOverview || overviewSnapshots;
    await refreshLibrary(); renderOverview();
    const entries = Object.values(refreshOutcomes), failed = entries.filter(item => item.error || item.stale).length;
    $('#refresh-feedback').textContent = failed ? `${failed} unavailable or using cached/fallback data` : '';
  } catch (error) { $('#refresh-feedback').textContent = error.message; }
  finally { document.dispatchEvent(new CustomEvent('tickerview:dashboard-refreshed')); dashboardBusy = false; button.disabled = false; button.classList.remove('is-refreshing'); button.setAttribute('aria-busy', 'false'); renderFreshness(); scheduleAutoRefresh(); retryingQuotes = false;
    if (retryFocused && $('#retry-quotes').hidden) button.focus();
  }
}
function renderAliases() {
  const list = $('#alias-list'); list.replaceChildren();
  for (const [alias, target] of Object.entries({ ...TickerView.builtinAliases, ...customAliases }).sort(([a], [b]) => a.localeCompare(b))) {
    const row = document.createElement('div'); row.className = 'alias-row';
    const label = document.createElement('span'); label.textContent = `${alias} → ${target}${Object.hasOwn(customAliases, alias) ? ' (custom)' : ''}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit alias ${alias}`);
    edit.addEventListener('click', () => { $('#alias-key').value = alias; $('#alias-target').value = target; $('#alias-target').focus(); }); row.append(label, edit);
    if (Object.hasOwn(customAliases, alias)) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete alias ${alias}`);
      remove.addEventListener('click', () => void changeAlias('deleteAlias', { alias })); row.append(remove);
    }
    list.append(row);
  }
  $('#reset-aliases').disabled = !Object.keys(customAliases).length;
}
async function changeAlias(action, extra = {}) {
  const button = $('#alias-form button'); button.disabled = true;
  $('#alias-feedback').textContent = action === 'saveAlias' ? 'Checking Yahoo symbol…' : 'Updating aliases…';
  try {
    const result = await request(action, extra); customAliases = result.customAliases; TickerView.setAliases(customAliases); renderAliases();
    $('#alias-feedback').textContent = 'Aliases saved';
  } catch (error) { $('#alias-feedback').textContent = error.message; }
  finally { button.disabled = false; }
}
$('#alias-form').addEventListener('submit', event => { event.preventDefault(); void changeAlias('saveAlias', { alias: $('#alias-key').value, target: $('#alias-target').value }); });
$('#reset-aliases').addEventListener('click', () => void changeAlias('resetAliases'));
chrome.runtime.onMessage?.addListener(message => {
  if (message.action !== 'focusLauncher') return;
  void chrome.windows.getCurrent().then(window => {
    if (window.id !== message.windowId) return;
    currentSite = message.site ? supportedSite(`https://${message.site}/`) : null; renderSettings();
    if (message.focusSearch) {
      if ($('#settings-dialog').open) $('#settings-dialog').close();
      document.dispatchEvent(new CustomEvent('tickerview:close', { detail: { after: () => $('#search-symbol').focus() } }));
    }
  });
});

let importJSON = null, importGeneration = 0, importFileGeneration = 0, importBusy = false;
const backupFeedback = text => { $('#backup-feedback').textContent = text; };
const exportFeedback = text => { $('#export-feedback').textContent = text; };
$('#export-backup').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try {
    const { backup } = await request('exportBackup');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `tickerview-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    exportFeedback('Backup exported. It includes saved personal notes; keep the file somewhere private.');
  } catch (error) { exportFeedback(error.message); }
  finally { button.disabled = false; }
});
async function previewImport() {
  const id = ++importGeneration; $('#import-preview').hidden = true;
  if (importJSON === null) return;
  backupFeedback('Checking backup…');
  try {
    const { summary } = await request('previewImport', { json: importJSON, mode: $('#import-mode').value });
    if (id !== importGeneration) return;
    const labels = { watchlist: 'Watchlist symbols', recent: 'Recent symbols', customAliases: 'Custom aliases', tickerNotes: 'Saved notes', valuationScenarios: 'Valuation assumptions' };
    $('#import-summary').textContent = Object.entries(summary).map(([key, count]) => `${labels[key]}: ${count.incoming} in file → ${count.total} after import`).join('\n');
    $('#import-preview').hidden = false; backupFeedback('Preview ready. Nothing has been imported yet.');
  } catch (error) { if (id === importGeneration) backupFeedback(error.message); }
}
$('#import-file').addEventListener('change', async event => {
  const id = ++importFileGeneration; importGeneration++; importJSON = null; $('#import-preview').hidden = true;
  const file = event.target.files[0]; if (!file) { backupFeedback(''); return; }
  if (file.size > 2 * 1024 * 1024) { backupFeedback('Backup must be smaller than 2 MB'); return; }
  try {
    const json = await file.text(); if (id !== importFileGeneration) return;
    importJSON = json; await previewImport();
  } catch (error) { if (id === importFileGeneration) backupFeedback(error.message); }
});
$('#import-mode').addEventListener('change', () => {
  $('#import-explanation').textContent = $('#import-mode').value === 'merge'
    ? 'Keep existing entries and add the backup. Matching entries and preferences use the backup’s values.'
    : 'Replace all saved lists, aliases, notes, valuation assumptions, and preferences with this backup.';
  void previewImport();
});
$('#cancel-import').addEventListener('click', () => { importFileGeneration++; importGeneration++; importJSON = null; $('#import-file').value = ''; $('#import-preview').hidden = true; backupFeedback('Import cancelled. Nothing changed.'); });
$('#apply-import').addEventListener('click', async () => {
  if (importBusy || importJSON === null) return;
  importBusy = true;
  const controls = ['#apply-import', '#cancel-import', '#import-file', '#import-mode']; controls.forEach(selector => { $(selector).disabled = true; });
  try {
    await request('importBackup', { json: importJSON, mode: $('#import-mode').value });
    importJSON = null; importFileGeneration++; importGeneration++; $('#import-file').value = ''; $('#import-preview').hidden = true;
    refreshOutcomes = {}; await refreshLibrary(); backupFeedback('Backup imported. Changes apply to open pages automatically.');
  } catch (error) { backupFeedback(error.message); }
  finally { importBusy = false; controls.forEach(selector => { $(selector).disabled = false; }); }
});

function selectSettingsTab(name, focus = false) {
  const tab = document.querySelector(`[data-settings-tab="${name}"]`); if (!tab) return;
  for (const button of document.querySelectorAll('[data-settings-tab]')) {
    const selected = button === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
  }
  $('.settings-dialog-body').scrollTop = 0;
  if (focus) tab.focus();
}
function openSettings(tab = 'market', control) {
  selectSettingsTab(tab); if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
  (control ? document.getElementById(control) : document.querySelector(`[data-settings-tab="${tab}"]`))?.focus();
}
$('#open-settings').addEventListener('click', () => openSettings());
$('#refresh-countdown').addEventListener('click', () => openSettings('market', 'auto-refresh'));
$('.settings-tabs').addEventListener('click', event => { const name = event.target.closest('[data-settings-tab]')?.dataset.settingsTab; if (name) selectSettingsTab(name); });
$('.settings-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-settings-tab]')], index = tabs.indexOf(document.activeElement); if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  selectSettingsTab(tabs[next].dataset.settingsTab, true);
});
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());

function renderDashboardPreferences() {
  $('#auto-refresh').checked = dashboardPreferences.autoRefresh; $('#window-mode').value = dashboardPreferences.windowMode;
  $('#refresh-interval').value = dashboardPreferences.refreshInterval; $('#refresh-interval').disabled = !dashboardPreferences.autoRefresh;
  $('#auto-refresh-status').textContent = dashboardPreferences.autoRefresh ? 'On' : 'Off'; $('#auto-refresh-status').dataset.enabled = String(dashboardPreferences.autoRefresh);
  const interval = $('#refresh-interval').selectedOptions[0]?.textContent || `${dashboardPreferences.refreshInterval} seconds`;
  const summary = dashboardPreferences.autoRefresh ? `On · updates every ${interval}. Pauses when the window is hidden.` : 'Off · turn on Auto-refresh to schedule updates. Manual refresh still works.';
  if ($('#auto-refresh-summary').textContent !== summary) $('#auto-refresh-summary').textContent = summary;
  renderCountdown();
}
async function saveDashboardPreferences(patch) {
  try { await request('setDashboardPreferences', { patch }); message('Settings saved'); }
  catch (error) { message(error.message); renderDashboardPreferences(); }
}
$('#auto-refresh').addEventListener('change', event => void saveDashboardPreferences({ autoRefresh: event.target.checked }));
$('#refresh-interval').addEventListener('change', event => void saveDashboardPreferences({ refreshInterval: Number(event.target.value) }));
$('#window-mode').addEventListener('change', event => void saveDashboardPreferences({ windowMode: event.target.value }));
async function fitWindowNow() {
  await saveDashboardPreferences({ windowMode: 'fit' });
  if ($('#settings-dialog').open) $('#settings-dialog').close();
  if (expanded) await applyWindowLayout(undefined, 'fit').catch(error => message(error.message));
}
$('#fit-window').addEventListener('click', () => void fitWindowNow());
$('#fit-window-settings').addEventListener('click', () => void fitWindowNow());
function renderOverview() {
  const container = $('#market-overview'), focused = document.activeElement?.dataset.overviewSymbol; container.replaceChildren();
  const names = { SPY: 'SPY', QQQ: 'QQQ', '^VIX': 'VIX', 'BTC-USD': 'BTC' };
  for (const symbol of TickerView.overviewSymbols) {
    const quote = overviewSnapshots[symbol], button = document.createElement('button'); button.type = 'button'; button.className = 'overview-quote'; button.dataset.overviewSymbol = symbol;
    button.setAttribute('aria-label', `Open ${names[symbol]} market overview card`);
    const label = document.createElement('strong'); label.textContent = names[symbol];
    const price = document.createElement('span'); price.className = 'overview-price'; price.textContent = Number.isFinite(quote?.price) ? quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
    const change = document.createElement('small'); change.textContent = Number.isFinite(quote?.changePercent) ? `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%` : 'Unavailable';
    if (Number.isFinite(quote?.changePercent)) change.className = quote.changePercent >= 0 ? 'positive' : 'negative';
    if (quote?.stale || refreshOutcomes[symbol]?.error) { button.classList.add('overview-stale'); if (Number.isFinite(quote?.price)) change.textContent += ' · cached'; }
    button.title = `${quote?.currency || 'Quote currency'} · Quote: ${quote?.quoteTime ? new Date(quote.quoteTime * 1000).toLocaleString() : 'unavailable'} · Retrieved: ${quote?.fetchedAt ? new Date(quote.fetchedAt).toLocaleString() : 'unavailable'}${refreshOutcomes[symbol]?.error ? ` · ${refreshOutcomes[symbol].error}` : ''}`;
    button.append(label, price, change); button.addEventListener('click', () => openCard(symbol, button)); container.append(button);
  }
  if (focused) [...container.children].find(button => button.dataset.overviewSymbol === focused)?.focus({ preventScroll: true });
  renderFreshness(); scheduleFit();
}
function renderFreshness() {
  const symbols = [...new Set([...TickerView.overviewSymbols, ...currentWatchlist])];
  const quotes = symbols.map(symbol => TickerView.overviewSymbols.includes(symbol) ? overviewSnapshots[symbol] : snapshots[symbol]);
  const times = quotes.map(quote => quote?.fetchedAt).filter(time => Number.isFinite(time) && time > 0);
  const missing = quotes.filter(quote => !Number.isFinite(quote?.price)).length;
  const cached = quotes.filter((quote, i) => quote?.stale || quote?.fallback || refreshOutcomes[symbols[i]]?.error).length;
  const unknownAge = quotes.filter(quote => Number.isFinite(quote?.price) && !Number.isFinite(quote?.fetchedAt)).length;
  let text = 'Not updated yet';
  if (times.length) {
    const seconds = Math.max(0, Math.floor((Date.now() - Math.min(...times)) / 1000));
    const [count, unit] = seconds < 60 ? [seconds, 'second'] : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
    text = `Updated ${count} ${unit}${count === 1 ? '' : 's'} ago`;
  }
  const retries = retrySymbols();
  $('#retry-quotes').hidden = !retries.length; $('#retry-quotes').disabled = dashboardBusy;
  $('#retry-quotes').textContent = `Retry quotes (${retries.length})`;
  $('#dashboard-freshness').hidden = !!$('#refresh-feedback').textContent;
  $('#dashboard-freshness').textContent = text + (missing ? ` · ${missing} unavailable` : '') + (cached ? ` · ${cached} cached/failed` : '') + (unknownAge ? ` · ${unknownAge} age unknown` : '');
  renderDashboardPreferences();
}
async function ensureOverview() {
  if (overviewRequested || document.hidden) return;
  overviewRequested = true;
  try { const result = await request('overview'); overviewSnapshots = result.marketOverview || {}; Object.assign(refreshOutcomes, result.outcomes || {}); renderOverview(); }
  catch (error) { $('#dashboard-freshness').textContent = `Market overview: ${error.message}`; }
}
function renderCountdown() {
  $('#refresh-countdown').textContent = dashboardBusy ? 'Refreshing…' : !dashboardPreferences.autoRefresh ? 'Auto off · Enable' : document.hidden ? 'Paused' : nextRefreshAt === null ? 'Starting…' : `Refresh in ${Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000))}s`;
}
function scheduleAutoRefresh(immediate = false) {
  clearTimeout(autoTimer); nextRefreshAt = null;
  if (dashboardPreferences.autoRefresh && !document.hidden && !dashboardBusy) {
    const interval = dashboardPreferences.refreshInterval * 1000;
    const delay = immediate ? Math.max(0, interval - (Date.now() - lastRefreshAttempt)) : interval;
    nextRefreshAt = Date.now() + delay; autoTimer = setTimeout(() => void refreshDashboard(), delay);
  }
  renderDashboardPreferences();
}
setInterval(() => { if (!document.hidden) renderCountdown(); }, 1000);
document.addEventListener('visibilitychange', () => {
  renderDashboardPreferences();
  if (document.hidden) { clearTimeout(autoTimer); nextRefreshAt = null; renderCountdown(); }
  else if (dashboardPreferences.autoRefresh) scheduleAutoRefresh(true); else void ensureOverview();
});
setInterval(() => { if (!document.hidden) renderFreshness(); }, 10000);
function scheduleFit() {
  clearTimeout(fitTimer);
  if (windowReady && dashboardPreferences.windowMode === 'fit') fitTimer = setTimeout(() => void applyWindowLayout().catch(error => message(error.message)), 100);
}
async function applyWindowLayout(saved, mode = dashboardPreferences.windowMode) {
  if (!expanded || $('#settings-dialog').open || document.body.classList.contains('research-open') || !$('#tickerview-modal').hidden) return;
  const current = await chrome.windows.getCurrent();
  const stored = saved || (await chrome.storage.local.get('windowBounds')).windowBounds;
  const remembered = mode === 'remember' ? TickerView.windowBounds(stored) : null;
  const maxHeight = Math.max(300, Math.floor(screen.availHeight - 40)), maxWidth = Math.max(320, Math.floor(screen.availWidth));
  const width = Math.min(maxWidth, remembered?.width || Math.max(320, current.width || 480));
  if (current.width !== width) await chrome.windows.update(current.id, { width });
  await new Promise(resolve => requestAnimationFrame(resolve));
  const chromeHeight = Math.max(0, (current.height || innerHeight) - innerHeight);
  const contentHeight = Math.ceil(document.querySelector('footer').getBoundingClientRect().bottom + scrollY + 12 + chromeHeight);
  const height = Math.min(maxHeight, Math.max(300, mode === 'full' ? maxHeight : remembered?.height || contentHeight));
  const left = Math.max(screen.availLeft, Math.min(remembered?.left ?? current.left ?? screen.availLeft + screen.availWidth - width - 20, screen.availLeft + screen.availWidth - width));
  const top = Math.max(screen.availTop, Math.min(remembered?.top ?? current.top ?? screen.availTop + 20, screen.availTop + screen.availHeight - height));
  const bounds = { width, height, left: Math.floor(left), top: Math.floor(top) };
  lastAppliedBounds = bounds;
  if (current.width !== width || current.height !== height || current.left !== bounds.left || current.top !== bounds.top) await chrome.windows.update(current.id, bounds);
  await request('saveWindowBounds', { bounds });
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  if (!expanded || !windowReady) return;
  resizeTimer = setTimeout(async () => {
    try {
      const current = await chrome.windows.getCurrent();
      if (!Number.isFinite(current.width) || !Number.isFinite(current.height) || current.state && current.state !== 'normal') return;
      if (current.width === lastAppliedBounds?.width && current.height === lastAppliedBounds?.height) return;
      await request('saveWindowBounds', { bounds: current, manual: true });
    } catch { /* Keep the current window usable if bounds cannot be saved. */ }
  }, 300);
});
$('#settings-dialog').addEventListener('close', () => { if (windowReady) void applyWindowLayout().catch(error => message(error.message)); });
document.addEventListener('tickerview:closed', () => { if (windowReady) void applyWindowLayout().catch(error => message(error.message)); });
document.querySelector('#keyboard-help').addEventListener('toggle', scheduleFit);
