'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateYouTubeUrl, tokensMatch, MAX_URL_LENGTH } = require('../../helper/validate');

test('accepts a canonical watch URL with a timestamp', () => {
  const r = validateYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  assert.equal(r.ok, true);
  assert.match(r.url, /v=dQw4w9WgXcQ/);
  assert.match(r.url, /t=42s/);
});

test('accepts the other YouTube hosts we may be handed', () => {
  for (const url of [
    'https://youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
  ]) {
    assert.equal(validateYouTubeUrl(url).ok, true, url);
  }
});

test('rejects non-YouTube hosts', () => {
  const r = validateYouTubeUrl('https://example.com/watch?v=abc');
  assert.equal(r.ok, false);
  assert.match(r.reason, /host not allowed/);
});

test('rejects a lookalike host that merely contains youtube.com', () => {
  for (const url of [
    'https://youtube.com.evil.test/watch?v=abc',
    'https://notyoutube.com/watch?v=abc',
    'https://evil.test/?x=youtube.com',
  ]) {
    assert.equal(validateYouTubeUrl(url).ok, false, url);
  }
});

test('rejects non-https schemes, including file and javascript', () => {
  for (const url of [
    'http://www.youtube.com/watch?v=abc',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
  ]) {
    assert.equal(validateYouTubeUrl(url).ok, false, url);
  }
});

test('rejects empty, non-string and unparseable input', () => {
  for (const bad of ['', null, undefined, 42, {}, [], 'not a url', '://']) {
    assert.equal(validateYouTubeUrl(bad).ok, false, String(bad));
  }
});

test('rejects an over-long URL', () => {
  const long = `https://www.youtube.com/watch?v=abc&pad=${'x'.repeat(MAX_URL_LENGTH)}`;
  const r = validateYouTubeUrl(long);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'url too long');
});

test('host matching is case-insensitive', () => {
  assert.equal(validateYouTubeUrl('https://WWW.YouTube.COM/watch?v=abc').ok, true);
});

test('tokensMatch accepts only an exact match', () => {
  assert.equal(tokensMatch('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(tokensMatch('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
  assert.equal(tokensMatch('', ''), true);
});

test('tokensMatch rejects non-string input instead of coercing', () => {
  for (const [a, b] of [[null, 'x'], ['x', null], [undefined, undefined], [1, 1]]) {
    assert.equal(tokensMatch(a, b), false);
  }
});
