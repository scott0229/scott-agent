// Test if running through 'electron .' properly sets up the main process
const electron = require('electron');
console.log('typeof electron:', typeof electron);
console.log('typeof electron.app:', typeof electron.app);
console.log('process.type:', process.type);

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log('SUCCESS: App is ready!');
    electron.app.quit();
  });
} else {
  console.log('FAIL: electron.app is undefined');
  // Try to directly access from the module
  try {
    const Module = require('module');
    console.log('Module._cache keys for electron:', 
      Object.keys(Module._cache).filter(k => k.includes('electron')).join('\n  '));
  } catch(e) {}
  process.exit(1);
}
