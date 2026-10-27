/* Pure chart helpers shared by the market-window views. */
globalThis.TickerViewResearch = (() => {
  function points(chart) {
    return (chart?.points || []).filter(point => Number.isFinite(point.time) && Number.isFinite(point.close) && point.close >= 0).sort((a, b) => a.time - b.time);
  }
  function returnPercent(first, last) {
    return Number.isFinite(first) && first > 0 && Number.isFinite(last) && last >= 0 ? (last / first - 1) * 100 : null;
  }
  function sessionKey(point, chart) {
    if (chart.interval !== '1d') return String(point.time);
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: chart.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(point.time * 1000));
    } catch { return null; }
  }
  function compare(entries) {
    const maps = entries.map(entry => new Map(points(entry.chart).map(point => [sessionKey(point, entry.chart), point.close]).filter(([key]) => key !== null)));
    if (maps.length < 2) return { keys: [], series: [] };
    const keys = [...maps[0].keys()].filter(key => maps.every(map => map.has(key))).sort((a, b) => Number.isFinite(Number(a)) ? Number(a) - Number(b) : a.localeCompare(b));
    const start = keys.findIndex(key => maps.every(map => map.get(key) > 0));
    const aligned = start < 0 ? [] : keys.slice(start);
    if (aligned.length < 2) return { keys: [], series: [] };
    return { keys: aligned, series: entries.map((entry, i) => ({ symbol: entry.symbol, values: aligned.map(key => returnPercent(maps[i].get(aligned[0]), maps[i].get(key))) })) };
  }
  function coordinates(values, width = 300, height = 100, bounds) {
    const low = bounds?.[0] ?? Math.min(...values), high = bounds?.[1] ?? Math.max(...values);
    const y = value => high === low ? height / 2 : height - 4 - (value - low) / (high - low) * (height - 8);
    return values.map((value, i) => `${values.length < 2 ? 0 : i / (values.length - 1) * width},${y(value)}`).join(' ');
  }
  return { points, returnPercent, compare, coordinates };
})();
