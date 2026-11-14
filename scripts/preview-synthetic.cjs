const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = new Set(['index.html', 'css/style.css', 'assets/farm-scene.svg', 'js/core.js', 'js/control.js', 'js/telemetry.js', 'js/herd.js', 'js/config.js',
  'js/firebase-public.js', 'js/app.js', 'js/access.js', 'js/admin.js']);
const bridge = path.join(__dirname, 'synthetic', 'firebase-bridge.js');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const marker = `
<style>
.synthetic-chip{display:inline-block;padding:4px 9px;border:1.5px solid #6f4a05;border-radius:6px;background:#f3e2b4;color:#6f4a05;font:700 11.5px/1.4 system-ui,sans-serif;letter-spacing:.06em}
.auth-form-wrap > .synthetic-chip{margin-bottom:16px}
@media (max-width:600px){.statusbar .synthetic-chip{order:2}}
.synthetic-hint{margin-top:14px;padding:10px 12px;border:1px dashed #6f4a05;border-radius:8px;background:#f3e2b4;color:#6f4a05;font-size:13px;line-height:1.6}
</style>
<script>
document.querySelector('#localPreviewNotice span').innerHTML='<b>Pratinjau sintetis.</b> Data contoh buatan, bukan pembacaan kandang. Tidak terhubung ke Firebase atau perangkat.';
document.getElementById('localPreviewNotice').hidden=false;
function chip(){var c=document.createElement('span');c.className='synthetic-chip';c.setAttribute('role','note');c.textContent='DATA SINTETIS · tanpa perangkat asli';return c;}
var bar=document.querySelector('.statusbar');if(bar)bar.children[0].after(chip());
var wrap=document.querySelector('.auth-form-wrap');if(wrap)wrap.prepend(chip());
(function(){var form=document.getElementById('loginForm');if(!form)return;var hint=document.createElement('p');hint.className='synthetic-hint';
hint.innerHTML='<b>Akun contoh sintetis</b> (password bebas): admin@contoh.test, operator@contoh.test, viewer@contoh.test, nopermission@contoh.test, disabled@contoh.test.';
form.parentNode.insertBefore(hint,form.nextSibling);})();
</script>
`;
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let asset;
  try { asset = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html'; }
  catch { res.writeHead(400); res.end(); return; }
  const delay = asset === 'js/firebase.js' ? Math.max(0, Math.min(20000, Number(new URL(req.headers.referer || 'http://localhost/').searchParams.get('sdkDelay')) || 0)) : 0;
  const headers = type => ({ 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp });
  let file;
  if (asset === 'js/firebase.js') file = bridge;
  else if (assets.has(asset)) file = path.join(root, asset);
  else { res.writeHead(404); res.end('Not found'); return; }
  setTimeout(() => fs.readFile(file, 'utf8', (error, data) => {
    if (error) { res.writeHead(500); res.end('Asset unavailable'); return; }
    if (asset === 'index.html') data = data.replace('</body>', marker + '</body>');
    res.writeHead(200, headers(types[path.extname(asset)]));
    res.end(req.method === 'HEAD' ? undefined : data);
  }), delay);
});
server.on('error', error => { console.error(`Preview sintetis gagal: ${error.message}`); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 8766), '127.0.0.1', () => {
  console.log(`COSTMOSYS SYNTHETIC preview: http://127.0.0.1:${server.address().port}`);
  console.log('Data buatan. Tidak ada koneksi ke Firebase atau perangkat; CSP memblokir request keluar.');
});
