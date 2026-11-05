// SQI UI audit: axe-core (WCAG 2.0/2.1 A+AA), horizontal overflow, CLS,
// console errors and screenshots for 9 routes x {dark, light} x
// {desktop 1440x900, mobile 390x844}. See quality/SQI-REPORT.md.
//
// Usage (Playwright + axe-core resolvable via NODE_PATH, e.g. the copy in
// web/nextjs/node_modules):
//   NODE_PATH=web/nextjs/node_modules:$(npm root -g) \
//     node quality/scripts/ui-audit.cjs http://127.0.0.1:7340 /tmp/sqi-shots
// usage: node audit.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const [base, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const ROUTES = ['/', '/tasks', '/repos', '/sessions', '/agenda', '/insights', '/review', '/contexts', '/sync'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const THEMES = ['dark', 'light'];
(async () => {
  const browser = await chromium.launch();
  const result = [];
  for (const theme of THEMES) for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('relay.theme', t); } catch {} }, theme);
    for (const route of ROUTES) {
      const page = await ctx.newPage(); const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
      const t0 = Date.now();
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const loadMs = Date.now() - t0;
      await page.waitForTimeout(400);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const cls = await page.evaluate(() => new Promise((res) => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} setTimeout(() => res(v), 200); }));
      const name = `${theme}-${vpName}-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '_')}`;
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: false });
      let axe = { violations: [] };
      if (vpName === 'desktop') {
        await page.addScriptTag({ content: axeSrc });
        axe = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
      }
      const v = axe.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      result.push({ theme, vp: vpName, route, loadMs, overflowX, cls: +cls.toFixed(4), consoleErrors: errors.length, errorsSample: errors.slice(0, 3), violations: v });
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(result, null, 1));
  const desk = result.filter((r) => r.vp === 'desktop');
  const sum = (f) => result.reduce((a, r) => a + f(r), 0);
  console.log(JSON.stringify({
    pages: result.length,
    axeRuleViolations: desk.reduce((a, r) => a + r.violations.length, 0),
    axeNodes: desk.reduce((a, r) => a + r.violations.reduce((b, v) => b + v.nodes, 0), 0),
    byRule: desk.flatMap((r) => r.violations.map((v) => `${r.theme}${r.route}:${v.id}(${v.impact})x${v.nodes}`)),
    overflowPages: result.filter((r) => r.overflowX > 0).map((r) => `${r.theme}-${r.vp}${r.route}:${r.overflowX}`),
    consoleErrorPages: result.filter((r) => r.consoleErrors).map((r) => `${r.theme}-${r.vp}${r.route}:${r.errorsSample[0]}`),
    maxCLS: Math.max(...result.map((r) => r.cls)),
    medianLoadMs: result.map((r) => r.loadMs).sort((a, b) => a - b)[Math.floor(result.length / 2)],
  }, null, 1));
})();
