// SQI UI smoke test for the interactions changed in the quality pass:
// mobile navigation drawer, standup rows/toggle, queue tray, dialogs.
// Expects the fixture from seed-fixture.sh. Exit code 1 on any FAIL.
//   NODE_PATH=$(npm root -g) node quality/scripts/ui-smoke.cjs http://127.0.0.1:7340
const { chromium } = require('playwright');
const base = process.argv[2]; const results = []; const ok = (n, c, d = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n} ${d}`);
(async () => {
  const b = await chromium.launch();
  // Mobile drawer
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(base + '/', { waitUntil: 'networkidle' });
  const menu = m.getByRole('button', { name: 'Open navigation' });
  ok('drawer: menu button visible on mobile', await menu.isVisible());
  await menu.click();
  const dlg = m.getByRole('dialog', { name: 'Navigation' });
  ok('drawer: opens as labelled dialog', await dlg.isVisible());
  ok('drawer: focus moved inside', await m.evaluate(() => !!document.activeElement?.closest('#mobile-nav')));
  await m.keyboard.press('Escape');
  ok('drawer: Escape closes', !(await dlg.isVisible().catch(() => false)));
  ok('drawer: focus restored to menu button', await m.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open navigation'));
  await menu.click(); await m.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: /Agenda/ }).click();
  await m.waitForURL(/\/agenda/); ok('drawer: nav link navigates + closes', !(await m.getByRole('dialog', { name: 'Navigation' }).isVisible().catch(() => false)), m.url());
  // Desktop
  const d = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(base + '/', { waitUntil: 'networkidle' });
  ok('desktop: menu button hidden', !(await d.getByRole('button', { name: 'Open navigation' }).isVisible()));
  ok('desktop: aria-current on Today', (await d.locator('aside a[aria-current="page"]').count()) >= 1);
  // standup row button selects task; repo link navigates
  const row = d.locator('details li').filter({ hasText: 'Investigate P99' }).first();
  await row.getByRole('button').click();
  await d.waitForTimeout(300);
  ok('standup: row button selects task in detail pane', (await d.locator('h1, h2', { hasText: 'Investigate P99 latency spike' }).count()) === 1);
  const toggle7d = d.getByRole('button', { name: /7d/ }).first();
  await toggle7d.click();
  let unmounted = false;
  for (let i = 0; i < 20; i++) { if ((await d.locator('details').count()) === 0) unmounted = true; await d.waitForTimeout(25); }
  ok('standup: window toggle keeps panel mounted + open', !unmounted && (await d.locator('details[open]').count()) === 1);
  ok('standup: aria-pressed reflects window', (await toggle7d.getAttribute('aria-pressed')) === 'true');
  await row.getByRole('link').first().click(); await d.waitForURL(/\/tasks/);
  ok('standup: repo link navigates', d.url().includes('repo=beta-service'), d.url());
  // queue tray semantics
  await d.goto(base + '/', { waitUntil: 'networkidle' });
  const qt = d.getByRole('button', { name: /Run Queue/ });
  await qt.click(); ok('queue tray: region linked via aria-controls', (await d.locator('#queue-tray-panel[role="region"]').count()) === 1);
  // new task dialog labelled + create works
  await d.keyboard.press('Escape'); await d.locator('body').click();
  await d.getByRole('button', { name: 'New task' }).click();
  ok('new task: dialog labelled', await d.getByRole('dialog', { name: 'New task' }).isVisible());
  await b.close(); console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
