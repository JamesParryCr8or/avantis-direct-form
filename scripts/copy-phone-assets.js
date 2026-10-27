const fs = require('node:fs');
const path = require('node:path');
const source = path.join(path.dirname(require.resolve('intl-tel-input/package.json')), 'build');
for (const dir of ['css', 'img', 'js']) {
  fs.mkdirSync(`public/vendor/intl-tel-input/${dir}`, { recursive: true });
}
for (const file of ['css/intlTelInput.css', 'js/intlTelInput.min.js', 'js/utils.js']) {
  fs.copyFileSync(path.join(source, file), `public/vendor/intl-tel-input/${file}`);
}
fs.cpSync(path.join(source, 'img'), 'public/vendor/intl-tel-input/img', { recursive: true });
fs.copyFileSync(path.join(path.dirname(require.resolve('intl-tel-input/package.json')), 'LICENSE'), 'public/vendor/intl-tel-input/LICENSE');
