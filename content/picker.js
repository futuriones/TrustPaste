'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (typeof globalThis.LBA.picker?.open === 'function') {
    return;
  }

  const CSS_PATH = 'content/picker.css';
  const PAGE_JUMP = 5;
  let cssPromise = null;
  let openInvocation = 0;
  let activePicker = null;

  function getStylesheet() {
    if (cssPromise === null) {
      const stylesheetUrl = chrome.runtime.getURL(CSS_PATH);
      cssPromise = fetch(stylesheetUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`Picker stylesheet request failed (${response.status}).`);
        }
        return response.text();
      }).catch((error) => {
        cssPromise = null;
        throw error;
      });
    }
    return cssPromise;
  }

  function isRangeInsideTarget(range, targetEl) {
    try {
      return (
        targetEl.contains(range.startContainer)
        && targetEl.contains(range.endContainer)
      );
    } catch (error) {
      // A detached or browser-owned selection range is unusable.
      return false;
    }
  }

  function captureEditableRange(targetEl) {
    if (!targetEl?.isContentEditable) {
      return null;
    }
    try {
      const selection = targetEl.ownerDocument?.defaultView?.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return null;
      }
      const range = selection.getRangeAt(0);
      return isRangeInsideTarget(range, targetEl) ? range.cloneRange() : null;
    } catch {
      // Selection capture is optional; insertion falls back to appending text.
      return null;
    }
  }

  function teardown({ restoreFocus }) {
    const picker = activePicker;
    activePicker = null;
    picker?.controller.abort();
    picker?.host.remove();
    if (restoreFocus && picker?.targetEl?.isConnected) {
      try {
        picker.targetEl.focus();
      } catch {
        // A connected page element can still refuse programmatic focus.
      }
    }
  }

  function close() {
    openInvocation += 1;
    teardown({ restoreFocus: true });
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function getFieldDetail(fieldContext) {
    const label = fieldContext.labelText || fieldContext.ariaLabel || fieldContext.id;
    const details = [
      label,
      fieldContext.name ? `name="${fieldContext.name}"` : '',
      fieldContext.inputType ? `type="${fieldContext.inputType}"` : '',
    ].filter(Boolean);
    const detail = details.length > 0 ? details.join(' · ') : 'editable field';
    const maximum = Number.isInteger(fieldContext.maxLength)
      ? ` · ${LBA.constants.PICKER_LABELS.MAX_LENGTH.replace(
        '{maxLength}',
        String(fieldContext.maxLength),
      )}`
      : '';
    return LBA.constants.PICKER_LABELS.FIELD_INFO.replace('{detail}', detail) + maximum;
  }

  function getRankingContext(picker) {
    const preferences = { ...picker.state.preferences };
    if (preferences.preferredLanguage === 'auto') {
      const pageLanguage = String(document.documentElement.lang || '')
        .slice(0, 2)
        .toLowerCase();
      preferences.preferredLanguage = Object.hasOwn(
        LBA.constants.LANGUAGE_ALIASES,
        pageLanguage,
      ) ? pageLanguage : 'none';
    }
    return {
      favorites: [...picker.state.favorites],
      recent: picker.state.recent.map((item) => ({ ...item })),
      preferences,
      fieldContext: { ...picker.fieldContext },
    };
  }

  function rankEntries(picker, entries, baseScores) {
    const scored = entries.map((entry) => ({
      entry,
      baseScore: baseScores?.get(entry.path) || 0,
    }));
    return LBA.ranking.rankEntries(scored, getRankingContext(picker));
  }

  function getVisibleEntries(picker) {
    const entries = Array.isArray(picker.state.profile?.flattenedEntries)
      ? picker.state.profile.flattenedEntries
      : [];
    return entries.filter(
      (entry) => picker.state.preferences.showNullValues || entry.valueType !== 'null',
    );
  }

  function resolvePaths(picker, paths) {
    const entryByPath = new Map(
      getVisibleEntries(picker).map((entry) => [entry.path, entry]),
    );
    return paths.map((path) => entryByPath.get(path)).filter(Boolean);
  }

  function setStatus(picker, message, isError = false) {
    picker.status.textContent = message;
    picker.status.classList.toggle('error', isError);
    picker.status.hidden = !message;
  }

  function clearConfirmation(picker) {
    picker.confirmation?.remove();
    picker.confirmation = null;
  }

  function updateSelection(picker, nextIndex) {
    const rows = picker.rows;
    if (rows.length === 0) {
      picker.selectedIndex = -1;
      picker.results.removeAttribute('aria-activedescendant');
      picker.search.removeAttribute('aria-activedescendant');
      return;
    }
    const normalizedIndex = ((nextIndex % rows.length) + rows.length) % rows.length;
    picker.selectedIndex = normalizedIndex;
    rows.forEach((row, index) => {
      row.element.setAttribute('aria-selected', String(index === normalizedIndex));
    });
    const selected = rows[normalizedIndex].element;
    picker.results.setAttribute('aria-activedescendant', selected.id);
    picker.search.setAttribute('aria-activedescendant', selected.id);
    selected.scrollIntoView({ block: 'nearest' });
  }

  function getPreview(entry, expanded) {
    const value = entry.value;
    if (expanded || value.length <= LBA.constants.PREVIEW_TRUNCATION_LENGTH) {
      return value;
    }
    return `${value.slice(0, LBA.constants.PREVIEW_TRUNCATION_LENGTH)}…`;
  }

  async function toggleFavorite(picker, entry) {
    try {
      const isFavorite = await LBA.storage.toggleFavorite(entry.path);
      if (activePicker !== picker) {
        return;
      }
      picker.state.favorites = isFavorite
        ? [...new Set([...picker.state.favorites, entry.path])]
        : picker.state.favorites.filter((path) => path !== entry.path);
      setStatus(picker, '');
      renderResults(picker);
    } catch (error) {
      if (activePicker === picker) {
        setStatus(
          picker,
          LBA.constants.ERROR_MESSAGES.STORAGE_FAILURE.replace(
            '{detail}',
            error instanceof Error ? error.message : String(error),
          ),
          true,
        );
      }
    }
  }

  async function activateEntry(picker, entry, confirmOversized = false) {
    if (typeof LBA.insertion?.insertValue !== 'function') {
      teardown({ restoreFocus: false });
      LBA.notifications.show(
        LBA.constants.ERROR_MESSAGES.INSERTION_UNAVAILABLE,
        'error',
      );
      return;
    }

    if (
      picker.savedRange
      && picker.state.preferences.insertMode === 'atCursor'
      && picker.targetEl?.isConnected
    ) {
      try {
        const selection = picker.targetEl.ownerDocument.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(picker.savedRange);
      } catch {
        // The insertion engine safely appends if the saved range became invalid.
      }
    }

    const allowOversized = (
      confirmOversized
      || !picker.state.preferences.confirmOversizedValues
    );
    const result = LBA.insertion.insertValue(picker.targetEl, entry.value, {
      mode: picker.state.preferences.insertMode,
      confirmOversized: allowOversized,
    });

    if (!result.ok) {
      if (result.reason === LBA.constants.ERROR_MESSAGES.FIELD_REMOVED) {
        teardown({ restoreFocus: false });
        LBA.notifications.show(result.reason, 'error');
        return;
      }
      if (
        result.reason === LBA.constants.ERROR_MESSAGES.VALUE_TOO_LONG
          .replace('{valueLength}', String(entry.value.length))
          .replace('{maxLength}', String(picker.targetEl.maxLength))
        && picker.state.preferences.confirmOversizedValues
      ) {
        showOversizedConfirmation(picker, entry);
      } else {
        setStatus(picker, result.reason, true);
      }
      return;
    }

    teardown({ restoreFocus: true });
    try {
      await LBA.storage.recordRecentUse(entry.path);
      LBA.notifications.show(LBA.constants.PICKER_LABELS.INSERT_SUCCESS);
    } catch (error) {
      LBA.notifications.show(
        `${LBA.constants.PICKER_LABELS.INSERT_SUCCESS_HISTORY_FAILURE} ${
          LBA.constants.ERROR_MESSAGES.STORAGE_FAILURE.replace(
            '{detail}',
            error instanceof Error ? error.message : String(error),
          )
        }`,
        'error',
      );
    }
  }

  function showOversizedConfirmation(picker, entry) {
    clearConfirmation(picker);
    const confirmation = createElement('div', 'confirmation');
    confirmation.setAttribute('role', 'alert');
    const message = createElement(
      'span',
      '',
      LBA.constants.ERROR_MESSAGES.VALUE_TOO_LONG
        .replace('{valueLength}', String(entry.value.length))
        .replace('{maxLength}', String(picker.targetEl.maxLength)),
    );
    const button = createElement(
      'button',
      'confirm-button',
      LBA.constants.PICKER_LABELS.INSERT_ANYWAY,
    );
    button.type = 'button';
    button.addEventListener('click', () => {
      void activateEntry(picker, entry, true);
    }, { signal: picker.controller.signal });
    confirmation.append(message, button);
    picker.footer.before(confirmation);
    picker.confirmation = confirmation;
    button.focus();
  }

  function createRow(picker, entry, rowIndex) {
    const row = createElement('div', 'row');
    row.id = `lba-option-${rowIndex}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.dataset.path = entry.path;

    const isFavorite = picker.state.favorites.includes(entry.path);
    const star = createElement('button', 'star', isFavorite ? '★' : '☆');
    star.type = 'button';
    star.setAttribute(
      'aria-label',
      (isFavorite
        ? LBA.constants.PICKER_LABELS.UNFAVORITE_ENTRY
        : LBA.constants.PICKER_LABELS.FAVORITE_ENTRY
      ).replace('{detail}', entry.path),
    );
    star.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleFavorite(picker, entry);
    }, { signal: picker.controller.signal });

    const main = createElement('div', 'entry-main');
    main.append(
      createElement('span', 'entry-label', entry.label),
      createElement('span', 'entry-path', entry.pathSegments.join(' › ')),
    );

    const maximum = picker.fieldContext.maxLength;
    const isOversized = Number.isInteger(maximum) && entry.characterCount > maximum;
    const count = createElement(
      'span',
      `count${isOversized ? ' oversized' : ''}`,
      LBA.constants.PICKER_LABELS.CHARACTER_COUNT.replace(
        '{valueLength}',
        String(entry.characterCount),
      ),
    );

    const preview = createElement('span', 'entry-value', getPreview(entry, false));
    row.append(star, main, count);
    if (entry.value.length > LBA.constants.PREVIEW_TRUNCATION_LENGTH) {
      const previewButton = createElement(
        'button',
        'preview-button',
        LBA.constants.PICKER_LABELS.EXPAND_PREVIEW,
      );
      previewButton.type = 'button';
      previewButton.setAttribute(
        'aria-label',
        `${LBA.constants.PICKER_LABELS.EXPAND_PREVIEW}: ${entry.path}`,
      );
      previewButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const expanded = previewButton.dataset.expanded !== 'true';
        previewButton.dataset.expanded = String(expanded);
        previewButton.textContent = expanded
          ? LBA.constants.PICKER_LABELS.COLLAPSE_PREVIEW
          : LBA.constants.PICKER_LABELS.EXPAND_PREVIEW;
        preview.textContent = getPreview(entry, expanded);
      }, { signal: picker.controller.signal });
      row.append(previewButton);
    }
    row.append(preview);
    row.addEventListener('click', () => {
      void activateEntry(picker, entry);
    }, { signal: picker.controller.signal });
    return { element: row, entry };
  }

  function appendSection(picker, title, entries, emptyMessage) {
    picker.results.append(createElement('div', 'section-title', title));
    if (entries.length === 0) {
      picker.results.append(createElement('div', 'empty', emptyMessage));
      return;
    }
    for (const entry of entries) {
      const row = createRow(picker, entry, picker.rows.length);
      picker.rows.push(row);
      picker.results.append(row.element);
    }
  }

  function renderResults(picker) {
    clearConfirmation(picker);
    picker.results.replaceChildren();
    picker.rows = [];
    picker.selectedIndex = -1;
    const query = picker.search.value;
    const visibleEntries = getVisibleEntries(picker);

    if (LBA.normalize.normalizeText(query) === '') {
      const favorites = rankEntries(
        picker,
        resolvePaths(picker, picker.state.favorites),
      ).map((item) => item.entry);
      const recentPaths = picker.state.recent.map((item) => item.path);
      const recent = rankEntries(
        picker,
        resolvePaths(picker, recentPaths),
      ).map((item) => item.entry);
      appendSection(
        picker,
        LBA.constants.PICKER_LABELS.FAVORITES,
        favorites,
        LBA.constants.PICKER_LABELS.NO_FAVORITES,
      );
      appendSection(
        picker,
        LBA.constants.PICKER_LABELS.RECENT,
        recent,
        LBA.constants.PICKER_LABELS.NO_RECENT,
      );
    } else {
      const matches = LBA.search.searchEntries(visibleEntries, query);
      const scores = new Map(matches.map((item) => [item.entry.path, item.baseScore]));
      const ranked = rankEntries(
        picker,
        matches.map((item) => item.entry),
        scores,
      );
      if (ranked.length === 0) {
        picker.results.append(createElement(
          'div',
          'empty',
          LBA.constants.ERROR_MESSAGES.NO_SEARCH_RESULTS.replace('{query}', query),
        ));
      } else {
        for (const { entry } of ranked) {
          const row = createRow(picker, entry, picker.rows.length);
          picker.rows.push(row);
          picker.results.append(row.element);
        }
      }
    }
    updateSelection(picker, 0);
  }

  function getFocusableElements(picker) {
    return Array.from(
      picker.panel.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden);
  }

  const ALLOWED_MODIFIER_CHORDS = new Set(['a', 'c', 'v', 'x', 'z']);

  function isStrayModifierChord(picker, event) {
    return (
      event.target === picker.search
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && event.key.length === 1
      && !ALLOWED_MODIFIER_CHORDS.has(event.key.toLowerCase())
    );
  }

  function handleKeydown(picker, event) {
    if (isStrayModifierChord(picker, event)) {
      // A Ctrl/Cmd+letter chord reaching the search field as a live modifier (e.g. a
      // stuck key, or a shortcut binding that leaves the modifier down) would
      // otherwise trigger a browser-level shortcut instead of typing the letter.
      // Recover what we can by inserting the character ourselves; chords the
      // browser reserves outright (e.g. Cmd+W/T) cannot be intercepted here and
      // must be fixed outside the extension (stuck key / shortcut rebind).
      event.preventDefault();
      picker.search.setRangeText(
        event.key,
        picker.search.selectionStart,
        picker.search.selectionEnd,
        'end',
      );
      picker.search.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusableElements(picker);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const currentIndex = focusable.indexOf(picker.shadowRoot.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus();
      return;
    }
    if (event.key === 'Enter') {
      if (event.target instanceof HTMLButtonElement) {
        return;
      }
      const selected = picker.rows[picker.selectedIndex];
      if (selected) {
        event.preventDefault();
        void activateEntry(picker, selected.entry);
      }
      return;
    }

    const moveBy = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: PAGE_JUMP,
      PageUp: -PAGE_JUMP,
    }[event.key];
    if (moveBy !== undefined && picker.rows.length > 0) {
      event.preventDefault();
      updateSelection(picker, picker.selectedIndex + moveBy);
    }
  }

  async function saveInsertMode(picker, mode, changedControl) {
    const previousMode = picker.state.preferences.insertMode;
    picker.state.preferences.insertMode = mode;
    try {
      await LBA.storage.savePreferences({ insertMode: mode });
      if (activePicker === picker) {
        setStatus(picker, '');
      }
    } catch (error) {
      if (activePicker !== picker) {
        return;
      }
      picker.state.preferences.insertMode = previousMode;
      changedControl.checked = false;
      const previousControl = picker.shadowRoot.querySelector(
        `input[name="lba-insert-mode"][value="${previousMode}"]`,
      );
      if (previousControl) {
        previousControl.checked = true;
      }
      setStatus(
        picker,
        LBA.constants.ERROR_MESSAGES.STORAGE_FAILURE.replace(
          '{detail}',
          error instanceof Error ? error.message : String(error),
        ),
        true,
      );
    }
  }

  function createModeControl(picker, group, mode, labelText) {
    const id = `lba-mode-${mode}`;
    const input = createElement('input');
    input.id = id;
    input.type = 'radio';
    input.name = 'lba-insert-mode';
    input.value = mode;
    input.checked = picker.state.preferences.insertMode === mode;
    const label = createElement('label', 'mode-label', labelText);
    label.htmlFor = id;
    input.addEventListener('change', () => {
      if (input.checked) {
        void saveInsertMode(picker, mode, input);
      }
    }, { signal: picker.controller.signal });
    group.append(input, label);
  }

  function buildPicker(stylesheet, options) {
    const host = createElement('div');
    host.setAttribute('data-lba-picker-host', '');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const controller = new AbortController();
    const picker = {
      host,
      shadowRoot,
      controller,
      targetEl: options.targetEl,
      fieldContext: { ...(options.fieldContext || {}) },
      state: {
        ...options.state,
        preferences: { ...options.state.preferences },
        favorites: [...(options.state.favorites || [])],
        recent: (options.state.recent || []).map((item) => ({ ...item })),
      },
      savedRange: options.savedRange,
      rows: [],
      selectedIndex: -1,
      confirmation: null,
    };

    const style = createElement('style', '', stylesheet);
    const backdrop = createElement('div', 'backdrop');
    const panel = createElement('section', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'TrustPaste');
    picker.panel = panel;

    const header = createElement('div', 'header');
    const searchLabel = createElement(
      'label',
      'visually-hidden',
      LBA.constants.PICKER_LABELS.SEARCH_ARIA_LABEL,
    );
    searchLabel.htmlFor = 'lba-picker-search';
    const search = createElement('input', 'search');
    search.id = 'lba-picker-search';
    search.type = 'search';
    search.placeholder = LBA.constants.PICKER_LABELS.SEARCH_PLACEHOLDER;
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-label', LBA.constants.PICKER_LABELS.SEARCH_ARIA_LABEL);
    search.setAttribute('aria-controls', 'lba-picker-results');
    picker.search = search;

    const toolbar = createElement('div', 'toolbar');
    const fieldInfo = createElement(
      'span',
      'field-info',
      getFieldDetail(picker.fieldContext),
    );
    const modeGroup = createElement('div', 'mode-group');
    modeGroup.setAttribute('role', 'radiogroup');
    modeGroup.setAttribute('aria-label', 'Insertion mode');
    createModeControl(
      picker,
      modeGroup,
      'replace',
      LBA.constants.PICKER_LABELS.REPLACE,
    );
    createModeControl(
      picker,
      modeGroup,
      'atCursor',
      LBA.constants.PICKER_LABELS.AT_CURSOR,
    );
    toolbar.append(fieldInfo, modeGroup);
    header.append(searchLabel, search, toolbar);

    const status = createElement('div', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    picker.status = status;

    const results = createElement('div', 'results');
    results.id = 'lba-picker-results';
    results.setAttribute('role', 'listbox');
    results.setAttribute('aria-label', 'Business data values');
    picker.results = results;

    const footer = createElement(
      'footer',
      'footer',
      LBA.constants.PICKER_LABELS.KEYBOARD_HINTS,
    );
    picker.footer = footer;
    panel.append(header, status, results, footer);
    backdrop.append(panel);
    shadowRoot.append(style, backdrop);

    search.addEventListener('input', () => renderResults(picker), {
      signal: controller.signal,
    });
    panel.addEventListener('keydown', (event) => handleKeydown(picker, event), {
      signal: controller.signal,
    });
    document.addEventListener('pointerdown', (event) => {
      if (activePicker !== picker) {
        return;
      }
      const path = event.composedPath();
      if (!path.includes(host)) {
        openInvocation += 1;
        teardown({ restoreFocus: false });
      }
    }, { capture: true, signal: controller.signal });

    // Keystrokes fired inside the shadow root are retargeted to `host` once they
    // reach the page, so host-page (or other extension) hotkey listeners that key
    // off `event.target` never see an <input>/<textarea> and treat the keystroke as
    // a shortcut. Once our own internal handlers (handleKeydown, native typing,
    // etc.) have finished with the event, stop it from continuing on into the page.
    //
    // This listener is deliberately on `host`, in the bubble phase: a keydown fired
    // at the search input bubbles through the shadow tree (where handleKeydown and
    // native text insertion run normally) before it ever reaches `host`, so nothing
    // inside the picker is affected. Only once it is about to cross the shadow
    // boundary into the page's `document`/`window` do we stop it here.
    //
    // This does NOT stop a page (or another extension) that listens in the
    // *capture* phase on an ancestor above `host` (e.g. `document` or `window`
    // with `{ capture: true }`) — such a listener runs before the event reaches
    // `host` at all, on the way down, so it still sees the retargeted event. That
    // is a real but narrower gap: most hotkey handlers attach in the bubble phase.
    for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput']) {
      host.addEventListener(type, (event) => {
        if (activePicker === picker) {
          event.stopPropagation();
        }
      }, { signal: controller.signal });
    }

    return picker;
  }

  async function open(options = {}) {
    const invocation = ++openInvocation;
    teardown({ restoreFocus: false });
    const targetEl = options.targetEl;
    const savedRange = captureEditableRange(targetEl);
    let stylesheet;
    try {
      stylesheet = await getStylesheet();
    } catch (error) {
      if (invocation === openInvocation) {
        LBA.notifications?.show(
          LBA.constants.ERROR_MESSAGES.CANNOT_INJECT.replace(
            '{detail}',
            error instanceof Error ? error.message : String(error),
          ),
          'error',
        );
      }
      return;
    }
    if (invocation !== openInvocation) {
      return;
    }

    const picker = buildPicker(stylesheet, {
      targetEl,
      fieldContext: options.fieldContext || {},
      state: options.state || {},
      savedRange,
    });
    activePicker = picker;
    document.documentElement.append(picker.host);
    renderResults(picker);
    picker.search.focus();
  }

  globalThis.LBA.picker = Object.freeze({ open, close });
})();
