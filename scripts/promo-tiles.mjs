import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const logo = (await readFile(new URL('icons/icon128.png', root))).toString('base64');
const font = (await readFile(new URL('fonts/Montserrat.ttf', root))).toString('base64');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const points = '0,106 18,120 36,102 54,109 72,78 90,89 108,69 126,80 144,46 162,57 180,34 198,45 216,18 234,28 252,8';
function svg(width, height) {
  const small = width === 440;
  const content = small ? `
    <image href="data:image/png;base64,${logo}" x="24" y="18" width="38" height="38"/>
    <text x="72" y="34" font-size="12" font-weight="800" letter-spacing="2">CERBERUS</text>
    <text x="72" y="50" font-size="10" fill="#a1adbd">TickerView · Chrome extension</text>
    <text x="24" y="99" font-size="30" font-weight="750" letter-spacing="-1">Market context.</text>
    <text x="24" y="135" font-size="30" font-weight="750" letter-spacing="-1" fill="#ff8533">One hover away.</text>
    <text x="24" y="162" font-size="11" fill="#b3bdca">Charts, technicals, and company fundamentals.</text>
    <rect x="24" y="184" width="392" height="70" rx="5" fill="#101925" stroke="#2e3642"/>
    <text x="38" y="210" font-size="12" font-weight="700" fill="#ff8533">$NVDA</text>
    <text x="38" y="233" font-size="14" font-weight="700">186.42 <tspan font-size="9" fill="#67d8a5">+2.65%</tspan></text>
    <g transform="translate(250 197) scale(.6 .37)"><path d="M${points.replaceAll(' ', ' L')}" fill="none" stroke="#ff6600" stroke-width="4" stroke-linejoin="round"/></g>
    <text x="416" y="269" text-anchor="end" font-size="7" fill="#8391a3">Illustrative data</text>` : `
    <image href="data:image/png;base64,${logo}" x="70" y="45" width="58" height="58"/>
    <text x="145" y="69" font-size="16" font-weight="800" letter-spacing="3">CERBERUS</text>
    <text x="145" y="94" font-size="13" fill="#a1adbd">TickerView · Chrome extension</text>
    <text x="70" y="211" font-size="61" font-weight="750" letter-spacing="-2">Market context.</text>
    <text x="70" y="283" font-size="61" font-weight="750" letter-spacing="-2" fill="#ff8533">One hover away.</text>
    <text x="74" y="333" font-size="19" fill="#b3bdca">Stock research, right where you read.</text>
    <g font-size="13" fill="#c0c6cf">
      <text x="74" y="404"><tspan fill="#ff6600">●</tspan> Interactive charts</text>
      <text x="285" y="404"><tspan fill="#ff6600">●</tspan> Technical indicators</text>
      <text x="74" y="436"><tspan fill="#ff6600">●</tspan> Company fundamentals</text>
      <text x="285" y="436"><tspan fill="#ff6600">●</tspan> Local watchlist</text>
    </g>
    <text x="74" y="502" font-size="11" letter-spacing="1.4" fill="#8391a3">X / TWEETDECK · FINANCE &amp; SOCIAL SITES</text>
    <g transform="translate(830 59)">
      <rect width="490" height="440" rx="10" fill="#101925" stroke="#35404f"/>
      <rect x="0" width="490" height="3" rx="1" fill="#ff6600"/>
      <text x="28" y="41" font-size="11" letter-spacing="2" fill="#ff8533">MARKET INTELLIGENCE</text>
      <text x="28" y="84" font-size="25" font-weight="750">$NVDA</text>
      <text x="28" y="108" font-size="12" fill="#a1adbd">NVIDIA Corporation</text>
      <text x="28" y="151" font-size="30" font-weight="700">USD 186.42</text>
      <text x="277" y="149" font-size="13" fill="#67d8a5">+4.81 (+2.65%)</text>
      <g font-size="10" fill="#8d9bad"><text x="28" y="184" fill="#ff8533">1D</text><text x="99" y="184">5D</text><text x="170" y="184">1M</text><text x="241" y="184">6M</text><text x="312" y="184">1Y</text></g>
      <rect x="28" y="197" width="434" height="138" fill="#0b1220" stroke="#2e3642"/>
      <path d="M28 231H462 M28 266H462 M28 301H462 M100 197V335 M173 197V335 M246 197V335 M319 197V335 M392 197V335" stroke="#c0c6cf" stroke-opacity=".07"/>
      <g transform="translate(40 208) scale(1.62 .92)"><path d="M${points.replaceAll(' ', ' L')}" fill="none" stroke="#ff6600" stroke-width="2.3" stroke-linejoin="round"/></g>
      <g font-size="11"><text x="28" y="364" fill="#8d9bad">RSI (14)</text><text x="28" y="387" font-size="16" font-weight="650">62.8</text><text x="178" y="364" fill="#8d9bad">VWAP</text><text x="178" y="387" font-size="16" font-weight="650">184.30</text><text x="328" y="364" fill="#8d9bad">Market cap</text><text x="328" y="387" font-size="16" font-weight="650">4.53T</text></g>
      <text x="462" y="421" text-anchor="end" font-size="8" fill="#8391a3">Illustrative interface and data</text>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="#edf0f4"><defs><style>@font-face{font-family:Montserrat;src:url(data:font/ttf;base64,${font})}text{font-family:Montserrat,sans-serif}</style><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#c0c6cf" stroke-opacity=".035"/></pattern></defs><rect width="100%" height="100%" fill="#0b1220"/><rect width="100%" height="100%" fill="url(#grid)"/><rect width="100%" height="3" fill="#ff6600"/>${content}</svg>`;
}
try {
  for (const [name, width, height] of [['small-promo-tile', 440, 280], ['marquee-promo-tile', 1400, 560]]) {
    const source = svg(width, height);
    await writeFile(new URL(`images/${name}.svg`, root), source);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:#0b1220">${source}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: fileURLToPath(new URL(`images/${name}.png`, root)), omitBackground: false });
    await page.close();
    console.log(`${name}: ${width} × ${height}, SVG and opaque PNG`);
  }
} finally { await browser.close(); }
