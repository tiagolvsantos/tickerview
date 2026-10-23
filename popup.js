const $ = selector => document.querySelector(selector);
let currentSettings = TickerView.defaults, currentWatchlist = [], currentSite = null, snapshots = {}, currentRecent = [], libraryGeneration = 0;
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
function renderLibrary() {
  const container = $('#watchlist'); container.replaceChildren();
  $('#watch-count').textContent = currentWatchlist.length;
  $('#cache-note').hidden = !currentWatchlist.length;
  if (!currentWatchlist.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Add a symbol above, or save one from a card.'; container.append(p); }
  for (const symbol of currentWatchlist) {
    const row = document.createElement('div'); row.className = 'watch-row';
    const open = symbolButton(symbol, 'watch-open'); const quote = snapshots[symbol];
    const identity = document.createElement('span'); identity.className = 'watch-identity';
    const ticker = document.createElement('strong'); ticker.textContent = symbol;
    const name = document.createElement('small'); name.textContent = quote?.name && quote.name !== symbol ? quote.name : 'Open card to load data';
    identity.append(ticker, name); open.append(identity);
    const data = document.createElement('span'); data.className = 'watch-price';
    if (Number.isFinite(quote?.price)) {
      const price = document.createElement('span'); price.textContent = `${quote.currency || ''} ${quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      const change = document.createElement('small');
      change.textContent = Number.isFinite(quote.changePercent) ? `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%` : 'Change unavailable';
      if (Number.isFinite(quote.changePercent)) change.className = quote.changePercent >= 0 ? 'positive' : 'negative';
      data.append(price, change);
      open.title = `Cached quote${quote.quoteTime ? ` · ${new Date(quote.quoteTime * 1000).toLocaleString()}` : ''}${quote.stale ? ' · stale' : ''}`;
    } else { data.textContent = 'Not viewed'; }
    open.append(data); row.append(open);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-symbol'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${symbol}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { await request('watch', { ticker: symbol, saved: false }); await refreshLibrary(); message(`Removed ${symbol}`); }
      catch (error) { message(error.message); remove.disabled = false; }
    }); row.append(remove); container.append(row);
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
}
async function refreshLibrary() {
  const id = ++libraryGeneration;
  const result = await request('library');
  if (id !== libraryGeneration) return;
  currentWatchlist = result.watchlist; currentRecent = result.recent; snapshots = result.snapshots;
  renderLibrary();
}
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
    const ticker = TickerView.normalizeSymbol($('#symbol').value);
    if (currentWatchlist.includes(ticker)) { feedback(`${ticker} is already saved`); return; }
    feedback(`Checking ${ticker}…`);
    await request('addWatch', { ticker }); await refreshLibrary();
    feedback(`Saved ${ticker}`); $('#symbol').value = ''; $('#symbol').focus();
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
  if (changes.settings) { currentSettings = TickerView.settings(changes.settings.newValue); renderSettings(); }
  if (changes.watchlist || changes.recent || changes.quoteSnapshots) void refreshLibrary().catch(error => message(error.message));
});
(async () => {
  try {
    const [values, tabs] = await Promise.all([chrome.storage.local.get('settings'), chrome.tabs.query({ active: true, currentWindow: true }), refreshLibrary()]);
    currentSettings = TickerView.settings(values.settings);
    try {
      const url = new URL(tabs[0]?.url);
      const supported = chrome.runtime.getManifest().content_scripts[0].matches.some(pattern => {
        const host = new URL(pattern.replace('*.', '')).hostname; return url.hostname === host || url.hostname.endsWith(`.${host}`);
      });
      if (url.protocol === 'https:' && supported) currentSite = url.hostname;
    } catch { /* Browser pages do not expose supported site controls. */ }
    renderSettings(); $('#settings').disabled = false;
    message(currentSite ? `Ready on ${currentSite}` : 'Open a supported site for per-site controls');
  } catch (error) { message(error.message); }
})();
