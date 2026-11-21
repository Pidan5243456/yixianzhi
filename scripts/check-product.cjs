const {chromium}=require('@playwright/test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.AUTH_SECRET='product-test-secret-at-least-32-characters';
for(const k of ['OPENROUTER_API_KEY','DASHSCOPE_API_KEY','DM_ACCESS_KEY_ID','DM_ACCESS_KEY_SECRET'])process.env[k]='';
process.env.DATA_DIR=path.resolve('.tooling/tests/product-'+Date.now());
const app=require('../server/server');
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let aiCalls=0;page.on('request',r=>{if(/\/api\/(tryon|recommend|segment|validate-photo)/.test(r.url()))aiCalls++;});
 const ready=()=>page.waitForFunction(()=>window.APP_READY);
 const visit=async p=>{await page.goto(base+'/'+p);await ready();};
 fs.mkdirSync('artifacts/product',{recursive:true});
 try{
  await visit('login.html');await page.evaluate(()=>localStorage.setItem('yxz-connection',JSON.stringify({mode:'demo'})));await visit('wardrobe.html');
  assert.equal(await page.evaluate(()=>wardrobeItems().length),0);
  await visit('add-clothes.html');await page.locator('#fileInput').setInputFiles('assets/real/f-daily-01-top.png');await page.locator('#garmentForm').waitFor({state:'visible'});
  await page.locator('#garmentName').fill('白色衬衫');await page.locator('#saveGarment').click();await page.waitForURL('**/wardrobe.html');await ready();
  const id=await page.evaluate(()=>Store.get().customItems[0].id);assert.ok(id);assert.equal(aiCalls,0);
  await page.locator('[data-view]').first().click();await page.locator('#editGarment').click();await page.waitForURL('**/add-clothes.html?*');await ready();
  await page.locator('#garmentName').fill('棉质白衬衫');await page.locator('#saveGarment').click();await page.waitForURL('**/wardrobe.html');await ready();
  assert.equal(await page.evaluate(()=>Store.get().customItems.length),1);
  await page.locator('[data-go]').first().click();await page.waitForURL('**/tryon.html?*');await ready();await page.waitForTimeout(900);assert.equal(aiCalls,0);assert.equal(await page.evaluate(()=>Store.get().history.length),0);
  await page.locator('#btnSaveOutfit').click();await page.locator('.product-dialog input[name=name]').fill('周一通勤');await page.locator('.product-dialog button.btn-primary').click();await page.waitForFunction(()=>Store.get().customOutfits.length===1);
  await page.locator('#btnFav').click();await page.evaluate(()=>LocalState.flush());
  await visit('home.html');assert.equal(await page.locator('.ocard').count(),1);assert.equal(await page.evaluate(()=>Store.get().favorites.length),1);await page.screenshot({path:'artifacts/product/outfits.png'});
  await visit('tryon.html?item='+id);await page.locator('#btnGenerate').click();await page.waitForFunction(()=>Store.get().history.length===1);assert.equal(await page.evaluate(()=>Store.get().history[0].kind),'collage');
  await page.screenshot({path:'artifacts/product/tryon.png'});
  await visit('wardrobe.html');await page.locator('[data-del]').first().click();await page.locator('#btnDelOk').click();await page.evaluate(()=>LocalState.flush());await page.reload();await ready();assert.equal(await page.evaluate(()=>wardrobeItems().length),0);
  await visit('home.html');await page.locator('[data-open]').click();await page.waitForURL('**/outfit-detail.html?*');await ready();assert.match(await page.locator('#hero').innerText(),/移除/);assert.equal(await page.evaluate(()=>Store.get().customOutfits.length),1);
  for(const w of [360,430,768,1440]){await page.setViewportSize({width:w,height:900});for(const p of ['home.html','wardrobe.html','add-clothes.html','tryon.html','profile.html']){await visit(p);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),p+' '+w);}}
  assert.deepEqual(errors,[]);console.log('PASS: empty closet, manual add/edit, zero automatic AI, saved custom outfit/favorite, explicit demo image, missing-item recovery, responsive pages');
 }finally{await browser.close();await new Promise(r=>server.close(r));require('../server/database').db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
