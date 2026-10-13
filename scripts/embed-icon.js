const path = require('node:path');
const { rcedit } = require('rcedit');

const executable = process.argv[2];
if (!executable) throw new Error('Pass the packaged Local Route.exe path.');

const icon = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'local-route.ico');
rcedit(path.resolve(executable), {
  icon,
  'version-string': {
    ProductName: 'Local Route',
    FileDescription: 'Local Route',
    InternalName: 'Local Route',
    OriginalFilename: 'Local Route.exe'
  }
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
