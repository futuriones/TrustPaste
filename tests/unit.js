'use strict';

globalThis.LBA = globalThis.LBA || {};

function clone(value) {
  return structuredClone(value);
}

function createStorageFake() {
  let values = {};

  function select(keys) {
    if (keys === null || keys === undefined) {
      return clone(values);
    }
    if (typeof keys === 'string') {
      return Object.hasOwn(values, keys) ? { [keys]: clone(values[keys]) } : {};
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(values, key))
          .map((key) => [key, clone(values[key])]),
      );
    }
    if (typeof keys === 'object') {
      const selected = clone(keys);
      for (const key of Object.keys(keys)) {
        if (Object.hasOwn(values, key)) {
          selected[key] = clone(values[key]);
        }
      }
      return selected;
    }
    throw new TypeError('Unsupported storage key selector.');
  }

  const fake = {
    async get(keys) {
      return select(keys);
    },
    async set(items) {
      values = { ...values, ...clone(items) };
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        delete values[key];
      }
    },
    async clear() {
      values = {};
    },
    async getBytesInUse(keys) {
      const selected = select(keys);
      return new TextEncoder().encode(JSON.stringify(selected)).byteLength;
    },
    snapshot() {
      return clone(values);
    },
  };

  return fake;
}

const storageFake = createStorageFake();
const runtimeMessageListeners = [];
const sentRuntimeMessages = [];
const installedListeners = [];
const commandListeners = [];
const actionClickListeners = [];
const contextMenuClickListeners = [];
const serviceWorkerCalls = [];
let canDeliverTabMessages = true;
let fakeTabAlreadyInjected = false;
globalThis.chrome = {
  storage: {
    local: storageFake,
  },
  runtime: {
    lastError: null,
    getURL(path) {
      return new URL(`../${path}`, globalThis.location.href).href;
    },
    onMessage: {
      addListener(listener) {
        runtimeMessageListeners.push(listener);
      },
    },
    onInstalled: {
      addListener(listener) {
        installedListeners.push(listener);
      },
    },
    sendMessage(message, callback) {
      sentRuntimeMessages.push(clone(message));
      callback?.();
    },
    openOptionsPage(callback) {
      serviceWorkerCalls.push(['openOptionsPage']);
      callback?.();
    },
  },
  action: {
    onClicked: {
      addListener(listener) {
        actionClickListeners.push(listener);
      },
    },
    setBadgeText(details, callback) {
      serviceWorkerCalls.push(['setBadgeText', clone(details)]);
      callback?.();
    },
    setTitle(details, callback) {
      serviceWorkerCalls.push(['setTitle', clone(details)]);
      callback?.();
    },
  },
  commands: {
    onCommand: {
      addListener(listener) {
        commandListeners.push(listener);
      },
    },
  },
  contextMenus: {
    onClicked: {
      addListener(listener) {
        contextMenuClickListeners.push(listener);
      },
    },
    removeAll(callback) {
      serviceWorkerCalls.push(['removeAll']);
      callback?.();
    },
    create(details, callback) {
      serviceWorkerCalls.push(['create', clone(details)]);
      callback?.();
    },
  },
  scripting: {
    async executeScript(details) {
      if (typeof details.func === 'function') {
        serviceWorkerCalls.push(['executeScript', {
          target: clone(details.target),
          probe: true,
        }]);
        return [{ result: fakeTabAlreadyInjected }];
      }
      serviceWorkerCalls.push(['executeScript', clone(details)]);
      return [{ result: undefined }];
    },
  },
  tabs: {
    query(details, callback) {
      serviceWorkerCalls.push(['query', clone(details)]);
      callback([{ id: 91, url: 'https://example.test/form' }]);
    },
    sendMessage(tabId, message, callback) {
      serviceWorkerCalls.push(['sendMessage', tabId, clone(message)]);
      let response;
      let didRespond = false;

      if (canDeliverTabMessages) {
        for (const listener of runtimeMessageListeners) {
          listener(message, {}, (nextResponse) => {
            if (!didRespond) {
              response = clone(nextResponse);
              didRespond = true;
            }
          });
        }
      }

      if (didRespond) {
        callback?.(response);
        return;
      }

      chrome.runtime.lastError = {
        message: 'Could not establish connection. Receiving end does not exist.',
      };
      callback?.();
      chrome.runtime.lastError = null;
    },
  },
};

function dispatchRuntimeMessage(message) {
  const responses = [];
  for (const listener of runtimeMessageListeners) {
    listener(message, {}, (response) => { responses.push(clone(response)); });
  }
  return new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(responses), 0);
  });
}

function flushAsyncWork() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

const tests = [];
const results = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function format(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function assertEqual(actual, expected, message = '') {
  if (Object.is(actual, expected)) {
    return;
  }
  throw new Error(
    `${message ? `${message}: ` : ''}expected ${format(expected)}, received ${format(actual)}`,
  );
}

function assertDeepEqual(actual, expected, message = '') {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    return;
  }
  throw new Error(
    `${message ? `${message}: ` : ''}expected ${expectedJson}, received ${actualJson}`,
  );
}

function assertTrue(condition, message = 'expected condition to be true') {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(callback, expectedMessage) {
  let thrownError;
  try {
    callback();
  } catch (error) {
    thrownError = error;
  }
  assertTrue(thrownError instanceof Error, 'expected callback to throw');
  if (expectedMessage) {
    assertTrue(
      thrownError.message.includes(expectedMessage),
      `expected error containing ${format(expectedMessage)}, received ${format(thrownError.message)}`,
    );
  }
}

async function assertRejects(callback, expectedMessage) {
  let thrownError;
  try {
    await callback();
  } catch (error) {
    thrownError = error;
  }
  assertTrue(thrownError instanceof Error, 'expected promise to reject');
  if (expectedMessage) {
    assertTrue(
      thrownError.message.includes(expectedMessage),
      `expected error containing ${format(expectedMessage)}, received ${format(thrownError.message)}`,
    );
  }
}

function makeEntry(path, value = path) {
  const pathSegments = path.split('.');
  const label = pathSegments[pathSegments.length - 1];
  return {
    path,
    pathSegments,
    label,
    value,
    valueType: 'string',
    characterCount: value.length,
    searchableText: LBA.normalize.normalizeText([...pathSegments, label, value].join(' ')),
  };
}

test('normalize: exact diacritic, separator, whitespace, and case behavior', () => {
  assertEqual(
    LBA.normalize.normalizeText('  ÁRBOL_web.site/Path\\File-name \n '),
    'arbol web site path file name',
  );
  assertEqual(LBA.normalize.normalizeText(42), '42');
});

test('flatten: nested primitives have the exact AutofillEntry shape', () => {
  const entries = LBA.flatten.flattenJson({
    company: {
      founded: 2026,
      active: true,
      note: null,
    },
  });
  assertDeepEqual(entries, [
    {
      path: 'company.founded',
      pathSegments: ['company', 'founded'],
      label: 'founded',
      value: '2026',
      valueType: 'number',
      characterCount: 4,
      searchableText: 'company founded founded 2026',
    },
    {
      path: 'company.active',
      pathSegments: ['company', 'active'],
      label: 'active',
      value: 'true',
      valueType: 'boolean',
      characterCount: 4,
      searchableText: 'company active active true',
    },
    {
      path: 'company.note',
      pathSegments: ['company', 'note'],
      label: 'note',
      value: '',
      valueType: 'null',
      characterCount: 0,
      searchableText: 'company note note',
    },
  ]);
});

test('flatten: arrays preserve index and traversal order', () => {
  const entries = LBA.flatten.flattenJson([
    { name: 'First' },
    false,
    ['last'],
  ]);
  assertDeepEqual(entries.map((entry) => [entry.path, entry.value]), [
    ['0.name', 'First'],
    ['1', 'false'],
    ['2.0', 'last'],
  ]);
});

test('flatten: empty objects and arrays emit no entries', () => {
  assertDeepEqual(LBA.flatten.flattenJson({ empty: {}, list: [] }), []);
  assertDeepEqual(LBA.flatten.flattenJson([]), []);
});

test('flatten: iterative traversal handles deeply nested JSON', () => {
  const depth = 3000;
  let rawJson = { leaf: 'value' };
  for (let index = 0; index < depth; index += 1) {
    rawJson = { node: rawJson };
  }
  const [entry] = LBA.flatten.flattenJson(rawJson);
  assertEqual(entry.pathSegments.length, depth + 1);
  assertEqual(entry.value, 'value');
});

test('flatten: scalar roots are rejected clearly', () => {
  for (const value of ['text', 1, true, null]) {
    assertThrows(() => LBA.flatten.flattenJson(value), 'root must be an object or array');
  }
});

test('flatten: non-JSON values and cycles are rejected clearly', () => {
  assertThrows(() => LBA.flatten.flattenJson({ bad: undefined }), 'not valid JSON');
  assertThrows(() => LBA.flatten.flattenJson({ bad: Number.NaN }), 'not valid JSON');
  assertThrows(() => LBA.flatten.flattenJson({ bad: new Date() }), 'not valid JSON');
  const circular = {};
  circular.self = circular;
  assertThrows(() => LBA.flatten.flattenJson(circular), 'circular or repeated');
});

test('search: empty normalized query returns no matches', () => {
  assertDeepEqual(LBA.search.searchEntries([makeEntry('company.name')], ' _ / '), []);
});

test('search: every query word must match', () => {
  const entries = LBA.flatten.flattenJson({
    company: { name: 'Futurion Solutions', city: 'Valencia' },
  });
  assertEqual(LBA.search.searchEntries(entries, 'company futurion').length, 1);
  assertEqual(LBA.search.searchEntries(entries, 'futurion valencia').length, 0);
});

test('search: matching is case- and accent-insensitive', () => {
  const entries = LBA.flatten.flattenJson({
    address: { city: 'Málaga' },
  });
  assertEqual(LBA.search.searchEntries(entries, 'MALAGA').length, 1);
});

test('search: each word uses its strongest parent, label, or value score', () => {
  const entries = [
    makeEntry('company.detail', 'company detail'),
    makeEntry('details.company', 'company'),
    makeEntry('details.value', 'company'),
  ];
  const matches = LBA.search.searchEntries(entries, 'company');
  assertDeepEqual(matches.map((match) => match.baseScore), [3, 2, 1]);
});

test('search: multi-word scores are summed', () => {
  const [entry] = LBA.flatten.flattenJson({
    company: { city: 'Valencia Spain' },
  });
  const [match] = LBA.search.searchEntries([entry], 'company city spain');
  assertEqual(match.baseScore, 6);
});

test('synonyms: required English and Spanish groups remain configurable', () => {
  const requiredGroups = [
    'company', 'website', 'email', 'description', 'phone',
    'address', 'name', 'linkedin', 'tagline',
  ];
  assertTrue(requiredGroups.every((group) => Array.isArray(LBA.synonyms[group])));
  const original = LBA.synonyms.company;
  LBA.synonyms.company = ['custom'];
  assertDeepEqual(LBA.synonyms.company, ['custom']);
  LBA.synonyms.company = original;
});

test('ranking: returns base score and favorite/recent total score', () => {
  const entry = makeEntry('company.name');
  const [ranked] = LBA.ranking.rankEntries(
    [{ entry, baseScore: 2 }],
    {
      favorites: [entry.path],
      recent: [{ path: entry.path, useCount: 99 }],
      preferences: { ignored: true },
      fieldContext: { ignored: true },
    },
  );
  assertDeepEqual(ranked, { entry, baseScore: 2, score: 10 });
});

test('ranking: total score sorts descending', () => {
  const ranked = LBA.ranking.rankEntries([
    { entry: makeEntry('low'), baseScore: 1 },
    { entry: makeEntry('high'), baseScore: 3 },
  ]);
  assertDeepEqual(ranked.map((item) => item.entry.path), ['high', 'low']);
});

test('ranking: shorter path breaks equal-score ties', () => {
  const ranked = LBA.ranking.rankEntries([
    { entry: makeEntry('long.path'), baseScore: 1 },
    { entry: makeEntry('tiny'), baseScore: 1 },
  ]);
  assertDeepEqual(ranked.map((item) => item.entry.path), ['tiny', 'long.path']);
});

test('ranking: alphabetical path breaks equal-score and length ties', () => {
  const ranked = LBA.ranking.rankEntries([
    { entry: makeEntry('bravo'), baseScore: 1 },
    { entry: makeEntry('alpha'), baseScore: 1 },
  ]);
  assertDeepEqual(ranked.map((item) => item.entry.path), ['alpha', 'bravo']);
});

test('ranking: original position is the final tie-break', () => {
  const first = makeEntry('same');
  const second = makeEntry('same');
  first.marker = 1;
  second.marker = 2;
  const ranked = LBA.ranking.rankEntries([
    { entry: first, baseScore: 1 },
    { entry: second, baseScore: 1 },
  ]);
  assertDeepEqual(ranked.map((item) => item.entry.marker), [1, 2]);
});

test('storage: absent data returns fresh defaults without repair metadata', async () => {
  await storageFake.clear();
  const first = await LBA.storage.getState();
  const second = await LBA.storage.getState();
  assertEqual(first.repaired, false);
  assertEqual(first.state.profile, null);
  assertEqual(Object.hasOwn(first.state, 'repaired'), false);
  first.state.preferences.activeScope = 'changed';
  assertEqual(second.state.preferences.activeScope, '');
  assertDeepEqual(storageFake.snapshot(), {});
});

test('storage: profile save and clear lifecycle uses the frozen profile shape', async () => {
  await storageFake.clear();
  const rawJson = { company: { name: 'Futurion' } };
  const entries = LBA.flatten.flattenJson(rawJson);
  entries[0].untrustedExtra = 'discard me';
  const saved = await LBA.storage.saveProfile('profile.json', rawJson, entries);
  assertDeepEqual(Object.keys(saved), [
    'sourceFileName', 'importedAt', 'rawJson', 'flattenedEntries',
  ]);
  assertEqual(Object.hasOwn(saved.flattenedEntries[0], 'untrustedExtra'), false);
  assertTrue(!Number.isNaN(Date.parse(saved.importedAt)));
  assertEqual((await LBA.storage.getState()).state.profile.sourceFileName, 'profile.json');
  assertEqual(await LBA.storage.clearProfile(), null);
  assertEqual((await LBA.storage.getState()).state.profile, null);
});

test('storage: profile validation handles deeply nested raw JSON', async () => {
  await storageFake.clear();
  let rawJson = { leaf: 'value' };
  for (let index = 0; index < 3000; index += 1) {
    rawJson = { node: rawJson };
  }
  const entries = LBA.flatten.flattenJson(rawJson);
  const saved = await LBA.storage.saveProfile('deep.json', rawJson, entries);
  assertEqual(saved.flattenedEntries[0].value, 'value');
});

test('storage: invalid profile input is rejected', async () => {
  await storageFake.clear();
  await assertRejects(
    () => LBA.storage.saveProfile('bad.json', { bad: undefined }, []),
    'Profile data is invalid',
  );
  await assertRejects(
    () => LBA.storage.saveProfile('scalar.json', 'not an object root', []),
    'Profile data is invalid',
  );
});

test('storage: preferences whitelist and validate each field', async () => {
  await storageFake.clear();
  const saved = await LBA.storage.savePreferences({
    insertMode: 'atCursor',
    preferredLanguage: 'es',
    activeScope: 'products',
    scopeOnly: true,
    showNullValues: true,
    maxRecentEntries: 2,
    confirmOversizedValues: false,
    unknown: 'discarded',
  });
  assertDeepEqual(saved, {
    insertMode: 'atCursor',
    preferredLanguage: 'es',
    activeScope: 'products',
    scopeOnly: true,
    showNullValues: true,
    maxRecentEntries: 2,
    confirmOversizedValues: false,
  });
  const afterInvalid = await LBA.storage.savePreferences({
    insertMode: 'append',
    preferredLanguage: 'fr',
    activeScope: 1,
    scopeOnly: 'yes',
    showNullValues: null,
    maxRecentEntries: 0,
    confirmOversizedValues: 1,
  });
  assertDeepEqual(afterInvalid, saved);
});

test('storage: favorites toggle and cleanup return useful results', async () => {
  await storageFake.clear();
  assertEqual(await LBA.storage.toggleFavorite('company.name'), true);
  assertEqual(await LBA.storage.toggleFavorite('company.site'), true);
  assertEqual(await LBA.storage.toggleFavorite('company.name'), false);
  await LBA.storage.toggleFavorite('company.name');
  const cleanup = await LBA.storage.cleanupFavorites(['company.name']);
  assertDeepEqual(cleanup, { favorites: ['company.name'], removedCount: 1 });
});

test('storage: recent use deduplicates, increments, orders, and caps', async () => {
  await storageFake.clear();
  await LBA.storage.savePreferences({ maxRecentEntries: 2 });
  await LBA.storage.recordRecentUse('first');
  await LBA.storage.recordRecentUse('second');
  const recents = await LBA.storage.recordRecentUse('first');
  assertDeepEqual(recents.map((item) => [item.path, item.useCount]), [
    ['first', 2],
    ['second', 1],
  ]);
  const capped = await LBA.storage.recordRecentUse('third');
  assertDeepEqual(capped.map((item) => item.path), ['third', 'first']);
});

test('storage: clearRecent returns and persists an empty list', async () => {
  await storageFake.clear();
  await LBA.storage.recordRecentUse('company.name');
  assertDeepEqual(await LBA.storage.clearRecent(), []);
  assertDeepEqual((await LBA.storage.getState()).state.recent, []);
});

test('storage: malformed state is repaired, canonicalized, and reported once', async () => {
  await storageFake.clear();
  await storageFake.set({
    lba: {
      schemaVersion: 1,
      profile: { broken: true },
      preferences: {
        insertMode: 'bad',
        preferredLanguage: 'en',
        activeScope: '',
        scopeOnly: false,
        showNullValues: false,
        maxRecentEntries: 2,
        confirmOversizedValues: true,
        extra: true,
      },
      favorites: ['b', '', 'a', 'b', 4],
      recent: [
        { path: 'a', lastUsedAt: '2025-01-01T00:00:00.000Z', useCount: 1 },
        { path: 'b', lastUsedAt: '2026-01-01T00:00:00.000Z', useCount: 2 },
        { path: 'a', lastUsedAt: '2027-01-01T00:00:00.000Z', useCount: 3 },
        { broken: true },
      ],
      unknown: 'remove',
    },
  });
  const first = await LBA.storage.getState();
  assertEqual(first.repaired, true);
  assertEqual(first.state.profile, null);
  assertEqual(first.state.preferences.insertMode, 'replace');
  assertDeepEqual(first.state.favorites, ['b', 'a']);
  assertDeepEqual(first.state.recent.map((item) => item.path), ['a', 'b']);
  assertEqual(Object.hasOwn(storageFake.snapshot().lba, 'unknown'), false);
  assertEqual((await LBA.storage.getState()).repaired, false);
});

test('storage: schema migration upgrades legacy state without mutation', () => {
  const legacy = { schemaVersion: 0, favorites: ['company.name'] };
  const migrated = LBA.storage.migrate(legacy);
  assertEqual(migrated.schemaVersion, 1);
  assertEqual(legacy.schemaVersion, 0);
  assertDeepEqual(migrated.favorites, ['company.name']);
});

test('storage: reset removes only lba and returns fresh state', async () => {
  await storageFake.clear();
  await storageFake.set({ lba: { schemaVersion: 1 }, unrelated: { keep: true } });
  const resetState = await LBA.storage.resetAll();
  assertEqual(resetState.profile, null);
  assertEqual(Object.hasOwn(storageFake.snapshot(), 'lba'), false);
  assertDeepEqual(storageFake.snapshot().unrelated, { keep: true });
});

test('storage: byte estimate is the numeric lba-only storage result', async () => {
  await storageFake.clear();
  await storageFake.set({ lba: { value: '12345' }, unrelated: 'ignored' });
  const expected = await storageFake.getBytesInUse('lba');
  const estimate = await LBA.storage.getStorageEstimate();
  assertEqual(typeof estimate, 'number');
  assertEqual(estimate, expected);
});

test('storage: Chrome API failures propagate', async () => {
  const originalGet = chrome.storage.local.get;
  chrome.storage.local.get = async () => {
    throw new Error('storage unavailable');
  };
  await assertRejects(() => LBA.storage.getState(), 'storage unavailable');
  chrome.storage.local.get = originalGet;
});

function makeTypedEntry(path, value, valueType = 'string') {
  const entry = makeEntry(path, value);
  entry.valueType = valueType;
  entry.characterCount = value.length;
  return entry;
}

function createPickerState(entries, overrides = {}) {
  return {
    schemaVersion: 1,
    profile: {
      sourceFileName: 'test.json',
      importedAt: '2026-07-19T12:00:00.000Z',
      rawJson: {},
      flattenedEntries: entries,
    },
    preferences: {
      insertMode: 'replace',
      preferredLanguage: 'none',
      activeScope: '',
      scopeOnly: false,
      showNullValues: false,
      maxRecentEntries: 20,
      confirmOversizedValues: true,
      ...(overrides.preferences || {}),
    },
    favorites: overrides.favorites || [],
    recent: overrides.recent || [],
  };
}

function getPickerHost() {
  return document.querySelector('[data-lba-picker-host]');
}

test('picker: repeated asynchronous opens create one host and cache CSS', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return { ok: true, async text() { return ':host { all: initial; }'; } };
  };
  const firstTarget = document.createElement('input');
  const secondTarget = document.createElement('input');
  document.body.append(firstTarget, secondTarget);
  const entries = [makeEntry('company.name', 'Futurion')];
  const state = createPickerState(entries, {
    favorites: ['company.name'],
  });
  await Promise.all([
    LBA.picker.open({
      targetEl: firstTarget,
      fieldContext: { inputType: 'text', maxLength: 20 },
      state,
    }),
    LBA.picker.open({
      targetEl: secondTarget,
      fieldContext: { inputType: 'text', maxLength: 20 },
      state,
    }),
  ]);
  assertEqual(document.querySelectorAll('[data-lba-picker-host]').length, 1);
  assertEqual(fetchCount, 1);
  assertTrue(getPickerHost().shadowRoot !== null, 'picker shadow root is open');
  LBA.picker.close();
  await LBA.picker.open({
    targetEl: secondTarget,
    fieldContext: { inputType: 'text' },
    state,
  });
  assertEqual(fetchCount, 1, 'stylesheet promise remains cached');
  LBA.picker.close();
  firstTarget.remove();
  secondTarget.remove();
  globalThis.fetch = originalFetch;
});

test('picker: search renders ranked options and keyboard navigation wraps', async () => {
  const target = document.createElement('input');
  document.body.append(target);
  const entries = [
    makeEntry('company.alpha', 'one'),
    makeEntry('company.bravo', 'two'),
    makeEntry('company.charlie', 'three'),
    makeEntry('company.delta', 'four'),
    makeEntry('company.echo', 'five'),
    makeEntry('company.foxtrot', 'six'),
  ];
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { labelText: 'Company', inputType: 'text' },
    state: createPickerState(entries),
  });
  const shadow = getPickerHost().shadowRoot;
  const search = shadow.querySelector('.search');
  search.value = 'company';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const results = shadow.querySelector('[role="listbox"]');
  const rows = [...shadow.querySelectorAll('[role="option"]')];
  assertEqual(rows.length, 6);
  assertEqual(results.getAttribute('aria-activedescendant'), rows[0].id);
  search.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowUp',
    bubbles: true,
  }));
  assertEqual(rows.at(-1).getAttribute('aria-selected'), 'true');
  search.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'PageDown',
    bubbles: true,
  }));
  assertEqual(rows[4].getAttribute('aria-selected'), 'true');
  search.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
  }));
  assertEqual(rows[5].getAttribute('aria-selected'), 'true');
  LBA.picker.close();
  target.remove();
});

test('picker: favorites and recents skip stale paths and remain separate sections', async () => {
  await storageFake.clear();
  await LBA.storage.toggleFavorite('company.name');
  const target = document.createElement('textarea');
  document.body.append(target);
  const entry = makeEntry('company.name', 'Futurion');
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'textarea' },
    state: createPickerState([entry], {
      favorites: ['company.name', 'missing.path'],
      recent: [
        { path: 'company.name', lastUsedAt: '2026-07-19T12:00:00.000Z', useCount: 2 },
        { path: 'missing.path', lastUsedAt: '2026-07-18T12:00:00.000Z', useCount: 1 },
      ],
    }),
  });
  const shadow = getPickerHost().shadowRoot;
  assertEqual(shadow.querySelectorAll('[role="option"]').length, 2);
  assertDeepEqual(
    [...shadow.querySelectorAll('.section-title')].map((node) => node.textContent),
    ['Favorites', 'Recent'],
  );
  const star = shadow.querySelector('.star');
  star.click();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assertEqual((await LBA.storage.getState()).state.favorites.includes('company.name'), false);
  LBA.picker.close();
  target.remove();
});

test('picker: Escape restores focus while outside pointerdown preserves clicked focus', async () => {
  const target = document.createElement('input');
  const outside = document.createElement('button');
  document.body.append(target, outside);
  const state = createPickerState([makeEntry('company.name', 'Futurion')], {
    favorites: ['company.name'],
  });
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'text' },
    state,
  });
  getPickerHost().shadowRoot.querySelector('.panel').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assertEqual(getPickerHost(), null);
  assertEqual(document.activeElement, target);

  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'text' },
    state,
  });
  outside.focus();
  outside.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    composed: true,
  }));
  assertEqual(getPickerHost(), null);
  assertEqual(document.activeElement, outside);
  target.remove();
  outside.remove();
});

test('picker: Tab stays contained and null entries follow the preference', async () => {
  const target = document.createElement('input');
  document.body.append(target);
  const regular = makeEntry('company.name', 'Futurion');
  const empty = makeTypedEntry('company.optional', '', 'null');
  const state = createPickerState([regular, empty], {
    favorites: ['company.name', 'company.optional'],
  });
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'text' },
    state,
  });
  let shadow = getPickerHost().shadowRoot;
  assertEqual(shadow.querySelectorAll('[role="option"]').length, 1);
  const search = shadow.querySelector('.search');
  const lastButton = [...shadow.querySelectorAll('button')].at(-1);
  lastButton.focus();
  lastButton.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
  }));
  assertEqual(shadow.activeElement, search);
  LBA.picker.close();

  state.preferences.showNullValues = true;
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'text' },
    state,
  });
  shadow = getPickerHost().shadowRoot;
  assertEqual(shadow.querySelectorAll('[role="option"]').length, 2);
  const unsafeQuery = '<img src=x onerror=alert(1)>';
  shadow.querySelector('.search').value = unsafeQuery;
  shadow.querySelector('.search').dispatchEvent(new Event('input', { bubbles: true }));
  const emptyResult = shadow.querySelector('.empty');
  assertEqual(
    emptyResult.textContent,
    LBA.constants.ERROR_MESSAGES.NO_SEARCH_RESULTS.replace('{query}', unsafeQuery),
  );
  assertEqual(emptyResult.querySelector('img'), null);
  LBA.picker.close();
  target.remove();
});

test('picker: automatic page language is resolved before ranking', async () => {
  const originalLanguage = document.documentElement.lang;
  document.documentElement.lang = 'es-ES';
  const target = document.createElement('input');
  document.body.append(target);
  const english = makeEntry('descriptions.en.short', 'English');
  const spanish = makeEntry('descriptions.es.short', 'Español');
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'text' },
    state: createPickerState([english, spanish], {
      preferences: { preferredLanguage: 'auto' },
      favorites: [english.path, spanish.path],
    }),
  });
  const firstRow = getPickerHost().shadowRoot.querySelector('[role="option"]');
  assertEqual(firstRow.dataset.path, spanish.path);
  LBA.picker.close();
  target.remove();
  document.documentElement.lang = originalLanguage;
});

test('picker: oversized confirmation inserts untruncated and records only the path', async () => {
  await storageFake.clear();
  const target = document.createElement('textarea');
  target.maxLength = 3;
  target.value = 'old';
  document.body.append(target);
  const entry = makeEntry('company.long', 'lengthy');
  await LBA.picker.open({
    targetEl: target,
    fieldContext: { inputType: 'textarea', maxLength: 3 },
    state: createPickerState([entry], {
      favorites: [entry.path],
    }),
  });
  const shadow = getPickerHost().shadowRoot;
  shadow.querySelector('[role="option"]').click();
  assertEqual(target.value, 'old');
  const alert = shadow.querySelector('[role="alert"]');
  assertTrue(alert.textContent.includes('7 characters'));
  alert.querySelector('button').click();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assertEqual(target.value, 'lengthy');
  assertEqual(getPickerHost(), null);
  const stored = storageFake.snapshot().lba;
  assertDeepEqual(stored.recent.map((item) => Object.keys(item)), [
    ['path', 'lastUsedAt', 'useCount'],
  ]);
  assertEqual(stored.recent[0].path, entry.path);
  target.remove();
});

test('picker: saved contenteditable range survives Shadow DOM focus', async () => {
  await storageFake.clear();
  const editable = document.createElement('div');
  editable.contentEditable = 'true';
  editable.textContent = 'abcd';
  document.body.append(editable);
  const range = document.createRange();
  range.setStart(editable.firstChild, 2);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const entry = makeEntry('company.marker', 'X');
  await LBA.picker.open({
    targetEl: editable,
    fieldContext: { inputType: 'contenteditable' },
    state: createPickerState([entry], {
      preferences: { insertMode: 'atCursor' },
      favorites: [entry.path],
    }),
  });
  const search = getPickerHost().shadowRoot.querySelector('.search');
  search.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
  }));
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assertEqual(editable.textContent, 'abXcd');
  editable.remove();
});

test('insertion: input replacement uses native setter and composed bubbling events', () => {
  const input = document.createElement('input');
  input.value = 'old';
  document.body.append(input);
  const observed = [];
  input.addEventListener('input', (event) => observed.push([
    event.type, event.bubbles, event.composed,
  ]));
  input.addEventListener('change', (event) => observed.push([
    event.type, event.bubbles, event.composed,
  ]));
  const result = LBA.insertion.insertValue(input, 'new', { mode: 'replace' });
  assertDeepEqual(result, { ok: true, reason: null });
  assertEqual(input.value, 'new');
  assertEqual(input.selectionStart, 3);
  assertDeepEqual(observed, [
    ['input', true, true],
    ['change', true, true],
  ]);
  input.remove();
});

test('insertion: input and textarea at-cursor modes splice selected text', () => {
  for (const target of [document.createElement('input'), document.createElement('textarea')]) {
    target.value = 'abEF';
    document.body.append(target);
    target.setSelectionRange(2, 4);
    const result = LBA.insertion.insertValue(target, 'cd', { mode: 'atCursor' });
    assertEqual(result.ok, true);
    assertEqual(target.value, 'abcd');
    assertEqual(target.selectionStart, 4);
    assertEqual(target.selectionEnd, 4);
    target.remove();
  }
});

test('insertion: number input safely falls back when selection APIs are unavailable', () => {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = '12';
  document.body.append(input);
  const result = LBA.insertion.insertValue(input, '3', { mode: 'atCursor' });
  assertEqual(result.ok, true);
  assertEqual(input.value, '123');
  input.remove();
});

test('insertion: contenteditable replace and cursor insertion use text nodes only', () => {
  const editable = document.createElement('div');
  editable.contentEditable = 'true';
  document.body.append(editable);
  let inputEvents = 0;
  editable.addEventListener('input', () => { inputEvents += 1; });
  assertEqual(
    LBA.insertion.insertValue(editable, '<b>plain</b>', { mode: 'replace' }).ok,
    true,
  );
  assertEqual(editable.textContent, '<b>plain</b>');
  assertEqual(editable.querySelector('b'), null);

  const range = document.createRange();
  range.setStart(editable.firstChild, 3);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  assertEqual(
    LBA.insertion.insertValue(editable, 'X', { mode: 'atCursor' }).ok,
    true,
  );
  assertEqual(editable.textContent, '<b>Xplain</b>');
  assertEqual(inputEvents, 2);
  editable.remove();
});

test('insertion: removed target and maxlength rejection are precise and non-mutating', () => {
  const removed = document.createElement('input');
  assertDeepEqual(
    LBA.insertion.insertValue(removed, 'value', { mode: 'replace' }),
    { ok: false, reason: LBA.constants.ERROR_MESSAGES.FIELD_REMOVED },
  );
  const input = document.createElement('input');
  input.maxLength = 3;
  input.value = 'old';
  document.body.append(input);
  assertDeepEqual(
    LBA.insertion.insertValue(input, 'lengthy', { mode: 'replace' }),
    { ok: false, reason: 'Value is 7 characters, field allows 3.' },
  );
  assertEqual(input.value, 'old');
  assertEqual(
    LBA.insertion.insertValue(input, 'lengthy', {
      mode: 'replace',
      confirmOversized: true,
    }).ok,
    true,
  );
  assertEqual(input.value, 'lengthy', 'explicit override never truncates');
  input.remove();
});

test('ranking: scope uses segment-safe prefix filtering and ignores empty scope', () => {
  const entries = [
    makeEntry('products.alpha.name'),
    makeEntry('productsExtra.alpha.name'),
    makeEntry('company.name'),
  ];
  const scored = entries.map((entry) => ({ entry, baseScore: 0 }));
  const scoped = LBA.ranking.rankEntries(scored, {
    preferences: { activeScope: 'products', scopeOnly: false },
  });
  assertEqual(scoped[0].entry.path, 'products.alpha.name');
  assertEqual(scoped[0].score, 4);
  const filtered = LBA.ranking.rankEntries(scored, {
    preferences: { activeScope: 'products', scopeOnly: true },
  });
  assertDeepEqual(filtered.map((item) => item.entry.path), ['products.alpha.name']);
  assertEqual(
    LBA.ranking.rankEntries(scored, {
      preferences: { activeScope: '', scopeOnly: true },
    }).length,
    3,
  );
});

test('ranking: explicit language aliases boost preferred and penalize other languages', () => {
  const english = makeEntry('descriptions.english.short');
  const spanish = makeEntry('descriptions.español.short');
  const ranked = LBA.ranking.rankEntries([
    { entry: english, baseScore: 0 },
    { entry: spanish, baseScore: 0 },
  ], {
    preferences: { preferredLanguage: 'es' },
  });
  assertEqual(ranked[0].entry.path, spanish.path);
  assertEqual(ranked[0].score, 3);
  assertEqual(ranked[1].score, -2);
});

test('ranking: synonym matches and stackable input heuristics use normalized context', () => {
  const email = makeTypedEntry('contact.correo_electrónico', 'hello@example.com');
  const other = makeEntry('contact.notes', 'hello');
  const ranked = LBA.ranking.rankEntries([
    { entry: other, baseScore: 0 },
    { entry: email, baseScore: 0 },
  ], {
    preferences: { preferredLanguage: 'none' },
    fieldContext: {
      labelText: 'CORREO ELECTRÓNICO',
      inputType: 'email',
    },
  });
  assertEqual(ranked[0].entry.path, email.path);
  assertEqual(ranked[0].score, 5);
});

test('ranking: URL, telephone, and numeric heuristics are specific', () => {
  const url = makeEntry('website.primary', 'HTTPS://example.com');
  const phone = makeEntry('phone.primary', '+34 (600) 123-456');
  const shortPhone = makeEntry('phone.short', '12-34');
  const number = makeTypedEntry('company.year', '2026', 'number');
  assertEqual(LBA.ranking.rankEntries([{ entry: url, baseScore: 0 }], {
    fieldContext: { inputType: 'url' },
  })[0].score, 2);
  assertEqual(LBA.ranking.rankEntries([{ entry: phone, baseScore: 0 }], {
    fieldContext: { inputType: 'tel' },
  })[0].score, 2);
  assertEqual(LBA.ranking.rankEntries([{ entry: shortPhone, baseScore: 0 }], {
    fieldContext: { inputType: 'tel' },
  })[0].score, 0);
  assertEqual(LBA.ranking.rankEntries([{ entry: number, baseScore: 0 }], {
    fieldContext: { inputType: 'number' },
  })[0].score, 2);
});

test('ranking: maxlength compatibility stacks with favorite and recency bonuses', () => {
  const compatible = makeEntry('a', '123');
  const oversized = makeEntry('b', '123456');
  const ranked = LBA.ranking.rankEntries([
    { entry: oversized, baseScore: 0 },
    { entry: compatible, baseScore: 0 },
  ], {
    favorites: ['b'],
    recent: [{ path: 'b', useCount: 8 }],
    fieldContext: { maxLength: 4 },
  });
  assertEqual(ranked.find((item) => item.entry.path === 'a').score, 2);
  assertEqual(ranked.find((item) => item.entry.path === 'b').score, 5);
});

test('storage snapshot never persists DOM elements or raw field context', async () => {
  function containsForbiddenObject(value, seen = new WeakSet()) {
    if (value instanceof Element) {
      return true;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.entries(value).some(([key, child]) => (
      ['fieldContext', 'targetEl'].includes(key)
      || containsForbiddenObject(child, seen)
    ));
  }
  const snapshot = storageFake.snapshot();
  assertEqual(containsForbiddenObject(snapshot), false);
});

test('content: no profile toast exposes a working Open options action', async () => {
  await storageFake.clear();
  const notifications = [];
  const originalNotifications = LBA.notifications;
  LBA.notifications = {
    show(message, kind, action) {
      notifications.push({ message, kind, action });
    },
  };
  sentRuntimeMessages.length = 0;
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertEqual(notifications.length, 1);
  assertEqual(notifications[0].message, LBA.constants.ERROR_MESSAGES.NO_PROFILE);
  assertEqual(notifications[0].action.label, LBA.constants.PICKER_LABELS.OPEN_OPTIONS);
  notifications[0].action.onClick();
  assertDeepEqual(sentRuntimeMessages, [{
    type: LBA.constants.MESSAGE_TYPES.OPEN_OPTIONS,
  }]);
  LBA.notifications = originalNotifications;
});

test('content: focused unsupported field overrides last supported fallback', async () => {
  const entry = makeEntry('company.name', 'Futurion');
  await storageFake.clear();
  await LBA.storage.saveProfile('test.json', {}, [entry]);
  const supported = document.createElement('input');
  const unsupported = document.createElement('input');
  unsupported.type = 'checkbox';
  document.body.append(supported, unsupported);
  supported.focus();
  unsupported.focus();
  const notifications = [];
  const originalNotifications = LBA.notifications;
  const originalPicker = LBA.picker;
  let opened = false;
  LBA.notifications = { show(message) { notifications.push(message); } };
  LBA.picker = { open() { opened = true; } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertEqual(opened, false);
  assertTrue(notifications[0].includes('checkbox'));
  assertTrue(notifications[0].includes('Checkboxes are not supported.'));
  LBA.notifications = originalNotifications;
  LBA.picker = originalPicker;
  supported.remove();
  unsupported.remove();
});

test('content: toolbar invocation falls back to the last supported field', async () => {
  const entry = makeEntry('company.name', 'Futurion');
  await storageFake.clear();
  await LBA.storage.saveProfile('test.json', {}, [entry]);
  const supported = document.createElement('textarea');
  const nonField = document.createElement('button');
  document.body.append(supported, nonField);
  supported.focus();
  nonField.focus();
  const originalPicker = LBA.picker;
  let openedTarget = null;
  LBA.picker = { open(options) { openedTarget = options.targetEl; } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'command',
  });
  assertEqual(openedTarget, supported);
  LBA.picker = originalPicker;
  supported.remove();
  nonField.remove();
});

test('content: invocation resolves a focused field in a same-origin iframe', async () => {
  const entry = makeEntry('company.name', 'Futurion');
  await storageFake.clear();
  await LBA.storage.saveProfile('test.json', {}, [entry]);
  const frame = document.createElement('iframe');
  frame.srcdoc = '<!doctype html><label>Name <input id="field"></label>';
  document.body.append(frame);
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const frameField = frame.contentDocument.getElementById('field');
  frameField.focus();
  const originalPicker = LBA.picker;
  let openedTarget = null;
  LBA.picker = { open(options) { openedTarget = options.targetEl; } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertEqual(openedTarget, frameField);
  LBA.picker = originalPicker;
  frame.remove();
});

test('content: inaccessible focused iframe is rejected without document traversal', async () => {
  const entry = makeEntry('company.name', 'Futurion');
  await storageFake.clear();
  await LBA.storage.saveProfile('test.json', {}, [entry]);
  const frame = document.createElement('iframe');
  frame.sandbox = '';
  frame.srcdoc = '<!doctype html><input autofocus>';
  document.body.append(frame);
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.focus();
  const notifications = [];
  const originalNotifications = LBA.notifications;
  LBA.notifications = { show(message) { notifications.push(message); } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'contextMenu',
  });
  assertEqual(
    notifications.at(-1),
    LBA.constants.ERROR_MESSAGES.IFRAME_ACCESS_RESTRICTION,
  );
  LBA.notifications = originalNotifications;
  frame.remove();
});

test('content: picker delivery is acknowledged synchronously', async () => {
  const responses = await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertDeepEqual(responses, [{
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER_ACK,
  }]);
});

test('content: repair notice is combined with an immediate no-profile error', async () => {
  await storageFake.clear();
  await storageFake.set({ lba: { schemaVersion: 1, profile: 'broken' } });
  const notifications = [];
  const originalNotifications = LBA.notifications;
  LBA.notifications = { show(message) { notifications.push(message); } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertTrue(notifications[0].startsWith(
    LBA.constants.ERROR_MESSAGES.MALFORMED_STORED_DATA,
  ));
  assertTrue(notifications[0].includes(LBA.constants.ERROR_MESSAGES.NO_PROFILE));
  LBA.notifications = originalNotifications;
});

test('content: storage read failures produce a precise toast', async () => {
  const originalGet = chrome.storage.local.get;
  chrome.storage.local.get = async () => {
    throw new Error('quota backend unavailable');
  };
  const notifications = [];
  const originalNotifications = LBA.notifications;
  LBA.notifications = { show(message) { notifications.push(message); } };
  await dispatchRuntimeMessage({
    type: LBA.constants.MESSAGE_TYPES.OPEN_PICKER,
    trigger: 'action',
  });
  assertEqual(
    notifications[0],
    LBA.constants.ERROR_MESSAGES.STORAGE_FAILURE.replace(
      '{detail}',
      'quota backend unavailable',
    ),
  );
  chrome.storage.local.get = originalGet;
  LBA.notifications = originalNotifications;
});

test('service worker: repeated installation leaves one deterministic context menu', async () => {
  serviceWorkerCalls.length = 0;
  installedListeners[0]();
  await flushAsyncWork();
  installedListeners[0]();
  await flushAsyncWork();
  assertDeepEqual(
    serviceWorkerCalls.map((call) => call[0]),
    ['removeAll', 'create', 'removeAll', 'create'],
  );
  const creates = serviceWorkerCalls.filter((call) => call[0] === 'create');
  assertEqual(creates[0][1].id, 'lba-insert');
  assertDeepEqual(creates[0][1].contexts, ['editable']);
});

test('service worker: restricted action sets a per-tab error without injection', async () => {
  serviceWorkerCalls.length = 0;
  actionClickListeners[0]({ id: 7, url: 'chrome://settings/' });
  await flushAsyncWork();
  assertEqual(serviceWorkerCalls.some((call) => call[0] === 'executeScript'), false);
  assertDeepEqual(serviceWorkerCalls.find((call) => call[0] === 'setBadgeText')[1], {
    tabId: 7,
    text: '!',
  });
  assertTrue(
    serviceWorkerCalls.find((call) => call[0] === 'setTitle')[1].title
      .includes('browser internal pages'),
  );
});

test('service worker: acknowledged action injects frozen order and clears badge', async () => {
  serviceWorkerCalls.length = 0;
  const diagnostics = [];
  const originalConsoleError = console.error;
  console.error = (message) => { diagnostics.push(String(message)); };
  try {
    actionClickListeners[0]({ id: 8, url: 'http://localhost:8000/tests/manual-test.html' });
    await flushAsyncWork();
    await flushAsyncWork();
  } finally {
    console.error = originalConsoleError;
  }
  const executeScriptCalls = serviceWorkerCalls.filter((call) => call[0] === 'executeScript');
  assertEqual(executeScriptCalls[0][1].probe, true);
  const injection = executeScriptCalls.find((call) => call[1].files)[1];
  assertDeepEqual(injection.target, { tabId: 8 });
  assertDeepEqual(injection.files, [
    'shared/constants.js',
    'shared/normalization.js',
    'shared/synonyms.js',
    'shared/flatten-json.js',
    'shared/search.js',
    'shared/ranking.js',
    'shared/storage.js',
    'content/notifications.js',
    'content/field-context.js',
    'content/insertion.js',
    'content/picker.js',
    'content/content-script.js',
  ]);
  assertDeepEqual(serviceWorkerCalls.find((call) => call[0] === 'sendMessage').slice(1), [
    8,
    { type: 'LBA_OPEN_PICKER', trigger: 'action' },
  ]);
  assertDeepEqual(serviceWorkerCalls.filter((call) => call[0] === 'setBadgeText').at(-1)[1], {
    tabId: 8,
    text: '',
  });
  assertEqual(
    diagnostics.some((message) => message.includes('unreachable')),
    false,
  );
});

test('service worker: repeat invocation skips re-injection when the content script is present', async () => {
  serviceWorkerCalls.length = 0;
  fakeTabAlreadyInjected = true;
  try {
    actionClickListeners[0]({ id: 12, url: 'http://localhost:8000/tests/manual-test.html' });
    await flushAsyncWork();
    await flushAsyncWork();
  } finally {
    fakeTabAlreadyInjected = false;
  }
  const executeScriptCalls = serviceWorkerCalls.filter((call) => call[0] === 'executeScript');
  assertEqual(executeScriptCalls.length, 1);
  assertEqual(executeScriptCalls[0][1].probe, true);
  assertDeepEqual(serviceWorkerCalls.find((call) => call[0] === 'sendMessage').slice(1), [
    12,
    { type: 'LBA_OPEN_PICKER', trigger: 'action' },
  ]);
  assertDeepEqual(serviceWorkerCalls.filter((call) => call[0] === 'setBadgeText').at(-1)[1], {
    tabId: 12,
    text: '',
  });
});

test('service worker: missing receiver retains the unreachable badge explanation', async () => {
  serviceWorkerCalls.length = 0;
  canDeliverTabMessages = false;
  try {
    actionClickListeners[0]({ id: 9, url: 'http://localhost:8000/tests/manual-test.html' });
    await flushAsyncWork();
    await flushAsyncWork();
  } finally {
    canDeliverTabMessages = true;
  }
  assertDeepEqual(serviceWorkerCalls.filter((call) => call[0] === 'setBadgeText').at(-1)[1], {
    tabId: 9,
    text: '!',
  });
  assertTrue(
    serviceWorkerCalls.filter((call) => call[0] === 'setTitle').at(-1)[1].title
      .includes('could not reach this page after injection'),
  );
});

test('service worker: invalid receiver acknowledgement is treated as unreachable', async () => {
  serviceWorkerCalls.length = 0;
  const originalSendMessage = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (tabId, message, callback) => {
    serviceWorkerCalls.push(['sendMessage', tabId, clone(message)]);
    callback({ type: 'INVALID_ACK' });
  };
  try {
    actionClickListeners[0]({ id: 10, url: 'https://example.test/form' });
    await flushAsyncWork();
    await flushAsyncWork();
  } finally {
    chrome.tabs.sendMessage = originalSendMessage;
  }
  assertDeepEqual(serviceWorkerCalls.filter((call) => call[0] === 'setBadgeText').at(-1)[1], {
    tabId: 10,
    text: '!',
  });
});

test('localhost restricted iframe route acknowledges delivery without opening or inserting', async () => {
  const entry = makeEntry('company.name', 'Futurion');
  await storageFake.clear();
  await LBA.storage.saveProfile('test.json', {}, [entry]);
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-forms';
  frame.srcdoc = '<!doctype html><input id="restricted" value="unchanged" autofocus>';
  const frameLoaded = new Promise((resolve) => {
    frame.addEventListener('load', resolve, { once: true });
  });
  document.body.append(frame);
  await Promise.race([
    frameLoaded,
    new Promise((resolve) => globalThis.setTimeout(resolve, 100)),
  ]);
  frame.focus();
  const notifications = [];
  const originalNotifications = LBA.notifications;
  const originalPicker = LBA.picker;
  let pickerOpenCount = 0;
  LBA.notifications = { show(message) { notifications.push(message); } };
  LBA.picker = { open() { pickerOpenCount += 1; } };
  serviceWorkerCalls.length = 0;
  try {
    actionClickListeners[0]({ id: 11, url: 'http://localhost:8000/tests/manual-test.html' });
    await flushAsyncWork();
    await flushAsyncWork();
    assertEqual(notifications.at(-1), LBA.constants.ERROR_MESSAGES.IFRAME_ACCESS_RESTRICTION);
    assertEqual(pickerOpenCount, 0);
    assertEqual(frame.getAttribute('srcdoc').includes('value="unchanged"'), true);
    assertDeepEqual(serviceWorkerCalls.filter((call) => call[0] === 'setBadgeText').at(-1)[1], {
      tabId: 11,
      text: '',
    });
  } finally {
    LBA.notifications = originalNotifications;
    LBA.picker = originalPicker;
    frame.remove();
  }
});

test('service worker: command, context menu, and options listeners route frozen messages', async () => {
  serviceWorkerCalls.length = 0;
  commandListeners[0]('unrelated');
  commandListeners[0]('open-picker');
  contextMenuClickListeners[0]({ menuItemId: 'unrelated' }, { id: 1 });
  contextMenuClickListeners[0]({ menuItemId: 'lba-insert' }, {
    id: 2,
    url: 'https://example.test/form',
  });
  for (const listener of runtimeMessageListeners) {
    listener({ type: 'LBA_OPEN_OPTIONS' }, {}, () => {});
  }
  await flushAsyncWork();
  await flushAsyncWork();
  assertEqual(serviceWorkerCalls.filter((call) => call[0] === 'query').length, 1);
  const messages = serviceWorkerCalls
    .filter((call) => call[0] === 'sendMessage')
    .map((call) => call[2].trigger)
    .sort();
  assertDeepEqual(messages, ['command', 'contextMenu']);
  assertEqual(serviceWorkerCalls.filter((call) => call[0] === 'openOptionsPage').length, 1);
});

async function runTests() {
  const resultList = document.getElementById('results');
  let failureCount = 0;

  for (const { name, callback } of tests) {
    const resultItem = document.createElement('li');
    try {
      await callback();
      results.push({ name, passed: true });
      resultItem.className = 'pass';
      resultItem.textContent = `PASS — ${name}`;
    } catch (error) {
      failureCount += 1;
      results.push({ name, passed: false, error });
      resultItem.className = 'fail';
      resultItem.textContent = `FAIL — ${name}\n${error.stack || error.message || String(error)}`;
    }
    resultList.append(resultItem);
  }

  const passCount = tests.length - failureCount;
  const summary = `${passCount}/${tests.length} passed; ${failureCount} failed`;
  document.getElementById('summary').textContent = summary;
  document.documentElement.dataset.testStatus = failureCount === 0 ? 'passed' : 'failed';
  document.documentElement.dataset.testTotal = String(tests.length);
  document.documentElement.dataset.testPassed = String(passCount);
  document.documentElement.dataset.testFailures = String(failureCount);

  console.group(`TrustPaste unit tests: ${summary}`);
  for (const result of results) {
    if (result.passed) {
      console.log(`PASS — ${result.name}`);
    } else {
      console.error(`FAIL — ${result.name}`, result.error);
    }
  }
  console.groupEnd();
}

globalThis.LBA.tests = Object.freeze({
  assertEqual,
  assertTrue,
  results,
});

function loadHarnessScript(source, failureMessage) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => {
      reject(new Error(failureMessage));
    }, { once: true });
    document.body.append(script);
  });
}

loadHarnessScript(
  '../content/content-script.js',
  'Content script could not be loaded into the browser harness.',
).then(() => loadHarnessScript(
  '../background/service-worker.js',
  'Service worker could not be loaded into the browser harness.',
)).then(runTests).catch((error) => {
  document.documentElement.dataset.testStatus = 'failed';
  document.documentElement.dataset.testFailures = '1';
  document.getElementById('summary').textContent = `Test runner failed: ${error.message}`;
  console.error('TrustPaste test runner failed', error);
});
