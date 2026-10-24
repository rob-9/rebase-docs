const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {createDemo} = require('../scripts/demo');

(async () => {
  const demo=createDemo();
  await new Promise(resolve => demo.server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+demo.server.address().port;
  const options={headless:true};
  if(process.env.CHROME_PATH)options.executablePath=process.env.CHROME_PATH;
  let browser;
  try {
    browser=await chromium.launch(options);
    const page=await browser.newPage({viewport:{width:880,height:700}});
    page.setDefaultTimeout(10000);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await page.getByText('0 / 2 resolved').waitFor();
    console.log('Conflict dialog loaded.');
    assert.equal(await page.getByRole('button',{name:'Apply resolutions'}).isDisabled(),true);
    await page.locator('input[name="c0"][value="local"]').check();
    await page.getByRole('textbox',{name:'Custom text for conflict 2'}).fill('28');
    await page.getByText('2 / 2 resolved').waitFor();
    await page.getByRole('button',{name:'Apply resolutions'}).click();
    await page.getByText('Resolved. Parent updates and your selected changes are now in your copy.').waitFor();
    assert.match(demo.documents.get('child').text,/Tuesday/);
    assert.match(demo.documents.get('child').text,/\$28,000/);
    assert.match(demo.documents.get('child').text,/London/);
    assert.match(demo.documents.get('child').text,/invite the design team/);
    assert.match(demo.documents.get('parent').text,/Friday/);
    console.log('Mixed conflict resolutions applied.');

    // Stale resolutions require a reload, even if the browser has all choices.
    demo.setDoc('parent',demo.documents.get('parent').text.replace('Friday','Saturday'));
    await page.goto(url);
    await page.getByText('0 / 1 resolved').waitFor();
    await page.locator('input[name="c0"][value="parent"]').check();
    demo.setDoc('parent',demo.documents.get('parent').text.replace('Saturday','Sunday'));
    await page.getByRole('button',{name:'Apply resolutions'}).click();
    await page.getByRole('alert').filter({hasText:'changed while you were reviewing'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Apply resolutions'}).isDisabled(),true);
    await page.getByRole('button',{name:'Reload latest'}).click();
    await page.getByText('Sunday',{exact:true}).waitFor();

    // Untrusted document text must remain literal, including script-like content.
    demo.setDoc('parent',demo.documents.get('parent').text.replace('Sunday','<img src=x onerror="window.pwned=1">'));
    await page.getByRole('button',{name:'Reload latest'}).click();
    await page.getByText('<img src=x onerror="window.pwned=1">',{exact:true}).waitFor();
    assert.equal(await page.locator('img').count(),0);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    if (process.env.SCREENSHOT_PATH) await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});

    // The sidebar opens one conflict popup per unresolved episode, and pauses.
    const sidebar=await browser.newPage({viewport:{width:300,height:900}});
    sidebar.setDefaultTimeout(10000);
    sidebar.on('pageerror',error=>errors.push(error.message));
    const popupPromise=sidebar.waitForEvent('popup');
    await sidebar.goto(url+'/sidebar');
    const popup=await popupPromise;
    await sidebar.getByRole('button',{name:'Review conflicts'}).waitFor();
    await popup.close();
    await sidebar.getByRole('checkbox',{name:'Sync automatically'}).uncheck();
    await sidebar.getByText('Automatic sync paused',{exact:true}).waitFor();
    await sidebar.getByRole('checkbox',{name:'Also check in the background'}).check();
    assert.equal(demo.service.sync('child',true).status,'paused');
    await sidebar.getByText('Disconnect this copy',{exact:true}).click();
    await sidebar.getByRole('button',{name:'Disconnect',exact:true}).click();
    await sidebar.getByRole('button',{name:'Create linked copy'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: conflict choices, stale revisions, safe text rendering, popup, pause, settings, and disconnect.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>demo.server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
