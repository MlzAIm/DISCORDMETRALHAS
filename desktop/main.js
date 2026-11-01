const { app, BrowserWindow, shell, session, desktopCapturer, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Keep the same origin on every launch so Supabase's localStorage session persists.
const APP_PORT = 47831;
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml' };
let server;

function serve() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
        res.end(data);
      });
    });
    server.once('error', reject);
    server.listen(APP_PORT, '127.0.0.1', () => resolve(APP_PORT));
  });
}

function setupPermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin) => {
    return origin.startsWith('http://127.0.0.1:') && (permission === 'media' || permission === 'display-capture');
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let isApp = false;
    try { isApp = new URL(details.requestingUrl || webContents.getURL()).hostname === '127.0.0.1'; } catch {}
    callback(isApp && (permission === 'media' || permission === 'display-capture'));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types:['screen','window'], thumbnailSize:{ width:180, height:110 } });
      if (!sources.length) { callback(null); return; }
      const buttons = [...sources.map(source=>source.name), 'Cancelar'];
      const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
        type:'question', title:'Compartilhar tela', message:'Escolha a tela ou janela para compartilhar:', buttons, cancelId:buttons.length-1, noLink:true
      });
      const source = sources[result.response];
      callback(source ? { video:source } : null);
    } catch (error) { console.error('Falha ao abrir seletor de tela:', error); callback(null); }
  });
}

async function createWindow() {
  let port;
  try {
    port = await serve();
  } catch (error) {
    console.error('Falha ao iniciar servidor local:', error);
    dialog.showErrorBox('MetralhaHub não iniciou', `A porta local ${APP_PORT} está ocupada. Feche outra instância do MetralhaHub e tente novamente.`);
    throw error;
  }
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 600,
    backgroundColor: '#111219',
    title: 'MetralhaHub',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    setupPermissions();
    try { await createWindow(); } catch { app.quit(); }
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) server.close(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
