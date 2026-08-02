'use strict';

globalThis.LBA = globalThis.LBA || {};

const DEFAULT_PREFERENCES = Object.freeze({
  insertMode: 'replace',
  preferredLanguage: 'auto',
  activeScope: '',
  scopeOnly: false,
  showNullValues: false,
  maxRecentEntries: 20,
  confirmOversizedValues: true,
});
const MIN_RECENT_ENTRIES = 5;
const MAX_RECENT_ENTRIES = 50;
const UTF8_JSON_TYPE = 'application/json;charset=utf-8';
const { OPTIONS_LABELS, PRIVACY_POLICY_VERSION } = LBA.constants;

const elements = {};
let currentState = null;
let mutationQueue = Promise.resolve();

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required options-page element is missing: ${id}`);
  }
  return element;
}

function cacheElements() {
  const ids = [
    'repair-notice',
    'initialization-error',
    'profile-file',
    'privacy-acknowledgment',
    'selected-file-name',
    'import-profile',
    'profile-status',
    'profile-error',
    'profile-state-badge',
    'profile-file-name',
    'profile-imported-at',
    'profile-entry-count',
    'export-profile',
    'clear-profile',
    'reset-extension',
    'profile-preview',
    'preferences-status',
    'preferences-error',
    'preferred-language',
    'active-scope',
    'max-recent-entries',
    'scope-only',
    'show-null-values',
    'confirm-oversized-values',
    'favorites-count',
    'favorites-status',
    'favorites-error',
    'favorites-list',
    'favorites-empty',
    'clear-favorites',
    'diagnostics-status',
    'diagnostics-error',
    'extension-version',
    'diagnostic-entry-count',
    'storage-usage',
    'recent-state',
    'clear-recent',
    'reset-preferences',
  ];
  for (const id of ids) {
    elements[id] = getElement(id);
  }
  elements.insertModeInputs = [...document.querySelectorAll('input[name="insert-mode"]')];
  if (elements.insertModeInputs.length !== 2) {
    throw new Error('Insert mode controls are missing.');
  }
}

function setMessage(element, message) {
  element.textContent = message;
  element.hidden = message.length === 0;
}

function clearSectionMessages(sectionName) {
  setMessage(elements[`${sectionName}-status`], '');
  setMessage(elements[`${sectionName}-error`], '');
}

function formatError(error, fallback) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}

function setControlsDisabled(controls, isDisabled) {
  for (const control of controls) {
    control.disabled = isDisabled;
  }
}

function hasCurrentPrivacyConsent(state) {
  return state !== null
    && state.privacyConsent !== null
    && state.privacyConsent.policyVersion === PRIVACY_POLICY_VERSION;
}

function updateImportAvailability() {
  elements['import-profile'].disabled = !elements['privacy-acknowledgment'].checked;
}

function restoreControlAvailability(controls) {
  for (const control of controls) {
    if (
      control === elements['export-profile']
      || control === elements['clear-profile']
    ) {
      control.disabled = !currentState || currentState.profile === null;
    } else if (control === elements['import-profile']) {
      control.disabled = !elements['privacy-acknowledgment'].checked;
    } else if (control === elements['clear-favorites']) {
      control.disabled = !currentState || currentState.favorites.length === 0;
    } else if (control === elements['clear-recent']) {
      control.disabled = !currentState || currentState.recent.length === 0;
    } else {
      control.disabled = false;
    }
  }
}

function enqueueMutation(task, controls, errorElement, fallbackMessage) {
  const run = async () => {
    setControlsDisabled(controls, true);
    try {
      await task();
      return true;
    } catch (error) {
      setMessage(errorElement, formatError(error, fallbackMessage));
      return false;
    } finally {
      restoreControlAvailability(controls);
    }
  };

  const result = mutationQueue.then(run, run);
  // A rejected operation must not prevent later, independently requested mutations.
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The selected file could not be read as text.'));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener('error', () => {
      reject(reader.error || new Error('The browser could not read the selected file.'));
    });
    reader.addEventListener('abort', () => {
      reject(new Error('File reading was cancelled.'));
    });
    reader.readAsText(file, 'UTF-8');
  });
}

function calculateLineAndColumn(source, position) {
  const safePosition = Math.max(0, Math.min(position, source.length));
  const beforeError = source.slice(0, safePosition);
  const lines = beforeError.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function describeJsonParseError(error, source) {
  const message = error instanceof Error ? error.message : String(error);
  if (/\bline\s+\d+.*\bcolumn\s+\d+\b/i.test(message)) {
    return message;
  }

  const positionMatch = message.match(/\bposition\s+(\d+)\b/i);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const location = calculateLineAndColumn(source, position);
    return `${message} (line ${location.line}, column ${location.column}, position ${position})`;
  }

  const lineColumnMatch = message.match(/\bline\s+(\d+)(?:\s+column\s+(\d+))?/i);
  if (lineColumnMatch) {
    const line = Number(lineColumnMatch[1]);
    const column = lineColumnMatch[2] ? Number(lineColumnMatch[2]) : null;
    return column === null ? `${message} (line ${line})` : message;
  }

  return message;
}

function parseJson(source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(describeJsonParseError(error, source));
  }
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatBytes(bytes) {
  const exact = `${bytes.toLocaleString()} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024) {
    return exact;
  }

  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${exact} (${value.toFixed(1)} ${units[unitIndex]})`;
}

function formatPath(path) {
  return path.split('.').join(' › ');
}

function createEntryOrderTree(entries) {
  const root = { children: new Map(), rank: Number.POSITIVE_INFINITY };
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    let node = root;
    for (const segment of entries[entryIndex].pathSegments) {
      if (!node.children.has(segment)) {
        node.children.set(segment, {
          children: new Map(),
          rank: entryIndex,
        });
      }
      node = node.children.get(segment);
      node.rank = Math.min(node.rank, entryIndex);
    }
  }
  return root;
}

function createCanonicalRawJson(profile) {
  const rootSource = profile.rawJson;
  const rootTarget = Array.isArray(rootSource) ? new Array(rootSource.length) : Object.create(null);
  const orderTree = createEntryOrderTree(profile.flattenedEntries);
  const stack = [{
    source: rootSource,
    target: rootTarget,
    orderNode: orderTree,
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    const keys = Object.keys(current.source);
    if (!Array.isArray(current.source)) {
      keys.sort((left, right) => {
        const leftRank = current.orderNode.children.get(left)?.rank
          ?? Number.POSITIVE_INFINITY;
        const rightRank = current.orderNode.children.get(right)?.rank
          ?? Number.POSITIVE_INFINITY;
        return leftRank - rightRank;
      });
    }

    for (const key of keys) {
      const value = current.source[key];
      if (!isContainer(value)) {
        current.target[key] = value;
        continue;
      }

      const childTarget = Array.isArray(value)
        ? new Array(value.length)
        : Object.create(null);
      current.target[key] = childTarget;
      stack.push({
        source: value,
        target: childTarget,
        orderNode: current.orderNode.children.get(key) || {
          children: new Map(),
          rank: Number.POSITIVE_INFINITY,
        },
      });
    }
  }

  return rootTarget;
}

function getContainerLabel(value) {
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  return `{${Object.keys(value).length}}`;
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function createTreeLeaf(key, value) {
  const row = document.createElement('div');
  row.className = 'tree__leaf';

  const keyElement = document.createElement('span');
  keyElement.className = 'tree__key';
  keyElement.textContent = key;

  const valueElement = document.createElement('span');
  const valueType = value === null ? 'null' : typeof value;
  valueElement.className = `tree__value tree__value--${valueType}`;
  if (value === null) {
    valueElement.textContent = 'null';
  } else if (typeof value === 'string') {
    valueElement.textContent = `"${value}"`;
  } else {
    valueElement.textContent = String(value);
  }

  row.replaceChildren(keyElement, valueElement);
  return row;
}

function createTreeBranch(key, value, isRoot) {
  const details = document.createElement('details');
  details.open = isRoot;

  const summary = document.createElement('summary');
  const keyElement = document.createElement('span');
  keyElement.textContent = key;
  const countElement = document.createElement('span');
  countElement.className = 'tree__count';
  countElement.textContent = ` ${getContainerLabel(value)}`;
  summary.replaceChildren(keyElement, countElement);
  details.replaceChildren(summary);

  return { details, summary };
}

function renderPreview(rawJson, showNullValues) {
  if (!rawJson) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Import a profile to preview its data.';
    elements['profile-preview'].replaceChildren(empty);
    return;
  }

  const rootBranch = createTreeBranch('Profile', rawJson, true);
  const stack = [{
    value: rawJson,
    branch: rootBranch.details,
    summary: rootBranch.summary,
    isRoot: true,
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    const children = [current.summary];
    const childBranches = [];
    const keys = Object.keys(current.value);

    for (const key of keys) {
      const value = current.value[key];
      if (value === null && !showNullValues) {
        continue;
      }
      if (isContainer(value)) {
        const branch = createTreeBranch(key, value, false);
        children.push(branch.details);
        childBranches.push({
          value,
          branch: branch.details,
          summary: branch.summary,
          isRoot: false,
        });
      } else {
        children.push(createTreeLeaf(key, value));
      }
    }

    current.branch.replaceChildren(...children);
    for (let index = childBranches.length - 1; index >= 0; index -= 1) {
      stack.push(childBranches[index]);
    }
  }

  elements['profile-preview'].replaceChildren(rootBranch.details);
}

function collectScopes(entries) {
  const scopes = new Set();
  for (const entry of entries) {
    if (entry.pathSegments.length >= 1) {
      scopes.add(entry.pathSegments[0]);
    }
    if (entry.pathSegments.length >= 3) {
      scopes.add(entry.pathSegments.slice(0, 2).join('.'));
    }
  }
  return [...scopes].sort((left, right) => (
    left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
  ));
}

function renderScopeOptions(profile, activeScope) {
  const options = [];
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All profile data';
  options.push(allOption);

  const scopes = profile ? collectScopes(profile.flattenedEntries) : [];
  for (const scope of scopes) {
    const option = document.createElement('option');
    option.value = scope;
    option.textContent = formatPath(scope);
    options.push(option);
  }

  if (activeScope && !scopes.includes(activeScope)) {
    const unavailableOption = document.createElement('option');
    unavailableOption.value = activeScope;
    unavailableOption.textContent = `${formatPath(activeScope)} (unavailable)`;
    options.push(unavailableOption);
  }

  elements['active-scope'].replaceChildren(...options);
  elements['active-scope'].value = activeScope;
}

function renderPreferences(preferences) {
  for (const input of elements.insertModeInputs) {
    input.checked = input.value === preferences.insertMode;
  }
  elements['preferred-language'].value = preferences.preferredLanguage;
  renderScopeOptions(currentState.profile, preferences.activeScope);
  elements['scope-only'].checked = preferences.scopeOnly;
  elements['show-null-values'].checked = preferences.showNullValues;
  elements['max-recent-entries'].value = String(preferences.maxRecentEntries);
  elements['confirm-oversized-values'].checked = preferences.confirmOversizedValues;
}

function renderProfile(profile) {
  const hasProfile = profile !== null;
  const entryCount = hasProfile ? profile.flattenedEntries.length : 0;
  elements['profile-state-badge'].textContent = hasProfile ? 'Profile ready' : 'No profile';
  elements['profile-file-name'].textContent = hasProfile ? profile.sourceFileName : '—';
  elements['profile-imported-at'].textContent = hasProfile ? formatDate(profile.importedAt) : '—';
  elements['profile-entry-count'].textContent = entryCount.toLocaleString();
  elements['export-profile'].disabled = !hasProfile;
  elements['clear-profile'].disabled = !hasProfile;
  renderPreview(
    hasProfile ? profile.rawJson : null,
    currentState.preferences.showNullValues,
  );
}

function createUnstarButton(path) {
  const button = document.createElement('button');
  button.className = 'unstar-button';
  button.type = 'button';
  button.dataset.path = path;
  button.setAttribute('aria-label', `Remove ${formatPath(path)} from favorites`);
  button.title = 'Remove favorite';
  button.textContent = '★';
  return button;
}

function renderFavorites(favorites) {
  const items = [];
  for (const path of favorites) {
    const item = document.createElement('li');
    item.className = 'favorite-item';

    const pathElement = document.createElement('span');
    pathElement.className = 'favorite-item__path';
    pathElement.textContent = formatPath(path);
    item.replaceChildren(pathElement, createUnstarButton(path));
    items.push(item);
  }

  elements['favorites-list'].replaceChildren(...items);
  elements['favorites-empty'].hidden = favorites.length > 0;
  elements['clear-favorites'].disabled = favorites.length === 0;
  elements['favorites-count'].textContent = `${favorites.length.toLocaleString()} saved`;
}

function formatRecentState(recent) {
  if (recent.length === 0) {
    return 'Empty';
  }
  const newestDate = formatDate(recent[0].lastUsedAt);
  return `${recent.length.toLocaleString()} ${recent.length === 1 ? 'entry' : 'entries'} · newest ${newestDate}`;
}

async function renderDiagnostics(state) {
  const entryCount = state.profile ? state.profile.flattenedEntries.length : 0;
  elements['diagnostic-entry-count'].textContent = entryCount.toLocaleString();
  elements['recent-state'].textContent = formatRecentState(state.recent);
  elements['clear-recent'].disabled = state.recent.length === 0;
  try {
    const bytes = await LBA.storage.getStorageEstimate();
    elements['storage-usage'].textContent = formatBytes(bytes);
    setMessage(elements['diagnostics-error'], '');
  } catch (error) {
    elements['storage-usage'].textContent = 'Unavailable';
    setMessage(
      elements['diagnostics-error'],
      formatError(error, OPTIONS_LABELS.STORAGE_ESTIMATE_FAILURE),
    );
  }
}

async function renderState(state) {
  currentState = state;
  elements['privacy-acknowledgment'].checked = hasCurrentPrivacyConsent(state);
  updateImportAvailability();
  renderPreferences(state.preferences);
  renderProfile(state.profile);
  renderFavorites(state.favorites);
  await renderDiagnostics(state);
}

async function refreshState() {
  const result = await LBA.storage.getState();
  await renderState(result.state);
  return result;
}

async function importSelectedProfile() {
  clearSectionMessages('profile');
  if (!elements['privacy-acknowledgment'].checked) {
    setMessage(elements['profile-error'], OPTIONS_LABELS.PRIVACY_ACKNOWLEDGMENT_REQUIRED);
    return;
  }
  const [file] = elements['profile-file'].files;
  if (!file) {
    setMessage(elements['profile-error'], OPTIONS_LABELS.CHOOSE_JSON);
    return;
  }
  if (!file.name.toLowerCase().endsWith('.json')) {
    setMessage(elements['profile-error'], OPTIONS_LABELS.JSON_EXTENSION);
    return;
  }

  await enqueueMutation(async () => {
    await LBA.storage.savePrivacyConsent();
    let source;
    try {
      source = await readFileAsText(file);
    } catch (error) {
      throw new Error(formatError(error, OPTIONS_LABELS.FILE_READ_FAILURE));
    }

    let rawJson;
    try {
      rawJson = parseJson(source);
    } catch (error) {
      throw new Error(formatError(error, OPTIONS_LABELS.MALFORMED_JSON));
    }

    let flattenedEntries;
    try {
      flattenedEntries = LBA.flatten.flattenJson(rawJson);
    } catch (error) {
      throw new Error(formatError(error, OPTIONS_LABELS.FLATTEN_FAILURE));
    }

    try {
      await LBA.storage.saveProfile(file.name, rawJson, flattenedEntries);
    } catch (error) {
      throw new Error(formatError(error, OPTIONS_LABELS.PROFILE_SAVE_FAILURE));
    }

    let cleanupResult;
    try {
      cleanupResult = await LBA.storage.cleanupFavorites(
        flattenedEntries.map((entry) => entry.path),
      );
    } catch (error) {
      await refreshState();
      throw new Error(formatError(error, OPTIONS_LABELS.FAVORITES_CLEANUP_FAILURE));
    }

    await refreshState();
    setMessage(
      elements['profile-status'],
      `Imported ${file.name}: ${flattenedEntries.length.toLocaleString()} entries. `
        + `Removed ${cleanupResult.removedCount.toLocaleString()} stale `
        + `${cleanupResult.removedCount === 1 ? 'favorite' : 'favorites'}.`,
    );
    elements['profile-file'].value = '';
    elements['selected-file-name'].textContent = 'No file selected';
  }, [
    elements['profile-file'],
    elements['privacy-acknowledgment'],
    elements['import-profile'],
    elements['clear-profile'],
    elements['reset-extension'],
  ], elements['profile-error'], OPTIONS_LABELS.IMPORT_FAILURE);
}

function exportProfile() {
  clearSectionMessages('profile');
  if (!currentState || !currentState.profile) {
    setMessage(elements['profile-error'], OPTIONS_LABELS.NO_PROFILE_TO_EXPORT);
    return;
  }

  try {
    const canonicalJson = `${JSON.stringify(
      createCanonicalRawJson(currentState.profile),
      null,
      2,
    )}\n`;
    const blob = new Blob([canonicalJson], { type: UTF8_JSON_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentState.profile.sourceFileName || 'local-business-profile.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(elements['profile-status'], `Exported ${link.download}.`);
  } catch (error) {
    setMessage(elements['profile-error'], formatError(error, OPTIONS_LABELS.EXPORT_FAILURE));
  }
}

async function clearStoredProfile() {
  clearSectionMessages('profile');
  if (!currentState || !currentState.profile) {
    return;
  }
  if (!globalThis.confirm('Clear the imported JSON profile? Preferences, favorites, and history will remain.')) {
    return;
  }

  await enqueueMutation(async () => {
    await LBA.storage.clearProfile();
    await refreshState();
    setMessage(elements['profile-status'], 'The imported profile has been cleared.');
  }, [
    elements['clear-profile'],
    elements['export-profile'],
    elements['import-profile'],
  ], elements['profile-error'], OPTIONS_LABELS.CLEAR_PROFILE_FAILURE);
}

async function resetExtension() {
  clearSectionMessages('profile');
  if (!globalThis.confirm('Reset TrustPaste? This permanently clears the profile, preferences, favorites, and recent history.')) {
    return;
  }

  await enqueueMutation(async () => {
    await LBA.storage.resetAll();
    await refreshState();
    setMessage(elements['profile-status'], 'TrustPaste has been reset to its initial state.');
  }, [
    elements['reset-extension'],
    elements['import-profile'],
    elements['clear-profile'],
    elements['export-profile'],
    elements['clear-favorites'],
    elements['clear-recent'],
    elements['reset-preferences'],
  ], elements['profile-error'], OPTIONS_LABELS.RESET_EXTENSION_FAILURE);
}

async function savePreference(patch, sourceControl) {
  clearSectionMessages('preferences');
  const wasSaved = await enqueueMutation(async () => {
    const preferences = await LBA.storage.savePreferences(patch);
    const stateResult = await LBA.storage.getState();
    currentState = stateResult.state;
    renderPreferences(preferences);
    renderProfile(currentState.profile);
    await renderDiagnostics(currentState);
    setMessage(elements['preferences-status'], 'Preference saved.');
  }, [sourceControl], elements['preferences-error'], OPTIONS_LABELS.SAVE_PREFERENCE_FAILURE);
  if (!wasSaved && currentState) {
    renderPreferences(currentState.preferences);
    renderProfile(currentState.profile);
  }
}

async function saveMaximumRecents() {
  const input = elements['max-recent-entries'];
  const numericValue = Number(input.value);
  if (!Number.isFinite(numericValue)) {
    setMessage(
      elements['preferences-error'],
      OPTIONS_LABELS.RECENT_LIMIT
        .replace('{min}', String(MIN_RECENT_ENTRIES))
        .replace('{max}', String(MAX_RECENT_ENTRIES)),
    );
    input.value = String(currentState.preferences.maxRecentEntries);
    return;
  }

  const constrainedValue = Math.min(
    MAX_RECENT_ENTRIES,
    Math.max(MIN_RECENT_ENTRIES, Math.round(numericValue)),
  );
  input.value = String(constrainedValue);
  await savePreference({ maxRecentEntries: constrainedValue }, input);
}

async function removeFavorite(path, button) {
  clearSectionMessages('favorites');
  await enqueueMutation(async () => {
    const { state } = await LBA.storage.getState();
    if (!state.favorites.includes(path)) {
      await renderState(state);
      return;
    }
    await LBA.storage.toggleFavorite(path);
    await refreshState();
    setMessage(elements['favorites-status'], `Removed ${formatPath(path)} from favorites.`);
  }, [button, elements['clear-favorites']], elements['favorites-error'], OPTIONS_LABELS.REMOVE_FAVORITE_FAILURE);
}

async function clearAllFavorites() {
  clearSectionMessages('favorites');
  if (!currentState || currentState.favorites.length === 0) {
    return;
  }

  await enqueueMutation(async () => {
    const { state } = await LBA.storage.getState();
    const favoritesToRemove = [...state.favorites];
    for (const path of favoritesToRemove) {
      await LBA.storage.toggleFavorite(path);
    }
    await refreshState();
    setMessage(
      elements['favorites-status'],
      `Cleared ${favoritesToRemove.length.toLocaleString()} `
        + `${favoritesToRemove.length === 1 ? 'favorite' : 'favorites'}.`,
    );
  }, [
    elements['clear-favorites'],
    ...elements['favorites-list'].querySelectorAll('button'),
  ], elements['favorites-error'], OPTIONS_LABELS.CLEAR_FAVORITES_FAILURE);
}

async function clearRecentHistory() {
  clearSectionMessages('diagnostics');
  await enqueueMutation(async () => {
    await LBA.storage.clearRecent();
    await refreshState();
    setMessage(elements['diagnostics-status'], 'Recent history has been cleared.');
  }, [elements['clear-recent']], elements['diagnostics-error'], OPTIONS_LABELS.CLEAR_RECENT_FAILURE);
}

async function resetPreferences() {
  clearSectionMessages('diagnostics');
  await enqueueMutation(async () => {
    await LBA.storage.savePreferences(DEFAULT_PREFERENCES);
    await refreshState();
    setMessage(elements['diagnostics-status'], 'All preferences have been restored to their defaults.');
  }, [
    elements['reset-preferences'],
    ...elements.insertModeInputs,
    elements['preferred-language'],
    elements['active-scope'],
    elements['scope-only'],
    elements['show-null-values'],
    elements['max-recent-entries'],
    elements['confirm-oversized-values'],
  ], elements['diagnostics-error'], OPTIONS_LABELS.RESET_PREFERENCES_FAILURE);
}

function registerEventListeners() {
  elements['profile-file'].addEventListener('change', () => {
    const [file] = elements['profile-file'].files;
    elements['selected-file-name'].textContent = file ? file.name : 'No file selected';
    setMessage(elements['profile-error'], '');
  });
  elements['privacy-acknowledgment'].addEventListener('change', updateImportAvailability);
  elements['import-profile'].addEventListener('click', importSelectedProfile);
  elements['export-profile'].addEventListener('click', exportProfile);
  elements['clear-profile'].addEventListener('click', clearStoredProfile);
  elements['reset-extension'].addEventListener('click', resetExtension);

  for (const input of elements.insertModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked) {
        savePreference({ insertMode: input.value }, input);
      }
    });
  }
  elements['preferred-language'].addEventListener('change', () => {
    savePreference(
      { preferredLanguage: elements['preferred-language'].value },
      elements['preferred-language'],
    );
  });
  elements['active-scope'].addEventListener('change', () => {
    savePreference({ activeScope: elements['active-scope'].value }, elements['active-scope']);
  });
  elements['scope-only'].addEventListener('change', () => {
    savePreference({ scopeOnly: elements['scope-only'].checked }, elements['scope-only']);
  });
  elements['show-null-values'].addEventListener('change', () => {
    savePreference(
      { showNullValues: elements['show-null-values'].checked },
      elements['show-null-values'],
    );
  });
  elements['max-recent-entries'].addEventListener('change', saveMaximumRecents);
  elements['confirm-oversized-values'].addEventListener('change', () => {
    savePreference(
      { confirmOversizedValues: elements['confirm-oversized-values'].checked },
      elements['confirm-oversized-values'],
    );
  });

  elements['favorites-list'].addEventListener('click', (event) => {
    const button = event.target.closest('button[data-path]');
    if (button && elements['favorites-list'].contains(button)) {
      removeFavorite(button.dataset.path, button);
    }
  });
  elements['clear-favorites'].addEventListener('click', clearAllFavorites);
  elements['clear-recent'].addEventListener('click', clearRecentHistory);
  elements['reset-preferences'].addEventListener('click', resetPreferences);
}

async function initialize() {
  try {
    cacheElements();
    registerEventListeners();
    elements['extension-version'].textContent = chrome.runtime.getManifest().version;
    const { state, repaired } = await LBA.storage.getState();
    await renderState(state);
    if (repaired) {
      setMessage(
        elements['repair-notice'],
        LBA.constants.ERROR_MESSAGES.MALFORMED_STORED_DATA,
      );
    }
  } catch (error) {
    const initializationError = document.getElementById('initialization-error');
    if (initializationError) {
      setMessage(
        initializationError,
        formatError(error, OPTIONS_LABELS.INITIALIZATION_FAILURE),
      );
    }
  }
}

globalThis.LBA.options = Object.freeze({});

document.addEventListener('DOMContentLoaded', initialize, { once: true });
