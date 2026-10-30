const { chromium } = require('playwright');
const B = 'http://127.0.0.1:8000', OUT = process.argv[2];
const h = { Origin: B };
(async () => {
  const browser = await chromium.launch();
  // Ecranul de la ușă
  const phone = { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  let ctx = await browser.newContext(phone);
  await ctx.request.post(B + '/api/admin/login', { headers: h, data: { username: 'admin', password: 'parola-de-test' } });
  const { link } = await (await ctx.request.post(B + '/api/admin/door-screen/activation-link', { headers: h })).json();
  await ctx.request.post(B + '/api/employee/door/activate/' + new URL(link).pathname.split('/').pop(), { headers: h });
  let page = await ctx.newPage();
  for (const [v, extra, tag] of [['A','',''],['B','',''],['C','',''],['0','',''],['A','&stale=1','-stale']]) {
    await page.goto(`${B}/door?shot=1&variant=${v}${extra}`);
    await page.waitForSelector('[role=img] svg', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/door-${v}${tag}.png` });
  }
  await ctx.close();
  // Admin
  for (const [name, opts, theme] of [['phone', phone, 'light'], ['phone-dark', phone, 'dark'], ['desktop', { viewport: { width: 1440, height: 900 } }, 'light']]) {
    ctx = await browser.newContext(opts);
    await ctx.addInitScript((t) => { try { localStorage.setItem('gymctrl-theme', t); } catch {} }, theme);
    await ctx.request.post(B + '/api/admin/login', { headers: h, data: { username: 'admin', password: 'parola-de-test' } });
    page = await ctx.newPage();
    for (const v of ['A', 'B', 'C']) {
      if (name === 'phone-dark' && v !== 'A' && v !== 'B') continue;
      await page.goto(`${B}/admin/?shot=1&variant=${v}`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/admin-${v}-${name}.png` });
      if (name === 'phone') {
        await page.getByRole('button', { name: 'Mai mult' }).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/admin-${v}-${name}-more.png` });
        await page.keyboard.press('Escape'); await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Acțiuni rapide' }).first().click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/admin-${v}-${name}-plus.png` });
        await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      }
      if (name === 'desktop' && v === 'A') {
        await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
        await page.keyboard.type('mar'); await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/admin-A-desktop-search.png` });
        await page.keyboard.press('Escape');
      }
    }
    await ctx.close();
  }
  await browser.close();
})();
