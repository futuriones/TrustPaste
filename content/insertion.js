'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (typeof globalThis.LBA.insertion?.insertValue === 'function') {
    return;
  }

  function failure(reason) {
    return { ok: false, reason };
  }

  function getInputKind(targetEl) {
    const tagName = String(targetEl?.tagName || '').toLowerCase();
    if (tagName === 'input') {
      return 'input';
    }
    if (tagName === 'textarea') {
      return 'textarea';
    }
    if (targetEl?.isContentEditable) {
      return 'contenteditable';
    }
    return null;
  }

  function getMaximumLength(targetEl) {
    if (!('maxLength' in targetEl)) {
      return null;
    }
    try {
      return Number.isInteger(targetEl.maxLength) && targetEl.maxLength >= 0
        ? targetEl.maxLength
        : null;
    } catch {
      // Browser-managed controls may not expose a readable maxlength.
      return null;
    }
  }

  function dispatchInputEvent(targetEl, insertedValue) {
    const view = targetEl.ownerDocument?.defaultView || globalThis;
    let event;
    try {
      event = new view.InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: insertedValue,
      });
    } catch {
      // Older engines use a generic input event with the same bubbling semantics.
      event = new view.Event('input', { bubbles: true, composed: true });
    }
    targetEl.dispatchEvent(event);
  }

  function dispatchChangeEvent(targetEl) {
    const view = targetEl.ownerDocument?.defaultView || globalThis;
    targetEl.dispatchEvent(new view.Event('change', {
      bubbles: true,
      composed: true,
    }));
  }

  function setNativeValue(targetEl, value, kind) {
    const view = targetEl.ownerDocument?.defaultView || globalThis;
    const prototype = kind === 'textarea'
      ? view.HTMLTextAreaElement?.prototype
      : view.HTMLInputElement?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'value')
      : null;
    if (!descriptor?.set) {
      throw new Error('Native value setter is unavailable.');
    }
    descriptor.set.call(targetEl, value);
  }

  function getSplicedValue(targetEl, insertedValue) {
    const currentValue = String(targetEl.value ?? '');
    try {
      const start = targetEl.selectionStart;
      const end = targetEl.selectionEnd;
      if (
        Number.isInteger(start)
        && Number.isInteger(end)
        && start >= 0
        && end >= start
      ) {
        return {
          value: currentValue.slice(0, start) + insertedValue + currentValue.slice(end),
          cursor: start + insertedValue.length,
        };
      }
    } catch {
      // Inputs without text selection semantics use the append fallback.
    }
    return {
      value: currentValue + insertedValue,
      cursor: currentValue.length + insertedValue.length,
    };
  }

  function placeCursor(targetEl, cursor) {
    try {
      targetEl.setSelectionRange(cursor, cursor);
    } catch {
      // Number and similar browser-managed controls can reject selection APIs.
    }
  }

  function insertIntoControl(targetEl, insertedValue, kind, mode) {
    targetEl.focus();
    const update = mode === 'atCursor'
      ? getSplicedValue(targetEl, insertedValue)
      : { value: insertedValue, cursor: insertedValue.length };
    setNativeValue(targetEl, update.value, kind);
    dispatchInputEvent(targetEl, insertedValue);
    dispatchChangeEvent(targetEl);
    placeCursor(targetEl, update.cursor);
  }

  function isRangeInsideTarget(range, targetEl) {
    try {
      return (
        targetEl.contains(range.startContainer)
        && targetEl.contains(range.endContainer)
      );
    } catch {
      // A stale or browser-owned range cannot be used for insertion.
      return false;
    }
  }

  function getUsableRange(targetEl) {
    try {
      const selection = targetEl.ownerDocument.defaultView.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return null;
      }
      const range = selection.getRangeAt(0);
      return isRangeInsideTarget(range, targetEl) ? range : null;
    } catch {
      // Missing or inaccessible selections use the append fallback.
      return null;
    }
  }

  function collapseAfterInsertedNode(targetEl, textNode) {
    try {
      const selection = targetEl.ownerDocument.defaultView.getSelection();
      const range = targetEl.ownerDocument.createRange();
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Selection placement is best effort after successful plain-text insertion.
    }
  }

  function replaceEditableContent(targetEl, insertedValue) {
    const textNode = targetEl.ownerDocument.createTextNode(insertedValue);
    targetEl.replaceChildren(textNode);
    collapseAfterInsertedNode(targetEl, textNode);
  }

  function appendEditableContent(targetEl, insertedValue) {
    const textNode = targetEl.ownerDocument.createTextNode(insertedValue);
    targetEl.append(textNode);
    collapseAfterInsertedNode(targetEl, textNode);
  }

  function insertIntoEditable(targetEl, insertedValue, mode) {
    const range = mode === 'atCursor' ? getUsableRange(targetEl) : null;
    targetEl.focus();
    if (mode !== 'atCursor') {
      replaceEditableContent(targetEl, insertedValue);
    } else if (range && isRangeInsideTarget(range, targetEl)) {
      const textNode = targetEl.ownerDocument.createTextNode(insertedValue);
      range.deleteContents();
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      const selection = targetEl.ownerDocument.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      appendEditableContent(targetEl, insertedValue);
    }
    dispatchInputEvent(targetEl, insertedValue);
  }

  /**
   * Insert a plain-text value into a supported editable target.
   *
   * Expected page-state failures are returned instead of thrown.
   *
   * @param {Element} targetEl
   * @param {*} value
   * @param {{mode?: string, confirmOversized?: boolean}} [options]
   * @returns {{ok: boolean, reason: string|null}}
   */
  function insertValue(targetEl, value, options = {}) {
    const messages = globalThis.LBA.constants.ERROR_MESSAGES;
    if (!targetEl?.isConnected) {
      return failure(messages.FIELD_REMOVED);
    }

    const kind = getInputKind(targetEl);
    const classification = globalThis.LBA.fieldContext?.classifyField?.(targetEl);
    if (!kind || (classification && !classification.isSupported)) {
      const type = classification?.inputType || kind || 'unknown';
      const detail = classification?.reason || 'This field cannot be edited.';
      return failure(
        messages.UNSUPPORTED_FIELD
          .replace('{type}', type)
          .replace('{detail}', detail),
      );
    }

    const insertedValue = String(value ?? '');
    const maximumLength = getMaximumLength(targetEl);
    if (
      maximumLength !== null
      && insertedValue.length > maximumLength
      && options.confirmOversized !== true
    ) {
      return failure(
        messages.VALUE_TOO_LONG
          .replace('{valueLength}', String(insertedValue.length))
          .replace('{maxLength}', String(maximumLength)),
      );
    }

    const mode = options.mode === 'atCursor' ? 'atCursor' : 'replace';
    try {
      if (kind === 'contenteditable') {
        insertIntoEditable(targetEl, insertedValue, mode);
      } else {
        insertIntoControl(targetEl, insertedValue, kind, mode);
      }
      return { ok: true, reason: null };
    } catch (error) {
      return failure(
        error instanceof Error && error.message
          ? error.message
          : messages.INSERTION_FAILURE,
      );
    }
  }

  globalThis.LBA.insertion = Object.freeze({ insertValue });
})();
