'use strict';

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function isPlaceholderOpenAiApiKey(value) {
  const text = trimString(value, 400);
  if (!text) return true;
  if (/^\$\{?OPENAI_API_KEY\}?$/i.test(text)) return true;
  if (/^YOUR_OPENAI_API_KEY$/i.test(text)) return true;
  if (/^REPLACE_WITH_YOUR_KEY$/i.test(text)) return true;
  if (/^(example|changeme|setme)([_-]|$)/i.test(text)) return true;
  if (/^sk(?:-proj)?-.*(?:REPLACE_WITH_YOUR_KEY|YOUR_OPENAI_API_KEY)$/i.test(text)) return true;
  return false;
}

function hasUsableOpenAiApiKey(value) {
  const text = trimString(value, 400);
  return !!text && !isPlaceholderOpenAiApiKey(text);
}

module.exports = {
  hasUsableOpenAiApiKey,
  isPlaceholderOpenAiApiKey,
};
