const fs = require('fs');
const path = require('path');

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      walk(path.join(dir, entry));
    }
  } else if (dir.endsWith('.js')) {
    try {
      const content = fs.readFileSync(dir, 'utf8');
      if (content.includes('http://backend:3001')) {
        const newContent = content.replace(/http:\/\/backend:3001/g, 'http://localhost:3001');
        fs.writeFileSync(dir, newContent, 'utf8');
        console.log('Fixed: ' + dir);
      }
    } catch (e) {
      console.error('Error: ' + dir + ' - ' + e.message);
    }
  }
}

walk('/app/.next');
console.log('Done!');
