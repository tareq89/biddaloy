import { chromium } from 'playwright';
const out = process.env.OUT; // docs/architecture/assets/landing-mockup
const pages = ['home','features','pricing','testimonials','contact','privacy'];
const sizes = [['desktop',1440,900],['phone',390,844]];
const b = await chromium.launch();
for (const [name,w,h] of sizes) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1, reducedMotion:'reduce' });
  const p = await ctx.newPage();
  for (const pg of pages) {
    await p.goto(`http://localhost:4321/landing-mockup-v5.html#${pg}`, { waitUntil:'networkidle' });
    await p.evaluate(()=>{ try{localStorage.removeItem('sm:consent');localStorage.removeItem('sm:ribbon')}catch(e){} document.querySelector('.mock')?.remove(); });
    await p.goto(`http://localhost:4321/landing-mockup-v5.html?s=1#${pg}`, { waitUntil:'networkidle' });
    await p.evaluate(()=>document.querySelectorAll('.mock,.consent,.chatfab').forEach(e=>e.remove()));
    await p.waitForTimeout(600);
    await p.screenshot({ path:`${out}/${pg}-${name}.png`, fullPage:true });
    console.log(pg, name);
  }
  await ctx.close();
}
await b.close();
