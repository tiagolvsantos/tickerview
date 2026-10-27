(() => {
  const { defaults, indicators } = TickerView;
  const popup = document.body.classList.contains('tv-popup');
  const inertElements = new Map();
  const linkAttributes = new WeakMap();
  // Resolve bundled assets while this content script still has a valid runtime.
  const logoURL = chrome.runtime.getURL('icons/icon128.png');
  // Local branded typefaces, registered only in the current document. Their unique
  // family names avoid replacing the host site's fonts; Chrome loads them on use.
  for (const [family, path, weight] of popup ? [] : [
    ['TickerView Montserrat', 'fonts/Montserrat.ttf', '100 900'],
    ['TickerView Plex', 'fonts/IBMPlexMono-Regular.ttf', '400']
  ]) {
    const face = new FontFace(family, `url("${chrome.runtime.getURL(path)}")`, { weight, display: 'swap' });
    document.fonts.add(face);
  }
  let sectionPreferences = {};
  const sectionReady = chrome.storage.local.get('cardSections').then(values => { sectionPreferences = TickerView.cardSections(values.cardSections); }).catch(() => {});
  let valuationScenarios = {};
  let settings = defaults, watchlist = [], active = false, pinned = false;
  let hoverTimer, hideTimer, scanJob, refreshTimer, anchor, state, generation = 0, chartGeneration = 0;
  let pending = new Set(), traversal = null;
  const ownNodes = new WeakSet();
  const excluded = '#tickerview-modal, .tickerview-highlight, script, style, textarea, input, select, option, pre, code, svg, [contenteditable]:not([contenteditable="false"])';
  // Bare cashtags start with a letter. Numeric symbols require an alphabetic
  // exchange suffix ($7203.T), so cash amounts like $1B and $5.8B stay plain text.
  const pattern = /\$([A-Z^][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,4})?|\d{1,10}\.[A-Z]{1,4})(?![A-Z0-9.-])/gi;
  const modal = document.createElement('div');
  modal.id = 'tickerview-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', 'TickerView stock information');
  document.body.append(modal);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const number = (value, suffix = '', digits = 2) => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix}` : 'N/A';
  const compactNumber = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value) : 'N/A';
  const safeURL = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? escape(u.href) : ''; } catch { return ''; } };
  // Some host pages enforce Trusted Types even for extension DOM sinks.
  // Only pass extension templates with escaped provider/user text to this policy.
  const htmlPolicy = globalThis.trustedTypes?.createPolicy('tickerview-card', { createHTML: html => html });
  const setHTML = (element, html) => { element.innerHTML = htmlPolicy ? htmlPolicy.createHTML(html) : html; };
  const request = async (action, extra = {}) => {
    try {
      const result = await chrome.runtime.sendMessage({ action, ...extra });
      if (!result?.success) throw new Error(result?.error || 'No response from extension');
      return result;
    } catch (error) {
      if (/context invalidated|receiving end/i.test(error.message)) throw new Error('Extension updated. Refresh this page.');
      throw error;
    }
  };
  function skip(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !element || !!element.closest(excluded) || element.isContentEditable;
  }
  function cashtag(value) {
    const matches = [...value.trim().matchAll(pattern)];
    return matches.length === 1 && matches[0][0] === value.trim() ? matches[0][1].toUpperCase() : null;
  }
  function restoreLink(link) {
    link.classList.remove('tickerview-highlight'); delete link.dataset.ticker; delete link.dataset.tvLink;
    const attrs = linkAttributes.get(link);
    if (attrs) for (const [key, value] of Object.entries(attrs)) value == null ? link.removeAttribute(key) : link.setAttribute(key, value);
    linkAttributes.delete(link);
  }
  function decorateLink(link) {
    if (!link || link.textContent.length > 24 || link.closest('#tickerview-modal, pre, code, script, style, svg, [contenteditable]:not([contenteditable="false"])')) return false;
    const ticker = cashtag(link.textContent);
    if (!ticker) return false;
    if (!link.dataset.tvLink) linkAttributes.set(link, Object.fromEntries(['aria-haspopup', 'aria-label'].map(key => [key, link.getAttribute(key)])));
    link.classList.add('tickerview-highlight'); link.dataset.tvLink = 'true'; link.dataset.ticker = ticker;
    link.setAttribute('aria-haspopup', 'dialog'); link.setAttribute('aria-label', `View ${ticker} stock information`);
    return true;
  }
  function highlight(node) {
    // TweetDeck splits a native cashtag into .hash ($) and .link-complex-target.
    // Decorate its anchor, preserving both spans and the original href.
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const link = element?.closest('a');
    if (link && !skip(link) && decorateLink(link)) return;
    if (!node.isConnected || node.nodeType !== Node.TEXT_NODE || skip(node) || !node.nodeValue.includes('$')) return;
    const text = node.nodeValue;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let index = 0;
    const addText = text => { const n = document.createTextNode(text); ownNodes.add(n); fragment.append(n); };
    for (const match of matches) {
      addText(text.slice(index, match.index));
      const span = document.createElement('span');
      span.className = 'tickerview-highlight'; span.dataset.tvOwned = 'true'; span.dataset.ticker = match[1].toUpperCase();
      span.tabIndex = 0; span.setAttribute('role', 'button'); span.setAttribute('aria-haspopup', 'dialog');
      span.setAttribute('aria-label', `View ${span.dataset.ticker} stock information`); span.textContent = match[0];
      fragment.append(span); index = match.index + match[0].length;
    }
    addText(text.slice(index)); node.replaceWith(fragment);
  }
  function enqueue(node) {
    if (!node.isConnected || ownNodes.has(node) || skip(node)) return;
    for (let p = node.parentNode; p; p = p.parentNode) if (pending.has(p)) return;
    pending.add(node);
    scheduleScan();
  }
  function scheduleScan() {
    if (scanJob != null || !active) return;
    scanJob = setTimeout(scanChunk, 16);
  }
  function scanChunk() {
    scanJob = null;
    if (!active) return;
    const start = performance.now();
    let count = 0;
    while (count++ < 250 && performance.now() - start < 6) {
      if (!traversal) {
        const root = pending.values().next().value;
        if (!root) break;
        pending.delete(root);
        if (!root.isConnected || skip(root)) continue;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: node => skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        traversal = { walker, next: root };
      }
      const node = traversal.next;
      // Advance before replacement, so the walker never gets stranded on a removed text node.
      traversal.next = traversal.walker.nextNode();
      if (node.isConnected) highlight(node);
      if (!traversal.next) traversal = null;
    }
    if (pending.size || traversal) scheduleScan();
  }
  const observer = new MutationObserver(mutations => {
    if (!active) return;
    if (!modal.isConnected && document.body) { close(); document.body.append(modal); }
    for (const m of mutations) {
      const parent = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      const link = parent?.closest('a');
      if (link?.dataset.tvLink) { restoreLink(link); if (decorateLink(link)) continue; }
      if (link && decorateLink(link)) continue;
      const owned = parent?.closest('[data-tv-owned]');
      if (owned) {
        const ticker = cashtag(owned.textContent);
        if (ticker) { owned.dataset.ticker = ticker; owned.setAttribute('aria-label', `View ${ticker} stock information`); continue; }
        const text = document.createTextNode(owned.textContent); owned.replaceWith(text); enqueue(text); continue;
      }
      if (m.type === 'characterData') { ownNodes.delete(m.target); enqueue(m.target); }
      else for (const node of m.addedNodes) enqueue(node);
    }
  });
  function applySettings() {
    const enabled = popup || settings.enabled && !settings.disabledSites.includes(location.hostname);
    modal.classList.toggle('tv-reduced', settings.reducedEffects);
    modal.classList.toggle('tv-compact', settings.compact);
    if (active !== enabled) {
      active = enabled;
      if (active && !popup) {
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        enqueue(document.body);
      } else if (!active) {
        observer.disconnect(); clearTimeout(scanJob); scanJob = null; pending.clear(); traversal = null; close();
        document.querySelectorAll('[data-tv-link]').forEach(restoreLink);
        document.querySelectorAll('[data-tv-owned]').forEach(node => node.replaceWith(document.createTextNode(node.textContent)));
      }
    }
    if (state) render();
  }
  function position() {
    if (popup || modal.hidden || pinned) return;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : { left: 16, top: 16, bottom: 16 };
    const width = modal.offsetWidth, height = modal.offsetHeight;
    const beside = rect.bottom + height + 10 > innerHeight && rect.top - height - 10 < 0 && rect.right + width + 16 <= innerWidth;
    modal.style.left = `${Math.max(8, Math.min(beside ? rect.right + 8 : rect.left, innerWidth - width - 8))}px`;
    const top = rect.bottom + height + 10 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8;
    modal.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  }
  function closeNow() {
    generation++; chartGeneration++; clearTimeout(refreshTimer); clearTimeout(hoverTimer); clearTimeout(hideTimer);
    const returnFocus = popup || modal.contains(document.activeElement), ticker = state?.ticker;
    modal.hidden = true; pinned = false; state = null; noteState = null;
    for (const [element, value] of inertElements) element.inert = value;
    inertElements.clear();
    const button = anchor?.isConnected ? anchor : popup ? [...document.querySelectorAll('[data-open-ticker]')].find(node => node.dataset.openTicker === ticker) : null; anchor = null;
    if (popup) document.dispatchEvent(new CustomEvent('tickerview:closed'));
    if (returnFocus && button?.isConnected) button.focus({ preventScroll: true });
  }
  let noteState = null, leavePending = null;
  const noteDirty = () => noteState && noteState.text !== noteState.saved;
  function renderNote() {
    const box = modal.querySelector('.tv-note');
    if (!box || !noteState) return;
    const input = box.querySelector('textarea');
    if (input.value !== noteState.text) input.value = noteState.text;
    input.disabled = !noteState.ready || noteState.saving;
    box.querySelector('[data-action="note-save"]').disabled = !noteState.ready || noteState.saving;
    box.querySelector('.tv-note-status').textContent = noteState.message || (noteDirty() ? 'Unsaved changes' : noteState.saved ? 'Saved locally' : 'Local only · 4,000 characters maximum');
    box.querySelector('.tv-note-conflict').hidden = !noteState.conflict;
  }
  async function readNote(ticker) {
    const current = noteState;
    try {
      const result = await request('getNote', { ticker });
      if (noteState !== current) return;
      const note = result.note || { text: '', revision: null };
      Object.assign(current, { text: note.text, saved: note.text, revision: note.revision, ready: true }); renderNote();
    } catch (error) { if (noteState === current) { current.message = error.message; renderNote(); } }
  }
  async function saveNote(overwrite = false) {
    const current = noteState, ticker = state?.ticker;
    if (!current?.ready || current.saving) return false;
    current.saving = true; current.message = 'Saving…'; renderNote();
    try {
      const revision = overwrite && current.conflict ? current.remote.revision : current.revision;
      const result = await request('saveNote', { ticker, text: current.text, revision });
      if (noteState !== current) return false;
      if (result.conflict) {
        current.conflict = true; current.remote = result.note; current.message = 'This note changed in another window. Reload it or explicitly overwrite it.'; return false;
      }
      current.saved = current.text; current.revision = result.note.revision; current.conflict = false; current.message = 'Saved locally'; return true;
    } catch (error) { current.message = error.message; return false; }
    finally { current.saving = false; if (noteState === current) renderNote(); }
  }
  async function mayLeave() {
    if (!noteDirty()) return !noteState?.saving;
    if (leavePending) return false;
    const prompt = modal.querySelector('.tv-note-prompt'); prompt.hidden = false;
    modal.querySelector('.tv-note').open = true;
    prompt.querySelector('button').focus();
    return new Promise(resolve => { leavePending = resolve; });
  }
  async function close(after) {
    if (!await mayLeave()) return;
    closeNow(); if (typeof after === 'function') after();
  }
  async function openTicker(input, target, keyboard = false, canonical = false, source = input) {
    let ticker;
    try { ticker = canonical ? TickerView.normalizeSymbol(input) : TickerView.resolveSymbol(input); } catch { return; }
    await sectionReady;
    if (!await mayLeave()) return;
    clearTimeout(hoverTimer); clearTimeout(hideTimer);
    pinned = false; anchor = target; chartIdentity = null;
    void load(ticker, true, source);
    position(); pinned = keyboard || popup;
    const button = modal.querySelector('[data-action="pin"]');
    button.textContent = pinned ? 'Unpin' : 'Pin'; button.setAttribute('aria-pressed', String(pinned));
    if (popup) document.dispatchEvent(new CustomEvent('tickerview:opened', { detail: { ticker } }));
    if (popup && !document.body.classList.contains('tv-research-enabled')) {
      modal.setAttribute('aria-modal', 'true');
      for (const element of document.body.children) if (element !== modal && !inertElements.has(element)) { inertElements.set(element, element.inert); element.inert = true; }
    }
    if (keyboard || popup) modal.querySelector('[data-action="close"]').focus();
  }
  modal.addEventListener('input', event => {
    if (!event.target.matches('.tv-note textarea') || !noteState) return;
    noteState.text = event.target.value; noteState.message = ''; pinned = true;
    const pin = modal.querySelector('[data-action="pin"]'); pin.textContent = 'Unpin'; pin.setAttribute('aria-pressed', 'true'); renderNote();
  });
  modal.addEventListener('click', async event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'note-save' || action === 'note-overwrite') { await saveNote(action === 'note-overwrite'); return; }
    if (action === 'note-reload' && noteState?.remote) {
      const remote = noteState.remote;
      Object.assign(noteState, { text: remote.text, saved: remote.text, revision: remote.revision, conflict: false, message: 'Reloaded saved note' }); renderNote(); return;
    }
    if (!['note-leave-save', 'note-discard', 'note-cancel'].includes(action) || !leavePending) return;
    if (action === 'note-leave-save' && !await saveNote()) {
      const resolve = leavePending; leavePending = null; modal.querySelector('.tv-note-prompt').hidden = true; modal.querySelector(noteState.conflict ? '[data-action="note-reload"]' : '.tv-note textarea').focus(); resolve(false); return;
    }
    const resolve = leavePending; leavePending = null; modal.querySelector('.tv-note-prompt').hidden = true;
    if (action === 'note-discard') { noteState.text = noteState.saved; renderNote(); }
    if (action === 'note-cancel') modal.querySelector('.tv-note textarea').focus();
    resolve(action !== 'note-cancel');
  });
  if (popup) document.addEventListener('tickerview:close', event => void close(event.detail?.after));
  window.addEventListener('beforeunload', event => { if (noteDirty()) { event.preventDefault(); event.returnValue = ''; } });
  function hideLater(delay = 300) {
    clearTimeout(hoverTimer); clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!noteDirty() && !pinned && !modal.matches(':hover') && !modal.contains(document.activeElement)) close(); }, delay);
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!modal.hidden && !document.hidden) refreshTimer = setTimeout(() => { if (state) void load(state.ticker, false); }, 60000);
  }
  async function load(ticker, fresh = true, source = ticker) {
    const id = ++generation;
    if (fresh) {
      chartGeneration++;
      noteState = { text: '', saved: '', revision: null, ready: false, saving: false };
      state = { ticker, source, quote: {}, range: '1D', chart: null, loading: new Set(['base', 'technicals', 'details']), errors: {}, statuses: {}, issues: [] };
      modal.hidden = false; shell();
      void readNote(ticker);
      void request('recent', { ticker }).catch(() => {});
    } else { state.loading = new Set(['base', 'technicals', 'details']); state.errors = {}; }
    const same = () => id === generation && state?.ticker === ticker && !modal.hidden;
    await Promise.all(['base', 'technicals', 'details'].map(async action => {
      try {
        const result = await request(action, { ticker });
        if (!same()) return;

        if (action === 'base') {
          state.base = result;
          if (state.range === '1D') state.chart = result.chart;
        }
        if (action === 'technicals') state.tech = result;
        if (action === 'details') state.detail = result;
        if (result.status) state.statuses[action] = result.status;
        if (result.benchmarks) state.benchmarks = result.benchmarks;
        if (result.sources) state.sources = result.sources;
        if (result.issues) state.issues = result.issues;
      } catch (error) { if (same()) state.errors[action] = error.message; }
      finally { if (same()) { state.loading.delete(action); render(); } }
    }));
    if (same()) scheduleRefresh();
  }
  function savedAssumptions(ticker) {
    try { return TickerView.valuationAssumptions(valuationScenarios[ticker]); }
    catch { return { ...TickerView.valuationDefaults }; }
  }
  function renderValuation(q) {
    const assumptions = savedAssumptions(state.ticker);
    const form = modal.querySelector('.tv-valuation-form');
    if (!state.valuationDirty) for (const key of ['bear', 'base', 'bull']) form.elements[key].value = assumptions[key];
    const model = TickerView.valuation(q, assumptions);
    const price = value => `${escape(q.currency || '')} ${number(value)}`;
    const delta = value => value == null ? 'Comparison unavailable' : `${value > 0 ? '+' : ''}${number(value, '%')} vs quote`;
    let html = '<p class="tv-valuation-note">EPS × assumed P/E · scenario estimates, not a price forecast.</p>';
    const saved = Object.hasOwn(valuationScenarios, state.ticker);
    html += `<p class="tv-valuation-note">${saved ? 'Your saved assumptions' : 'Illustrative examples: 15× / 20× / 25× for every stock; not stock-specific fair multiples.'}</p>`;
    if (model.scenarios.length) {
      const values = [...model.scenarios.map(item => item.value), q.regularMarketPrice];
      const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(1, max * .1);
      const pos = value => 5 + (value - min) / span * 90;
      html += `<div class="tv-value-track" role="img" aria-label="Earnings scenario range and current quote">${model.scenarios.map(item => `<span style="left:${pos(item.value)}%" title="${item.key}: ${price(item.value)}"></span>`).join('')}<span class="tv-value-current" style="left:${pos(q.regularMarketPrice)}%" title="Current quote: ${price(q.regularMarketPrice)}"></span></div>`;
      html += `<div class="tv-value-cells">${model.scenarios.map(item => `<div data-scenario="${item.key}"><span>${item.key[0].toUpperCase() + item.key.slice(1)} · ${number(item.multiple)}×</span><strong>${price(item.value)}</strong><small>${delta(item.difference)}</small></div>`).join('')}</div>`;
      const base = model.scenarios[1].value, gap = (q.regularMarketPrice / base - 1) * 100;
      html += `<p class="tv-valuation-note">Quote ${price(q.regularMarketPrice)} is ${number(Math.abs(gap), '%')} ${gap >= 0 ? 'above' : 'below'} the base estimate. EPS (TTM): ${price(q.fundamentals.trailingEps)}.</p>`;
    } else html += `<p class="tv-valuation-note">${state.loading.has('base') || state.loading.has('details') ? 'Loading value estimate…' : escape(model.reason)}</p>`;
    html += '<div class="tv-analyst-comparison"><strong>Analyst targets · separate provider opinions</strong>';
    if (model.targets.length) {
      const ratings = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', strong_sell: 'Strong sell' };
      const rating = ratings[q.recKey] || (typeof q.recKey === 'string' ? q.recKey.replaceAll('_', ' ') : '');
      html += `<p class="tv-valuation-note">${Number.isFinite(q.analystCount) ? `${number(q.analystCount, '', 0)} analysts` : 'Analyst count unavailable'}${rating ? ` · ${escape(rating)}` : ''} · snapshot</p>`;
      if (model.targets.some(item => item.label === 'Low') && model.targets.some(item => item.label === 'High')) {
        const markers = model.targets.map(item => ({ label: item.label, value: item.value }));
        if (Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0) markers.push({ label: 'Price', value: q.regularMarketPrice });
        const min = Math.min(...markers.map(item => item.value)) * .95;
        const max = Math.max(...markers.map(item => item.value)) * 1.05;
        const description = markers.map(item => `${item.label}: ${price(item.value)}`).join(' · ');
        html += `<div class="tv-targets"><div class="tv-target-track" role="img" aria-label="Analyst target range · ${description}">${markers.map(item => `<span style="left:${Math.max(0, Math.min(100, (item.value - min) / (max - min || 1) * 100))}%" title="${item.label}: ${price(item.value)}"></span>`).join('')}</div></div>`;
      }
      html += `<div class="tv-value-cells">${model.targets.map(item => `<div data-target="${item.label.toLowerCase()}"><span>${item.label}</span><strong>${price(item.value)}</strong><small>${delta(item.difference)}</small></div>`).join('')}</div>`;
    } else html += `<p class="tv-valuation-note">${state.loading.has('details') ? 'Loading analyst targets…' : 'Comparable analyst targets are unavailable for this instrument.'}</p>`;
    html += '</div>';
    if (state.sources?.profile) html += `<p class="tv-valuation-note">Fundamentals: ${escape(new Date(state.sources.profile.fetchedAt).toLocaleString())}${state.sources.profile.stale ? ' · STALE cache' : ''}</p>`;
    if (state.statuses.base?.stale || q.quoteTime && Date.now() / 1000 - q.quoteTime > 900) html += '<p class="tv-valuation-note">Quote is cached or more than 15 minutes old; comparisons use the displayed quote.</p>';
    setHTML(modal.querySelector('.tv-valuation-output'), html);
  }
  async function saveValuation(reset = false) {
    const current = state, form = modal.querySelector('.tv-valuation-form');
    if (!current || current.valuationSaving) return;
    const feedback = form.querySelector('.tv-valuation-feedback');
    try {
      const assumptions = reset ? null : TickerView.valuationAssumptions(Object.fromEntries(['bear', 'base', 'bull'].map(key => [key, Number(form.elements[key].value)])));
      current.valuationSaving = true;
      for (const button of form.querySelectorAll('button')) button.disabled = true;
      const result = await request(reset ? 'resetValuation' : 'saveValuation', { ticker: current.ticker, assumptions });
      valuationScenarios = result.valuationScenarios;
      if (state !== current || modal.hidden) return;
      current.valuationDirty = false; renderValuation(current.quote);
      feedback.textContent = reset ? 'Reset to illustrative examples.' : 'Assumptions saved on this browser.';
    } catch (error) { if (state === current) feedback.textContent = error.message; }
    finally { current.valuationSaving = false; for (const button of form.querySelectorAll('button')) button.disabled = false; }
  }
  modal.addEventListener('input', event => {
    if (state && event.target.closest('.tv-valuation-form')) {
      state.valuationDirty = true;
      modal.querySelector('.tv-valuation-feedback').textContent = 'Unsaved changes. Apply to update the estimates.';
    }
  });
  modal.addEventListener('submit', event => {
    if (!event.target.matches('.tv-valuation-form')) return;
    event.preventDefault(); void saveValuation();
  });
  function applySectionPreferences() {
    for (const key of TickerView.cardSectionKeys) {
      const section = modal.querySelector(`details.tv-${key}`);
      if (key === 'note' && (noteDirty() || leavePending)) continue;
      if (section && Object.hasOwn(sectionPreferences, key)) section.open = sectionPreferences[key];
    }
  }
  function shell() {
    setHTML(modal, `
      <div class="tv-chrome">
      <div class="tv-brand"><img src="${escape(logoURL)}" alt="Cerberus logo" width="32" height="32"><div class="tv-brand-copy"><span class="tv-brand-name">CERBERUS</span><span class="tv-brand-product">TickerView</span></div><span class="tv-brand-tag">MARKET INTELLIGENCE</span></div>
      <div class="tv-toolbar"><button type="button" data-action="pin" aria-pressed="false">Pin</button><button type="button" data-action="watch">Save</button><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="close" aria-label="Close stock information">×</button></div></div>
      <div class="tv-summary" aria-live="polite"></div><div class="tv-freshness"></div>
      <div class="tv-timeframes" role="group" aria-label="Chart timeframe">${['1D', '5D', '1M', '6M', '1Y'].map(range => `<button type="button" data-range="${range}" aria-pressed="${range === '1D'}">${range}</button>`).join('')}</div>
      <div class="tv-chart" tabindex="0" role="group" aria-label="Price chart. Use left and right arrow keys to inspect points."></div><div class="tv-chart-readout" aria-live="polite">Loading chart…</div>
      <details class="tv-note"><summary>Personal note</summary><label for="tv-note-text">Your note for this ticker</label><textarea id="tv-note-text" maxlength="4000" rows="4" disabled></textarea>
      <button type="button" data-action="note-save" disabled>Save note</button><p class="tv-note-status" role="status">Loading note…</p>
      <div class="tv-note-conflict" hidden><button type="button" data-action="note-reload">Reload saved note</button><button type="button" data-action="note-overwrite">Overwrite saved note</button></div>
      <div class="tv-note-prompt" role="group" aria-label="Unsaved note" hidden><p>Save your note before leaving?</p><button type="button" data-action="note-leave-save">Save and continue</button><button type="button" data-action="note-discard">Discard</button><button type="button" data-action="note-cancel">Cancel</button></div></details>
      <div class="tv-stats-grid"></div>
      <details class="tv-valuation" open><summary>Value estimate</summary><div class="tv-valuation-output"></div>
      <details class="tv-assumptions"><summary>Edit P/E assumptions</summary><form class="tv-valuation-form" novalidate>
      <div class="tv-valuation-inputs">${['bear', 'base', 'bull'].map(key => `<label>${key[0].toUpperCase() + key.slice(1)} P/E<input name="${key}" aria-label="${key[0].toUpperCase() + key.slice(1)} P/E" type="number" min="0.01" max="200" step="any" required></label>`).join('')}</div>
      <div class="tv-valuation-buttons"><button type="submit">Apply</button><button type="button" data-action="valuation-reset">Reset to examples</button></div><p class="tv-valuation-feedback" role="status"></p></form></details></details>
      <details class="tv-fundamentals" open><summary>Fundamentals</summary><div class="tv-fundamentals-body"></div></details><div class="tv-extras"></div>
      <details class="tv-news"><summary>News and sentiment</summary><div class="tv-news-body"></div></details>
      <details class="tv-guide"><summary>Indicator guide</summary><p>RS compares session returns in percentage points, only for matching market dates. Volume / avg day compares current session volume with the prior 50 full sessions; it is not time-of-day RVOL. ATR uses Wilder smoothing. VWAP is a close × volume estimate from five-minute regular-session bars. Daily indicators combine cached history with the current intraday session when available. History and profile retrieval times appear on the card. Sentiment uses headline keywords, ignores articles older than 48 hours, and fades toward neutral with age.</p></details>
      <div class="tv-messages" role="status"></div><nav class="tv-research-dock" aria-label="Research links"></nav>`);
    applySectionPreferences();
    for (const key of TickerView.cardSectionKeys) {
      const section = modal.querySelector(`details.tv-${key}`);
      section?.querySelector('summary').addEventListener('click', () => {
        setTimeout(() => {
          if (!section.isConnected) return;
          sectionPreferences[key] = section.open;
          void request('setCardSection', { section: key, open: section.open }).catch(error => {
            const status = modal.querySelector('.tv-messages');
            if (status) status.textContent = error.message;
          });
        }, 0);
      });
    }
    render();
  }
  function render() {
    if (!state || modal.hidden) return;
    const techMatches = state.base && state.tech?.sessionDate === state.base.quote.sessionDate;
    const q = state.quote = { ...state.base?.quote, ...(techMatches ? state.tech.quote : {}), ...state.detail?.quote };
    const money = value => `${escape(q.currency || '')} ${number(value)}`;
    const change = q.regularMarketChangePercent;
    const color = change == null ? '' : change >= 0 ? 'tv-positive' : 'tv-negative';
    const changeText = q.regularMarketChange != null && change != null ? `${number(q.regularMarketChange)} (${number(change, '%')})` : change != null ? number(change, '%') : q.regularMarketChange != null ? number(q.regularMarketChange) : 'Change unavailable';
    setHTML(modal.querySelector('.tv-summary'), `<div><strong class="tv-symbol">$${escape(q.symbol || state.ticker)}</strong><div class="tv-fullname">${escape(q.longName || '')}</div><div class="tv-company-context">${escape(q.sector || '')}${q.industry ? ` · ${escape(q.industry)}` : ''}</div></div><div class="tv-price-section"><strong class="tv-price">${q.regularMarketPrice == null ? state.loading.has('base') ? 'Loading…' : 'N/A' : money(q.regularMarketPrice)}</strong><div class="${color}">${changeText}</div></div>`);
    if (state.source && TickerView.normalizeSymbol(state.source) !== state.ticker) { const resolved = document.createElement('div'); resolved.className = 'tv-company-context'; resolved.textContent = `Resolved from ${state.source}`; modal.querySelector('.tv-summary > div').append(resolved); }
    const quoteDate = q.quoteTime ? new Date(q.quoteTime * 1000).toLocaleString() : 'unavailable';
    const oldQuote = q.quoteTime && Date.now() / 1000 - q.quoteTime > 15 * 60;
    const quoteNote = state.statuses.base?.stale ? ' · STALE cache' : oldQuote ? q.marketState === 'regular' ? ' · STALE / last available' : ' · Last regular-session quote' : '';
    modal.querySelector('.tv-freshness').textContent = `${q.exchange || ''} · ${q.currency || ''} · ${q.marketState || 'session unknown'} · Quote: ${quoteDate}${quoteNote}${state.statuses.base?.fallback ? ' · Daily fallback' : ''}`;
    const watchButton = modal.querySelector('[data-action="watch"]');
    // Share-class normalization must agree with the service worker.
    const savedSymbol = (q.symbol || state.ticker).replace(/^([A-Z]+)\.([AB])$/, '$1-$2');
    watchButton.textContent = watchlist.includes(savedSymbol) ? 'Saved ★' : 'Save ☆';
    watchButton.setAttribute('aria-pressed', String(watchlist.includes(savedSymbol)));
    const bench = state.benchmarks;
    q.relStrength = bench?.spy?.date === q.sessionDate && change != null && bench.spy.change != null ? change - bench.spy.change : null;
    q.relStrengthSector = bench?.sector?.date === q.sessionDate && change != null && bench.sector.change != null ? change - bench.sector.change : null;
    const percentages = new Set(['relStrength', 'relStrengthSector', 'atrPct', 'vwapDist', 'dist200', 'bbPct', 'adrPct', 'gapPct', 'shortFloatPct']);
    const missing = [];
    setHTML(modal.querySelector('.tv-stats-grid'), settings.indicators.map(key => {
      const value = q[key];
      const loading = ['marketCap', 'shortFloatPct', 'shortRatio'].includes(key) ? state.loading.has('details') : ['vwap', 'vwapDist', 'regularMarketVolume', 'fiftyTwoWeekRange'].includes(key) ? state.loading.has('base') : key.startsWith('relStrength') ? state.loading.has('details') || state.loading.has('base') || state.loading.has('technicals') : state.loading.has('technicals');
      if (value == null && !loading) { missing.push(indicators[key]); return ''; }
      const formatted = ['marketCap', 'regularMarketVolume'].includes(key) ? compactNumber(value) : typeof value === 'string' ? escape(value) : number(value, percentages.has(key) ? key.startsWith('relStrength') ? ' pp' : '%' : key === 'rvol' ? '×' : '');
      return `<div class="tv-stat-item" data-indicator="${key}"><span class="tv-stat-label">${escape(key === 'relStrengthSector' && q.sectorEtf ? `RS vs ${q.sectorEtf}` : indicators[key])}</span><span class="tv-stat-value">${value == null && loading ? '…' : formatted}</span></div>`;
    }).join(''));
    const nonEquityInstrument = ['INDEX', 'CRYPTOCURRENCY', 'CURRENCY', 'FUTURE'].includes(q.instrumentType) || state.ticker.startsWith('^') || /-USD$/.test(state.ticker);
    const fundamentals = nonEquityInstrument ? {} : q.fundamentals || {};
    const fundamentalFields = [
      ['trailingPE', 'P/E (TTM)', 'ratio'], ['forwardPE', 'Forward P/E', 'ratio'],
      ['priceToSales', 'Price / sales (TTM)', 'ratio'], ['priceToBook', 'Price / book', 'ratio'],
      ['enterpriseToEbitda', 'EV / EBITDA', 'ratio'], ['trailingEps', 'EPS (TTM)', 'eps'],
      ['revenue', 'Revenue (TTM)', 'cash'], ['revenueGrowth', 'Revenue growth (YoY)', 'percent'],
      ['earningsGrowth', 'Earnings growth (YoY)', 'percent'], ['profitMargin', 'Net margin', 'percent'],
      ['operatingMargin', 'Operating margin', 'percent'], ['returnOnEquity', 'Return on equity', 'percent'],
      ['freeCashFlow', 'Free cash flow', 'cash'], ['totalCash', 'Total cash', 'cash'], ['totalDebt', 'Total debt', 'cash']
    ].filter(([key]) => Number.isFinite(fundamentals[key]));
    const fundamentalsBody = modal.querySelector('.tv-fundamentals-body');
    setHTML(fundamentalsBody, fundamentalFields.length ? `<div class="tv-stats-grid">${fundamentalFields.map(([key, label, format]) => {
      const value = fundamentals[key];
      const currency = format === 'cash' ? fundamentals.currency : fundamentals.quoteCurrency || q.currency;
      const formatted = format === 'percent' ? number(value * 100, '%') : format === 'cash' ? compactNumber(value) : number(value, format === 'ratio' ? '×' : '');
      return `<div class="tv-stat-item" data-fundamental="${key}"><span class="tv-stat-label">${label}</span><span class="tv-stat-value">${['cash', 'eps'].includes(format) ? `${escape(currency || 'Currency unreported')} ` : ''}${formatted}</span></div>`;
    }).join('')}</div><p class="tv-missing">Provider snapshot · TTM = trailing 12 months. Growth compares with the prior year. Unreported fields are omitted.${fundamentals.fiscalYearEnd ? ` Latest fiscal year ended ${escape(new Date(fundamentals.fiscalYearEnd * 1000).toISOString().slice(0, 10))}.` : ''}</p>` : `<p class="tv-missing">${state.loading.has('details') ? 'Loading fundamentals…' : nonEquityInstrument ? 'Company fundamentals do not apply to this instrument.' : state.sources?.profile ? 'The provider does not publish company fundamentals for this instrument.' : 'Fundamentals could not be loaded. Use Refresh to retry.'}</p>`);
    renderValuation(q);
    let extras = '';
    if (q.earningsTimestamp) {
      const day = time => new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
      const earningsDay = day(q.earningsTimestamp * 1000);
      const days = Math.round((Date.parse(earningsDay) - Date.parse(day(Date.now()))) / 86400000);
      const label = days === 0 ? 'TODAY' : days === -1 ? 'Just reported yesterday' : days < 0 ? `${-days} days ago` : `in ${days} days`;
      extras += `<p${days >= 0 && days <= 7 ? ' class="tv-earnings-soon"' : ''}>Earnings: ${escape(earningsDay)} · ${label} (provider estimate)</p>`;
    }
    else if (q.earningsDate) extras += `<p>Earnings: ${escape(q.earningsDate)}</p>`;
    if (q.extendedPrice != null) extras += `<p>Extended: ${money(q.extendedPrice)}${q.extendedTime ? ` · ${escape(new Date(q.extendedTime * 1000).toLocaleString())}` : ''} · profile snapshot</p>`;
    if (q.shortInterestTimestamp && (q.shortFloatPct != null || q.shortRatio != null)) extras += `<p class="tv-missing">Short interest reported: ${escape(new Date(q.shortInterestTimestamp * 1000).toLocaleDateString())}</p>`;
    if (missing.length) extras += `<p class="tv-missing">Unavailable: ${escape(missing.join(', '))}.</p>`;
    const dates = [['Daily history', state.statuses.technicals], [state.sources?.profile?.provider ? `Fundamentals (${state.sources.profile.provider})` : 'Fundamentals', state.sources?.profile], ['News', state.sources?.news], ['SPY', state.sources?.spy], ['Sector', state.sources?.sector]].filter(([,v]) => v);
    extras += `<div class="tv-source-dates">${dates.map(([label, s]) => `${label}: ${new Date(s.fetchedAt).toLocaleString()}${s.stale ? ' (stale)' : ''}`).map(escape).join('<br>')}</div>`;
    setHTML(modal.querySelector('.tv-extras'), extras);
    const sentiment = q.categorySentiment;
    const news = modal.querySelector('.tv-news');
    news.querySelector('summary').textContent = `News and sentiment · ${sentiment?.total.label || (state.loading.has('details') ? 'Loading…' : 'Unavailable')}`;
    setHTML(news.querySelector('.tv-news-body'), sentiment ? `<p>Headline heuristic · ${sentiment.total.count} fresh articles · score ${number(sentiment.total.score)}</p><p>${['corporate', 'macro', 'regulation', 'retail'].map(cat => `${cat}: ${sentiment[cat].label} (${sentiment[cat].count})`).map(escape).join(' · ')}</p>${sentiment.items.map(item => {
      const url = safeURL(item.url);
      return `<article>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}<div>${item.time ? escape(new Date(item.time * 1000).toLocaleString()) : 'Time unknown'} · weight ${number(item.decay)} · score ${number(item.score)}<br>Matched: ${escape(item.matched.join(', ') || 'none')}</div></article>`;
    }).join('') || '<p>No matching headlines available.</p>'}` : '<p>News unavailable.</p>');
    modal.querySelector('.tv-messages').textContent = [...Object.values(state.errors), ...state.issues, ...Object.entries(state.statuses).filter(([, v]) => v.stale).map(([name]) => `${name}: cached data; refresh failed`), state.loading.size ? `Loading ${[...state.loading].join(', ')}…` : ''].filter(Boolean).join(' · ');
    const symbol = encodeURIComponent(q.symbol || state.ticker);
    const nonEquity = q.instrumentType && !['EQUITY', 'ETF'].includes(q.instrumentType) || state.ticker.startsWith('^') || /-USD$/.test(state.ticker);
    setHTML(modal.querySelector('.tv-research-dock'), [['Yahoo Finance', `https://finance.yahoo.com/quote/${symbol}/`], ...(!nonEquity ? [['TradingView', `https://www.tradingview.com/chart/?symbol=${symbol}`], ['Finviz', `https://finviz.com/quote.ashx?t=${symbol}`], ['Insider', `https://openinsider.com/search?q=${symbol}`]] : [])].map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`).join(''));
    drawChart(); position();
  }
  let chartIndex = 0, chartIdentity;
  function drawChart() {
    const container = modal.querySelector('.tv-chart');
    const points = state.chart?.points || [];
    if (state.chart && state.chart === chartIdentity) return;
    chartIdentity = state.chart;
    if (points.length < 2) { container.textContent = state.loading.has('base') ? 'Loading chart…' : 'No chart data'; return; }
    const prices = points.map(p => p.close), min = Math.min(...prices), range = Math.max(...prices) - min || 1;
    const maxVol = Math.max(1, ...points.map(p => p.volume || 0));
    const coords = points.map((p, i) => `${i / (points.length - 1) * 300},${75 - (p.close - min) / range * 65}`);
    const volumes = points.map((p, i) => `<rect x="${i / (points.length - 1) * 300}" y="${98 - (p.volume || 0) / maxVol * 20}" width="${Math.max(.5, 280 / points.length)}" height="${(p.volume || 0) / maxVol * 20}" class="tv-volume-bar"/>`).join('');
    setHTML(container, `<svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">${volumes}<polyline points="${coords.join(' ')}" fill="none" class="tv-chart-line" stroke-width="1.5"/><line class="tv-crosshair" y1="0" y2="100" stroke-dasharray="3 3"/></svg>`);
    chartIndex = points.length - 1; inspectChart(chartIndex);
  }
  function inspectChart(index) {
    const points = state?.chart?.points || [], p = points[index];
    if (!p) return;
    chartIndex = index;
    const line = modal.querySelector('.tv-crosshair');
    if (line) { const x = index / (points.length - 1) * 300; line.setAttribute('x1', x); line.setAttribute('x2', x); }
    let time;
    try { time = new Date(p.time * 1000).toLocaleString(undefined, { timeZone: state.chart.timezone }); }
    catch { time = new Date(p.time * 1000).toLocaleString(); }
    modal.querySelector('.tv-chart-readout').textContent = `${time} (${state.chart.timezone}) · ${state.quote.currency || ''} ${number(p.close)} · Vol ${compactNumber(p.volume)} · ${state.chart.interval}`;
  }
  async function selectRange(range) {
    if (!state) return;
    state.range = range;
    const id = ++chartGeneration, ticker = state.ticker;
    modal.querySelectorAll('[data-range]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === range)));
    modal.querySelector('.tv-chart-readout').textContent = `Loading ${range}…`;
    try {
      const result = await request('chart', { ticker, range });
      if (id !== chartGeneration || !state || ticker !== state.ticker) return;
      state.chart = result.chart; drawChart();
      if (result.status.stale) modal.querySelector('.tv-chart-readout').textContent += ' · STALE cache';
    } catch (error) { if (id === chartGeneration && state) modal.querySelector('.tv-chart-readout').textContent = `${range}: ${error.message} · Previous chart retained`; }
  }
  modal.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !state) return;
    if (button.dataset.range) { void selectRange(button.dataset.range); return; }
    const action = button.dataset.action;
    if (action === 'valuation-reset') { void saveValuation(true); return; }
    if (action === 'close') close();
    if (action === 'pin') { pinned = !pinned; button.textContent = pinned ? 'Unpin' : 'Pin'; button.setAttribute('aria-pressed', String(pinned)); position(); }
    if (action === 'refresh') void load(state.ticker, false);
    if (action === 'watch') {
      button.disabled = true;
      try { const result = await request('watch', { ticker: state.ticker }); watchlist = result.watchlist; render(); }
      catch (error) { if (state) modal.querySelector('.tv-messages').textContent = error.message; }
      finally { button.disabled = false; }
    }
  });
  modal.addEventListener('pointermove', event => {
    const chart = event.target.closest('.tv-chart');
    if (!chart || !state?.chart) return;
    const rect = chart.getBoundingClientRect(), count = state.chart.points.length;
    inspectChart(Math.max(0, Math.min(count - 1, Math.round((event.clientX - rect.left) / rect.width * (count - 1)))));
  });
  modal.addEventListener('keydown', event => {
    if (event.target.closest('.tv-chart') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); inspectChart(Math.max(0, Math.min((state.chart?.points.length || 1) - 1, chartIndex + (event.key === 'ArrowLeft' ? -1 : 1))));
    }
  });
  modal.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  modal.addEventListener('mouseleave', () => hideLater());
  modal.addEventListener('focusout', () => hideLater());
  modal.addEventListener('toggle', position, true);
  document.addEventListener('mouseover', event => {
    const target = event.target.closest?.('.tickerview-highlight');
    if (!active || !target || pinned || target.contains(event.relatedTarget)) return;
    clearTimeout(hideTimer); clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const ticker = target.isConnected && cashtag(target.textContent);
      if (ticker) void openTicker(ticker, target);
    }, settings.hoverDelay);
  }, true);
  document.addEventListener('mouseout', event => { const target = event.target.closest?.('.tickerview-highlight'); if (target && !target.contains(event.relatedTarget)) hideLater(400); }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) { event.preventDefault(); close(); return; }
    const target = event.target.closest?.('.tickerview-highlight');
    if (active && target && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); clearTimeout(hoverTimer); clearTimeout(hideTimer);
      void openTicker(target.dataset.ticker, target, true);
    }
  });
  window.addEventListener('scroll', event => { if (!modal.hidden && !pinned && !modal.contains(event.target)) close(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => {
    if (pinned) { const was = pinned; pinned = false; position(); pinned = was; } else position();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(refreshTimer);
    if (!document.hidden && state) void load(state.ticker, false);
  });
  if (popup) document.addEventListener('tickerview:open', event => {
    void openTicker(event.detail.ticker, event.detail.anchor, true, true, event.detail.source || event.detail.ticker);
  });
  modal.addEventListener('keydown', event => {
    if (!popup || document.body.classList.contains('tv-research-enabled') || event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.customAliases) TickerView.setAliases(changes.customAliases.newValue);
    if (changes.tickerNotes && state && noteState?.ready && !noteState.saving) {
      const remote = changes.tickerNotes.newValue?.[state.ticker] || { text: '', revision: null };
      if (remote.revision !== noteState.revision) {
        if (noteDirty()) { noteState.conflict = true; noteState.remote = remote; noteState.message = 'This note changed in another window. Your draft is preserved.'; }
        else Object.assign(noteState, { text: remote.text, saved: remote.text, revision: remote.revision, conflict: false, message: '' });
        renderNote();
      }
    }
    if (changes.cardSections) { sectionPreferences = TickerView.cardSections(changes.cardSections.newValue); applySectionPreferences(); }
    if (changes.valuationScenarios) { valuationScenarios = changes.valuationScenarios.newValue || {}; if (state) renderValuation(state.quote); }
    if (changes.settings) { settings = TickerView.settings(changes.settings.newValue); applySettings(); }
    if (changes.watchlist) { watchlist = changes.watchlist.newValue || []; if (state) render(); }
  });
  chrome.storage.local.get(['settings', 'watchlist', 'valuationScenarios', 'customAliases']).then(values => {
    TickerView.setAliases(values.customAliases);
    valuationScenarios = values.valuationScenarios || {};
    settings = TickerView.settings(values.settings); watchlist = values.watchlist || []; applySettings();
  }).catch(() => applySettings());
})();
