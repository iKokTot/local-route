const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assetDir = path.join(root, 'src', 'renderer', 'assets');
const svgPath = path.join(assetDir, 'local-route-mark.svg');

function pngIconAsIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

app.whenReady().then(async () => {
  const renderer = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, frame: false, backgroundColor: '#98F5C0' });
  await renderer.loadFile(svgPath);
  const image = await renderer.webContents.capturePage();
  const png1024 = image.toPNG();
  const png256 = image.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(assetDir, 'local-route-logo-1024.png'), png1024);
  fs.writeFileSync(path.join(assetDir, 'local-route-logo-256.png'), png256);
  fs.writeFileSync(path.join(assetDir, 'local-route.ico'), pngIconAsIco(png256));
  renderer.destroy();
  app.quit();
});
