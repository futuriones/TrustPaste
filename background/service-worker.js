'use strict';

const CONTEXT_MENU_ID = 'lba-insert';
const OPEN_PICKER_COMMAND = 'open-picker';
const OPEN_PICKER_MESSAGE = 'LBA_OPEN_PICKER';
const OPEN_PICKER_ACK_MESSAGE = 'LBA_OPEN_PICKER_ACK';
const OPEN_OPTIONS_MESSAGE = 'LBA_OPEN_OPTIONS';
const NORMAL_ACTION_TITLE = 'TrustPaste';
const ERROR_BADGE_TEXT = '!';
const PDF_VIEWER_EXTENSION_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';
const INJECTED_FILES = Object.freeze([
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

const ACTION_TITLES = Object.freeze({
  INTERNAL:
    'TrustPaste cannot run on browser internal pages.',
  EXTENSION_STORE:
    'TrustPaste cannot run on browser extension store pages.',
  PDF:
    'TrustPaste cannot run in the built-in PDF viewer or on PDF documents.',
  INJECTION_UNAVAILABLE:
    'TrustPaste is unavailable for injection on this page.',
  CONTENT_UNREACHABLE:
    'TrustPaste could not reach this page after injection.',
});

function logDiagnostic(message) {
  console.error(`[TrustPaste] ${message}`);
}

function callChromeWithCallback(invoke) {
  return new Promise((resolve, reject) => {
    try {
      invoke((result) => {
        const lastError = chrome.runtime.lastError;

        if (lastError) {
          reject(new Error('Chrome API call failed.'));
          return;
        }

        resolve(result);
      });
    } catch {
      reject(new Error('Chrome API call failed.'));
    }
  });
}

async function setActionState(tabId, badgeText, title) {
  const results = await Promise.allSettled([
    callChromeWithCallback((callback) => {
      chrome.action.setBadgeText({ tabId, text: badgeText }, callback);
    }),
    callChromeWithCallback((callback) => {
      chrome.action.setTitle({ tabId, title }, callback);
    }),
  ]);

  if (results.some((result) => result.status === 'rejected')) {
    logDiagnostic('Unable to update the action status.');
  }
}

async function showTabError(tabId, title) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    logDiagnostic('No valid tab is available.');
    return;
  }

  await setActionState(tabId, ERROR_BADGE_TEXT, title);
}

async function clearTabError(tabId) {
  await setActionState(tabId, '', NORMAL_ACTION_TITLE);
}

function isChromeWebStoreUrl(url) {
  if (url.hostname === 'chromewebstore.google.com') {
    return true;
  }

  return (
    url.hostname === 'chrome.google.com'
    && (url.pathname === '/webstore' || url.pathname.startsWith('/webstore/'))
  );
}

function isEdgeAddOnsUrl(url) {
  const isEdgeStoreHost = (
    url.hostname === 'microsoftedge.microsoft.com'
    || url.hostname === 'edge.microsoft.com'
  );

  return (
    isEdgeStoreHost
    && (url.pathname === '/addons' || url.pathname.startsWith('/addons/'))
  );
}

function isPdfUrl(url) {
  const isBuiltInViewer = (
    (url.protocol === 'chrome-extension:' || url.protocol === 'edge-extension:')
    && url.hostname === PDF_VIEWER_EXTENSION_ID
  );
  const isPdfInternalsPage = (
    url.protocol === 'chrome:' && url.hostname === 'pdf-internals'
  );
  const isDirectPdf = /\.pdf\/?$/i.test(url.pathname);

  return isBuiltInViewer || isPdfInternalsPage || isDirectPdf;
}

function getRestrictedPageTitle(tab) {
  if (
    !tab
    || !Number.isInteger(tab.id)
    || tab.id < 0
    || typeof tab.url !== 'string'
    || tab.url.length === 0
  ) {
    return ACTION_TITLES.INJECTION_UNAVAILABLE;
  }

  let url;

  try {
    url = new URL(tab.url);
  } catch {
    return ACTION_TITLES.INJECTION_UNAVAILABLE;
  }

  if (isPdfUrl(url)) {
    return ACTION_TITLES.PDF;
  }

  if (isChromeWebStoreUrl(url) || isEdgeAddOnsUrl(url)) {
    return ACTION_TITLES.EXTENSION_STORE;
  }

  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    return ACTION_TITLES.INTERNAL;
  }

  return null;
}

async function injectContentScripts(tabId) {
  const probeResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__lbaInjected === true,
  });

  if (probeResults?.[0]?.result === true) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: INJECTED_FILES,
  });
}

function sendOpenPickerMessage(tabId, trigger) {
  return callChromeWithCallback((callback) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: OPEN_PICKER_MESSAGE, trigger },
      callback,
    );
  }).then((response) => {
    if (!response || response.type !== OPEN_PICKER_ACK_MESSAGE) {
      throw new Error('Content script acknowledgement was invalid.');
    }
  });
}

async function openPickerInTab(tab, trigger) {
  const tabId = tab && tab.id;
  const restrictedPageTitle = getRestrictedPageTitle(tab);

  if (restrictedPageTitle) {
    await showTabError(tabId, restrictedPageTitle);
    logDiagnostic('Picker opening was blocked on a restricted page.');
    return;
  }

  try {
    await injectContentScripts(tabId);
  } catch {
    await showTabError(tabId, ACTION_TITLES.INJECTION_UNAVAILABLE);
    logDiagnostic('Content script injection failed.');
    return;
  }

  try {
    await sendOpenPickerMessage(tabId, trigger);
  } catch {
    await showTabError(tabId, ACTION_TITLES.CONTENT_UNREACHABLE);
    logDiagnostic('The injected content script was unreachable.');
    return;
  }

  await clearTabError(tabId);
}

async function createContextMenu() {
  try {
    await callChromeWithCallback((callback) => {
      chrome.contextMenus.removeAll(callback);
    });
    await callChromeWithCallback((callback) => {
      chrome.contextMenus.create(
        {
          id: CONTEXT_MENU_ID,
          title: 'Insert business data',
          contexts: ['editable'],
        },
        callback,
      );
    });
  } catch {
    logDiagnostic('Unable to create the context menu.');
  }
}

function getActiveTab() {
  return callChromeWithCallback((callback) => {
    chrome.tabs.query(
      { active: true, lastFocusedWindow: true },
      (tabs) => callback(Array.isArray(tabs) ? tabs[0] : undefined),
    );
  });
}

function openOptionsPage() {
  return callChromeWithCallback((callback) => {
    chrome.runtime.openOptionsPage(callback);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void createContextMenu();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== OPEN_PICKER_COMMAND) {
    return;
  }

  void getActiveTab()
    .then((tab) => openPickerInTab(tab, 'command'))
    .catch(() => {
      logDiagnostic('Unable to identify the active tab.');
    });
});

chrome.action.onClicked.addListener((tab) => {
  void openPickerInTab(tab, 'action');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  void openPickerInTab(tab, 'contextMenu');
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== OPEN_OPTIONS_MESSAGE) {
    return;
  }

  void openOptionsPage().catch(() => {
    logDiagnostic('Unable to open the options page.');
  });
});
