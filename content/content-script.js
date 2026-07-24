'use strict';

(() => {
  if (window.__lbaInjected) {
    return;
  }
  window.__lbaInjected = true;

  const { ERROR_MESSAGES, MESSAGE_TYPES, PICKER_LABELS } = LBA.constants;
  let lastSupportedField = null;

  function isFrameElement(element) {
    const tagName = String(element?.tagName || '').toLowerCase();
    return tagName === 'iframe' || tagName === 'frame';
  }

  function resolveActiveElement(rootDocument = document) {
    let activeElement;
    try {
      activeElement = rootDocument.activeElement;
    } catch {
      // Reading activeElement can be denied for an inaccessible frame document.
      return { targetEl: null, isCrossOriginFrame: true };
    }

    while (isFrameElement(activeElement)) {
      let childDocument;
      try {
        childDocument = activeElement.contentDocument
          || activeElement.contentWindow?.document;
      } catch {
        // Cross-origin and sandboxed frame documents must remain opaque.
        return { targetEl: null, isCrossOriginFrame: true };
      }
      if (!childDocument) {
        return { targetEl: null, isCrossOriginFrame: true };
      }
      try {
        activeElement = childDocument.activeElement;
      } catch {
        // Treat any nested document access failure as a frame restriction.
        return { targetEl: null, isCrossOriginFrame: true };
      }
    }

    return { targetEl: activeElement, isCrossOriginFrame: false };
  }

  function showError(message) {
    LBA.notifications.show(message, 'error');
  }

  function combineRepairNotice(message, wasRepaired) {
    return wasRepaired
      ? `${ERROR_MESSAGES.MALFORMED_STORED_DATA} ${message}`
      : message;
  }

  function isFieldCandidate(element) {
    const tagName = String(element?.tagName || '').toLowerCase();
    return (
      tagName === 'input'
      || tagName === 'textarea'
      || Boolean(element?.isContentEditable)
    );
  }

  function getErrorDetail(error) {
    return error instanceof Error && error.message
      ? error.message
      : 'unknown error';
  }


  function openOptions() {
    try {
      chrome.runtime.sendMessage(
        { type: MESSAGE_TYPES.OPEN_OPTIONS },
        () => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            showError(
              ERROR_MESSAGES.OPEN_OPTIONS_FAILURE.replace(
                '{detail}',
                lastError.message || 'unknown error',
              ),
            );
          }
        },
      );
    } catch (error) {
      showError(
        ERROR_MESSAGES.OPEN_OPTIONS_FAILURE.replace(
          '{detail}',
          getErrorDetail(error),
        ),
      );
    }
  }

  function trackFocusedField(event) {
    let targetEl = event.target;
    if (isFrameElement(targetEl)) {
      const resolved = resolveActiveElement(targetEl.ownerDocument || document);
      if (resolved.isCrossOriginFrame) {
        return;
      }
      targetEl = resolved.targetEl;
    }
    if (LBA.fieldContext.isSupportedField(targetEl)) {
      lastSupportedField = targetEl;
    }
  }

  async function handleOpenPicker(message) {
    const current = resolveActiveElement();
    if (
      !current.isCrossOriginFrame
      && LBA.fieldContext.isSupportedField(current.targetEl)
    ) {
      lastSupportedField = current.targetEl;
    }
    const currentIsField = isFieldCandidate(current.targetEl);
    const targetEl = (
      message.trigger === 'contextMenu'
      || currentIsField
    ) ? current.targetEl : lastSupportedField;

    let state;
    let repaired = false;
    try {
      ({ state, repaired } = await LBA.storage.getState());
    } catch (error) {
      showError(
        ERROR_MESSAGES.STORAGE_FAILURE.replace('{detail}', getErrorDetail(error)),
      );
      return;
    }

    if (!state.profile) {
      LBA.notifications.show(combineRepairNotice(ERROR_MESSAGES.NO_PROFILE, repaired), 'error', {
        label: PICKER_LABELS.OPEN_OPTIONS,
        onClick: openOptions,
      });
      return;
    }

    if (current.isCrossOriginFrame) {
      showError(combineRepairNotice(ERROR_MESSAGES.IFRAME_ACCESS_RESTRICTION, repaired));
      return;
    }

    if (!isFieldCandidate(targetEl)) {
      showError(combineRepairNotice(ERROR_MESSAGES.NO_EDITABLE_FIELD, repaired));
      return;
    }

    const classification = LBA.fieldContext.classifyField(targetEl);
    if (!classification.isSupported) {
      showError(combineRepairNotice(
        ERROR_MESSAGES.UNSUPPORTED_FIELD
          .replace('{type}', classification.inputType)
          .replace('{detail}', classification.reason),
        repaired,
      ));
      return;
    }

    if (repaired) {
      LBA.notifications.show(ERROR_MESSAGES.MALFORMED_STORED_DATA, 'error');
    }

    LBA.picker.open({
      targetEl,
      fieldContext: LBA.fieldContext.collectContext(targetEl),
      state,
    });
  }

  document.addEventListener('focusin', trackFocusedField, true);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPES.OPEN_PICKER) {
      return;
    }
    sendResponse({ type: MESSAGE_TYPES.OPEN_PICKER_ACK });
    void handleOpenPicker(message);
  });
})();
