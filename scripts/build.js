const fs = require('node:fs');
require('./copy-phone-assets');
for (const file of ['Form.html', 'Form-UAE.html', 'Form-UAE-Gateways.html', 'Page2.html', 'Page2-UAE.html', 'Page3.html', 'Page3-UAE.html', 'Review.html']) {
  fs.copyFileSync(file, `public/${file}`);
}
