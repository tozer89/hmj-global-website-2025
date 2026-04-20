'use strict';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
}

function parseScalar(raw) {
  const text = trimString(raw);
  if (!text) return '';
  if (text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
    return text.slice(1, -1);
  }
  return text;
}

function countIndent(line) {
  const match = String(line || '').match(/^ */);
  return match ? match[0].length : 0;
}

function nextMeaningfulLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!trimString(line)) continue;
    return { index, line };
  }
  return null;
}

function parseArray(lines, startIndex, indent) {
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!trimString(line)) {
      index += 1;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw new Error(`Unexpected indentation at line ${index + 1}.`);
    }

    const trimmed = trimString(line);
    if (!trimmed.startsWith('- ')) break;

    const remainder = trimString(trimmed.slice(2));
    if (!remainder) {
      const nestedStart = nextMeaningfulLine(lines, index + 1);
      if (!nestedStart || countIndent(nestedStart.line) <= lineIndent) {
        items.push('');
        index += 1;
      } else {
        const [value, nextIndex] = parseBlock(lines, nestedStart.index, lineIndent + 2);
        items.push(value);
        index = nextIndex;
      }
      continue;
    }

    items.push(parseScalar(remainder));
    index += 1;
  }

  return [items, index];
}

function parseObject(lines, startIndex, indent) {
  const output = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!trimString(line)) {
      index += 1;
      continue;
    }

    const lineIndent = countIndent(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw new Error(`Unexpected indentation at line ${index + 1}.`);
    }

    const trimmed = trimString(line);
    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Expected key/value pair at line ${index + 1}.`);
    }

    const key = trimString(trimmed.slice(0, separatorIndex));
    const remainder = trimString(trimmed.slice(separatorIndex + 1));
    if (!key) {
      throw new Error(`Missing key at line ${index + 1}.`);
    }

    if (!remainder) {
      const nestedStart = nextMeaningfulLine(lines, index + 1);
      if (!nestedStart || countIndent(nestedStart.line) <= lineIndent) {
        output[key] = '';
        index += 1;
      } else {
        const [value, nextIndex] = parseBlock(lines, nestedStart.index, lineIndent + 2);
        output[key] = value;
        index = nextIndex;
      }
      continue;
    }

    output[key] = parseScalar(remainder);
    index += 1;
  }

  return [output, index];
}

function parseBlock(lines, startIndex, indent) {
  const current = nextMeaningfulLine(lines, startIndex);
  if (!current) return [{}, lines.length];
  const isArray = trimString(current.line).startsWith('- ');
  return isArray
    ? parseArray(lines, current.index, indent)
    : parseObject(lines, current.index, indent);
}

function parseYaml(text) {
  const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const [result] = parseBlock(lines, 0, 0);
  return result;
}

module.exports = {
  parseYaml,
};
