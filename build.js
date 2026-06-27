const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const templatePath = path.join(__dirname, 'worker_template.js');
const outputPath = path.join(__dirname, 'worker.js');

try {
  console.log('Reading files...');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');

  console.log('Encoding index.html content...');
  const escapedHtml = JSON.stringify(html);

  console.log('Injecting HTML into template...');
  const output = template.replace('__HTML_CONTENT__', escapedHtml);

  console.log('Writing worker.js...');
  fs.writeFileSync(outputPath, output, 'utf8');
  console.log('Successfully compiled worker.js!');
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
