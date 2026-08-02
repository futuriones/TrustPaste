'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (globalThis.LBA.storage) {
    return;
  }

  const STORAGE_KEY = 'lba';
  const { SCHEMA_VERSION, PRIVACY_POLICY_VERSION } = globalThis.LBA.constants;
  const DEFAULT_MAX_RECENT_ENTRIES = 20;
  const INSERT_MODES = new Set(['replace', 'atCursor']);
  const PREFERRED_LANGUAGES = new Set(['auto', 'en', 'es', 'none']);
  const PREFERENCE_KEYS = Object.freeze([
    'insertMode',
    'preferredLanguage',
    'activeScope',
    'scopeOnly',
    'showNullValues',
    'maxRecentEntries',
    'confirmOversizedValues',
  ]);

  function createDefaultPreferences() {
    return {
      insertMode: 'replace',
      preferredLanguage: 'auto',
      activeScope: '',
      scopeOnly: false,
      showNullValues: false,
      maxRecentEntries: DEFAULT_MAX_RECENT_ENTRIES,
      confirmOversizedValues: true,
    };
  }

  function createDefaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profile: null,
      preferences: createDefaultPreferences(),
      favorites: [],
      recent: [],
      privacyConsent: null,
    };
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isValidDateString(value) {
    return (
      typeof value === 'string'
      && !Number.isNaN(Date.parse(value))
      && new Date(value).toISOString() === value
    );
  }

  function isValidJsonValue(rootValue) {
    const seen = new WeakSet();
    const stack = [rootValue];

    while (stack.length > 0) {
      const value = stack.pop();
      if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        continue;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          return false;
        }
        continue;
      }
      if (typeof value !== 'object' || seen.has(value)) {
        return false;
      }

      seen.add(value);
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index)) {
            return false;
          }
          stack.push(value[index]);
        }
        continue;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return false;
      }
      for (const key of Object.keys(value)) {
        stack.push(value[key]);
      }
    }

    return true;
  }

  function sanitizeEntry(entry) {
    if (
      !isRecord(entry)
      || typeof entry.path !== 'string'
      || entry.path.length === 0
      || !Array.isArray(entry.pathSegments)
      || entry.pathSegments.length === 0
      || !entry.pathSegments.every((segment) => typeof segment === 'string')
      || entry.pathSegments.join('.') !== entry.path
      || typeof entry.label !== 'string'
      || entry.label !== entry.pathSegments[entry.pathSegments.length - 1]
      || typeof entry.value !== 'string'
      || !['string', 'number', 'boolean', 'null'].includes(entry.valueType)
      || !Number.isInteger(entry.characterCount)
      || entry.characterCount !== entry.value.length
      || typeof entry.searchableText !== 'string'
    ) {
      return null;
    }

    return {
      path: entry.path,
      pathSegments: [...entry.pathSegments],
      label: entry.label,
      value: entry.value,
      valueType: entry.valueType,
      characterCount: entry.characterCount,
      searchableText: entry.searchableText,
    };
  }

  function sanitizeProfile(profile) {
    if (
      !isRecord(profile)
      || typeof profile.sourceFileName !== 'string'
      || profile.sourceFileName.length === 0
      || !isValidDateString(profile.importedAt)
      || (!isRecord(profile.rawJson) && !Array.isArray(profile.rawJson))
      || !isValidJsonValue(profile.rawJson)
      || !Array.isArray(profile.flattenedEntries)
    ) {
      return null;
    }

    const flattenedEntries = profile.flattenedEntries.map(sanitizeEntry);
    if (flattenedEntries.some((entry) => entry === null)) {
      return null;
    }

    return {
      sourceFileName: profile.sourceFileName,
      importedAt: profile.importedAt,
      rawJson: profile.rawJson,
      flattenedEntries,
    };
  }

  function isValidPreference(key, value) {
    switch (key) {
      case 'insertMode':
        return INSERT_MODES.has(value);
      case 'preferredLanguage':
        return PREFERRED_LANGUAGES.has(value);
      case 'activeScope':
        return typeof value === 'string';
      case 'scopeOnly':
      case 'showNullValues':
      case 'confirmOversizedValues':
        return typeof value === 'boolean';
      case 'maxRecentEntries':
        return Number.isInteger(value) && value >= 1 && value <= 100;
      default:
        return false;
    }
  }

  function sanitizePreferences(preferences) {
    const sanitized = createDefaultPreferences();
    if (!isRecord(preferences)) {
      return sanitized;
    }

    for (const key of PREFERENCE_KEYS) {
      if (isValidPreference(key, preferences[key])) {
        sanitized[key] = preferences[key];
      }
    }
    return sanitized;
  }

  function sanitizeFavorites(favorites) {
    if (!Array.isArray(favorites)) {
      return [];
    }

    return [...new Set(
      favorites.filter((path) => typeof path === 'string' && path.length > 0),
    )];
  }

  function sanitizeRecent(recent, maximumEntries) {
    if (!Array.isArray(recent)) {
      return [];
    }

    const validItems = recent
      .filter((item) => (
        isRecord(item)
        && typeof item.path === 'string'
        && item.path.length > 0
        && isValidDateString(item.lastUsedAt)
        && Number.isInteger(item.useCount)
        && item.useCount >= 1
      ))
      .map((item, originalPosition) => ({
        path: item.path,
        lastUsedAt: item.lastUsedAt,
        useCount: item.useCount,
        originalPosition,
      }))
      .sort((left, right) => (
        Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt)
        || left.originalPosition - right.originalPosition
      ));

    const seenPaths = new Set();
    const sanitized = [];
    for (const item of validItems) {
      if (seenPaths.has(item.path)) {
        continue;
      }
      seenPaths.add(item.path);
      sanitized.push({
        path: item.path,
        lastUsedAt: item.lastUsedAt,
        useCount: item.useCount,
      });
      if (sanitized.length === maximumEntries) {
        break;
      }
    }
    return sanitized;
  }

  function sanitizePrivacyConsent(privacyConsent) {
    if (privacyConsent === null || privacyConsent === undefined) {
      return null;
    }
    if (
      !isRecord(privacyConsent)
      || typeof privacyConsent.policyVersion !== 'string'
      || privacyConsent.policyVersion.length === 0
      || !isValidDateString(privacyConsent.acceptedAt)
    ) {
      return null;
    }
    return {
      policyVersion: privacyConsent.policyVersion,
      acceptedAt: privacyConsent.acceptedAt,
    };
  }

  function migrate(state) {
    if (!isRecord(state)) {
      return createDefaultState();
    }

    switch (state.schemaVersion) {
      case SCHEMA_VERSION:
        return { ...state };
      case 1:
        return {
          ...state,
          schemaVersion: SCHEMA_VERSION,
          privacyConsent: null,
        };
      case undefined:
      case 0:
        return { ...state, schemaVersion: SCHEMA_VERSION };
      default:
        return createDefaultState();
    }
  }

  function sanitizeState(candidate) {
    const migrated = migrate(candidate);
    const preferences = sanitizePreferences(migrated.preferences);

    return {
      schemaVersion: SCHEMA_VERSION,
      profile: migrated.profile === null ? null : sanitizeProfile(migrated.profile),
      preferences,
      favorites: sanitizeFavorites(migrated.favorites),
      recent: sanitizeRecent(migrated.recent, preferences.maxRecentEntries),
      privacyConsent: sanitizePrivacyConsent(migrated.privacyConsent),
    };
  }

  function statesAreEqual(left, right) {
    const comparedObjects = new WeakMap();
    const stack = [[left, right]];

    while (stack.length > 0) {
      const [leftValue, rightValue] = stack.pop();
      if (Object.is(leftValue, rightValue)) {
        continue;
      }
      if (
        leftValue === null
        || rightValue === null
        || typeof leftValue !== 'object'
        || typeof rightValue !== 'object'
        || Array.isArray(leftValue) !== Array.isArray(rightValue)
      ) {
        return false;
      }

      if (comparedObjects.has(leftValue)) {
        if (comparedObjects.get(leftValue) !== rightValue) {
          return false;
        }
        continue;
      }
      comparedObjects.set(leftValue, rightValue);

      const leftKeys = Object.keys(leftValue);
      const rightKeys = Object.keys(rightValue);
      if (
        leftKeys.length !== rightKeys.length
        || !leftKeys.every((key) => Object.hasOwn(rightValue, key))
      ) {
        return false;
      }
      for (const key of leftKeys) {
        stack.push([leftValue[key], rightValue[key]]);
      }
    }

    return true;
  }

  async function persistState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    return state;
  }

  async function getState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (!Object.hasOwn(stored, STORAGE_KEY)) {
      return { state: createDefaultState(), repaired: false };
    }

    const state = sanitizeState(stored[STORAGE_KEY]);
    const repaired = !statesAreEqual(stored[STORAGE_KEY], state);
    if (repaired) {
      await persistState(state);
    }
    return { state, repaired };
  }

  async function saveProfile(fileName, rawJson, flattenedEntries) {
    const profile = sanitizeProfile({
      sourceFileName: fileName,
      importedAt: new Date().toISOString(),
      rawJson,
      flattenedEntries,
    });
    if (profile === null) {
      throw new TypeError('Profile data is invalid.');
    }

    const { state } = await getState();
    state.profile = profile;
    await persistState(state);
    return profile;
  }

  async function clearProfile() {
    const { state } = await getState();
    state.profile = null;
    await persistState(state);
    return null;
  }

  async function getPreferences() {
    const { state } = await getState();
    return state.preferences;
  }

  async function savePreferences(patch) {
    if (!isRecord(patch)) {
      throw new TypeError('Preference patch must be an object.');
    }

    const { state } = await getState();
    for (const key of PREFERENCE_KEYS) {
      if (Object.hasOwn(patch, key) && isValidPreference(key, patch[key])) {
        state.preferences[key] = patch[key];
      }
    }
    state.recent = sanitizeRecent(state.recent, state.preferences.maxRecentEntries);
    await persistState(state);
    return state.preferences;
  }

  async function toggleFavorite(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('Favorite path must be a non-empty string.');
    }

    const { state } = await getState();
    const index = state.favorites.indexOf(path);
    let isFavorite;
    if (index === -1) {
      state.favorites.push(path);
      isFavorite = true;
    } else {
      state.favorites.splice(index, 1);
      isFavorite = false;
    }
    await persistState(state);
    return isFavorite;
  }

  async function cleanupFavorites(validPaths) {
    if (!Array.isArray(validPaths)) {
      throw new TypeError('Valid paths must be an array.');
    }

    const allowedPaths = new Set(
      validPaths.filter((path) => typeof path === 'string' && path.length > 0),
    );
    const { state } = await getState();
    const previousCount = state.favorites.length;
    state.favorites = state.favorites.filter((path) => allowedPaths.has(path));
    await persistState(state);
    return {
      favorites: state.favorites,
      removedCount: previousCount - state.favorites.length,
    };
  }

  async function recordRecentUse(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('Recent path must be a non-empty string.');
    }

    const { state } = await getState();
    const existing = state.recent.find((item) => item.path === path);
    const updatedItem = {
      path,
      lastUsedAt: new Date().toISOString(),
      useCount: existing ? existing.useCount + 1 : 1,
    };
    state.recent = [
      updatedItem,
      ...state.recent.filter((item) => item.path !== path),
    ].slice(0, state.preferences.maxRecentEntries);
    await persistState(state);
    return state.recent;
  }

  async function clearRecent() {
    const { state } = await getState();
    state.recent = [];
    await persistState(state);
    return state.recent;
  }

  async function savePrivacyConsent() {
    const { state } = await getState();
    const privacyConsent = {
      policyVersion: PRIVACY_POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    state.privacyConsent = privacyConsent;
    await persistState(state);
    return privacyConsent;
  }

  async function resetAll() {
    await chrome.storage.local.remove(STORAGE_KEY);
    return createDefaultState();
  }

  async function getStorageEstimate() {
    return chrome.storage.local.getBytesInUse(STORAGE_KEY);
  }

  globalThis.LBA.storage = Object.freeze({
    getState,
    saveProfile,
    clearProfile,
    getPreferences,
    savePreferences,
    toggleFavorite,
    cleanupFavorites,
    recordRecentUse,
    clearRecent,
    savePrivacyConsent,
    resetAll,
    migrate,
    getStorageEstimate,
  });
})();
