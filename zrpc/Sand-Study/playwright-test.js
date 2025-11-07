const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async ()=>{
  const out = (msg)=> console.log('[TEST]', msg);
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', msg => out('PAGE_CONSOLE ' + msg.type() + ': ' + msg.text()));
  page.on('pageerror', err => out('PAGE_ERROR: ' + err.message));

  // Start a minimal static HTTP server so modules load without CORS issues
  const http = require('http');
  const root = path.resolve(__dirname);
  const port = 8082;
  const server = http.createServer((req, res) => {
    try{
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let p = path.join(root, urlPath);
      if(urlPath === '/' || urlPath === '') p = path.join(root, 'index.html');
      // prevent directory traversal
      if(!p.startsWith(root)){
        res.statusCode = 403; res.end('forbidden'); return;
      }
      const fs = require('fs');
      fs.stat(p, (err, st) => {
        if(err){ res.statusCode = 404; res.end('not found'); return; }
        if(st.isDirectory()) p = path.join(p, 'index.html');
        const ext = path.extname(p).toLowerCase();
        const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        const rs = fs.createReadStream(p);
        rs.on('error', ()=>{ res.statusCode = 500; res.end('error'); });
        rs.pipe(res);
      });
    }catch(e){ res.statusCode = 500; res.end('err'); }
  });
  await new Promise((resolve)=> server.listen(port, resolve));
  out('http server listening on http://127.0.0.1:' + port);
  const url = `http://127.0.0.1:${port}/`;
  out('navigating to ' + url);
  await page.goto(url);
  await page.waitForTimeout(300);

  // Open end modal
  out('click endBtn');
  await page.click('#endBtn');
  await page.waitForTimeout(300);

  // Fill inputs
  out('filling taskname/nexttask');
  await page.fill('#taskname', 'A');
  await page.fill('#nexttask', 'S');
  await page.waitForTimeout(200);

  // screenshot before save
  const before = path.resolve(__dirname, 'screenshot-before.png');
  await page.screenshot({path: before, fullPage: true});
  out('screenshot saved: ' + before);

  // click save
  out('click saveBtn');
  await page.click('#saveBtn');

  // wait a bit for save logic to complete
  await page.waitForTimeout(600);

  // capture log text
  let logText = '';
  try{
    logText = await page.$eval('#logList', el => el.innerText);
  }catch(e){ out('failed to read logList: '+e.message); }
  out('LOG_TEXT:\n' + logText);

  // screenshot after save
  const after = path.resolve(__dirname, 'screenshot-after.png');
  await page.screenshot({path: after, fullPage: true});
  out('screenshot saved: ' + after);

  await browser.close();
  out('done');
})();
