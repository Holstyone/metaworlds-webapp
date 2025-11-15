const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

function minifyJs(code) {
  let result = '';
  let isString = false;
  let stringChar = '';
  let escape = false;
  let inSingleComment = false;
  let inMultiComment = false;
  let lastNonSpace = '';

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    const next = code[i + 1];

    if (inSingleComment) {
      if (char === '\n') {
        inSingleComment = false;
        if (result[result.length - 1] !== '\n') {
          result += '\n';
        }
      }
      continue;
    }

    if (inMultiComment) {
      if (char === '*' && next === '/') {
        inMultiComment = false;
        i += 1;
      }
      continue;
    }

    if (isString) {
      result += char;
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === stringChar) {
        isString = false;
        stringChar = '';
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      isString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inSingleComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inMultiComment = true;
      i += 1;
      continue;
    }

    if (/\s/.test(char)) {
      if (lastNonSpace && /[\w$\)]/.test(lastNonSpace) && next && /[\w$(\[{\-]/.test(next)) {
        if (result[result.length - 1] !== ' ') {
          result += ' ';
        }
      }
      continue;
    }

    result += char;
    if (!/\s/.test(char)) {
      lastNonSpace = char;
    }
  }

  return result;
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function build() {
  const jsPath = path.join(__dirname, '..', 'main.js');
  const cssPath = path.join(__dirname, '..', 'styles.css');

  const jsSource = fs.readFileSync(jsPath, 'utf-8');
  const cssSource = fs.readFileSync(cssPath, 'utf-8');

  const jsMin = minifyJs(jsSource);
  const cssMin = minifyCss(cssSource);

  fs.writeFileSync(path.join(distDir, 'main.min.js'), jsMin);
  fs.writeFileSync(path.join(distDir, 'styles.min.css'), cssMin);

  console.log('Assets minified into dist/');
}

build();
