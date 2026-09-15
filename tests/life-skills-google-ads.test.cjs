'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = path.join(__dirname, '..', 'public', 'life-skills');
const code = fs.readFileSync(path.join(site, 'assets/js/google-ads.js'), 'utf8');

function context(url, scripts = []) {
  const appended = [];
  const sandbox = {
    window: { location: new URL(url) },
    URLSearchParams,
    document: {
      scripts,
      createElement: () => ({}),
      head: { appendChild: (script) => { appended.push(script); scripts.push(script); } },
    },
  };
  vm.createContext(sandbox);
  return { sandbox, appended, run: () => vm.runInContext(code, sandbox) };
}

test('base tag loads once with denied consent before config and no conversion event', () => {
  const page = context('https://bneineviimacademy.org/life-skills/?lang=en&email=private@example.test#private');
  page.run();
  page.run();
  const commands = page.sandbox.window.dataLayer.map((entry) => Array.from(entry));
  assert.equal(page.appended.length, 1);
  assert.equal(page.appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=AW-18370639584');
  assert.equal(page.appended[0].async, true);
  assert.equal(page.appended[0].referrerPolicy, 'no-referrer');
  assert.deepEqual(commands[0].slice(0, 2), ['consent', 'default']);
  for (const value of Object.values(commands[0][2])) assert.equal(value, 'denied');
  const configs = commands.filter((entry) => entry[0] === 'config');
  assert.equal(configs.length, 1);
  assert.equal(configs[0][1], 'AW-18370639584');
  assert.equal(configs[0][2].allow_ad_personalization_signals, false);
  assert.equal(configs[0][2].page_location, 'https://bneineviimacademy.org/life-skills/?lang=en');
  assert.equal(configs[0][2].page_referrer, '');
  assert.equal(commands.some((entry) => entry[0] === 'event'), false);
  assert.doesNotMatch(JSON.stringify(commands), /private@example|#private/);
});

test('private, intake, other project, compliance and preview routes do not initialize', () => {
  for (const url of [
    'https://bneineviimacademy.org/',
    'https://bneineviimacademy.org/operations.html',
    'https://bneineviimacademy.org/life-skills/intake',
    'https://bneineviimacademy.org/life-skills/app',
    'https://bneineviimacademy.org/life-skills/meta-privacy.html',
    'https://bneineviimacademy.org/life-skills/meta-data-deletion.html',
    'https://example.test/life-skills/',
    'http://localhost/life-skills/',
  ]) {
    const page = context(url);
    page.run();
    assert.equal(page.appended.length, 0, url);
    assert.equal(page.sandbox.window.dataLayer, undefined, url);
  }
});

test('existing Google loader and data layer are preserved', () => {
  const page = context('https://bneineviimacademy.org/life-skills/', [
    { src: 'https://www.googletagmanager.com/gtag/js?id=G-EXISTING' },
  ]);
  const existing = [{ existing: true }];
  page.sandbox.window.dataLayer = existing;
  page.run();
  assert.equal(page.sandbox.window.dataLayer, existing);
  assert.equal(existing[0].existing, true);
  assert.equal(page.appended.length, 0);
});

test('only landing HTML imports initializer and CSP allows required Google endpoints without inline scripts', () => {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.equal((html.match(/src="assets\/js\/google-ads\.js\?v=20260915"/g) || []).length, 1);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /script-src-elem 'self' https:\/\/www\.googleadservices\.com/);
  assert.match(csp, /frame-src https:\/\/www\.googletagmanager\.com;/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  for (const file of ['meta-privacy.html', 'meta-data-deletion.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(site, file), 'utf8'), /google-ads\.js|AW-18370639584/);
  }
});

test('a Tag Manager container alone does not replace the required gtag.js loader', () => {
  const page = context('https://bneineviimacademy.org/life-skills/', [
    { src: 'https://www.googletagmanager.com/gtm.js?id=GTM-EXISTING' },
  ]);
  page.run();
  assert.equal(page.appended.length, 1);
  assert.equal(page.appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=AW-18370639584');
});
