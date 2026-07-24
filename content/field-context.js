'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (typeof globalThis.LBA.fieldContext?.isSupportedField === 'function') {
    return;
  }

  const MAX_NEARBY_TEXT_LENGTH = 200;
  const DATE_TIME_INPUT_TYPES = new Set([
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
  ]);
  const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);
  const COUNTER_PATTERN = /\d+\s*\/\s*(\d+)/;

  function normalizeText(value) {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : '';
  }

  function getTagName(element) {
    return normalizeText(element?.tagName).toLowerCase();
  }

  function getAttribute(element, name) {
    try {
      return normalizeText(element?.getAttribute?.(name));
    } catch {
      return '';
    }
  }

  function getInputType(element) {
    const tagName = getTagName(element);
    if (tagName === 'textarea') {
      return 'textarea';
    }
    if (tagName !== 'input') {
      return element?.isContentEditable ? 'contenteditable' : tagName || 'unknown';
    }

    return normalizeText(element.type).toLowerCase() || 'text';
  }

  function hasPaymentAutocomplete(element) {
    return getAttribute(element, 'autocomplete')
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.startsWith('cc-'));
  }

  function classifyField(element) {
    const messages = globalThis.LBA.constants.UNSUPPORTED_FIELD_MESSAGES;
    const tagName = getTagName(element);
    const inputType = getInputType(element);

    if (tagName === 'input') {
      const isPayment = hasPaymentAutocomplete(element);
      if (inputType === 'password' && isPayment) {
        return {
          isSupported: false,
          inputType,
          reason: messages.PASSWORD_OR_PAYMENT,
        };
      }
      if (inputType === 'password') {
        return { isSupported: false, inputType, reason: messages.PASSWORD };
      }
      if (isPayment) {
        return { isSupported: false, inputType, reason: messages.PAYMENT };
      }

      const reasonByType = {
        hidden: messages.HIDDEN,
        file: messages.FILE,
        checkbox: messages.CHECKBOX,
        radio: messages.RADIO,
        color: messages.COLOR,
        range: messages.RANGE,
      };
      if (reasonByType[inputType]) {
        return { isSupported: false, inputType, reason: reasonByType[inputType] };
      }
      if (DATE_TIME_INPUT_TYPES.has(inputType)) {
        return { isSupported: false, inputType, reason: messages.DATE_TIME };
      }
      if (BUTTON_INPUT_TYPES.has(inputType)) {
        return { isSupported: false, inputType, reason: messages.BUTTON };
      }
    }

    if (element?.readOnly) {
      return { isSupported: false, inputType, reason: messages.READONLY };
    }
    if (element?.disabled) {
      return { isSupported: false, inputType, reason: messages.DISABLED };
    }

    const isSupportedInput = (
      tagName === 'input'
      && globalThis.LBA.constants.SUPPORTED_INPUT_TYPES.includes(inputType)
    );
    const isSupported = (
      isSupportedInput
      || tagName === 'textarea'
      || Boolean(element?.isContentEditable)
    );

    return {
      isSupported,
      inputType,
      reason: isSupported
        ? null
        : messages.UNKNOWN.replace('{type}', inputType),
    };
  }

  function isSupportedField(element) {
    return classifyField(element).isSupported;
  }

  function getTextFromLabels(element) {
    try {
      const labels = Array.from(element.labels || []);
      const labelText = normalizeText(
        labels.map((label) => label.textContent || '').join(' '),
      );
      return labelText;
    } catch {
      return '';
    }
  }

  function getTextFromAriaLabelledBy(element) {
    const labelledBy = getAttribute(element, 'aria-labelledby');
    if (!labelledBy) {
      return '';
    }

    try {
      return normalizeText(
        labelledBy
          .split(/\s+/)
          .map((id) => element.ownerDocument?.getElementById(id)?.textContent || '')
          .join(' '),
      );
    } catch {
      return '';
    }
  }

  function getTextFromWrappingLabel(element) {
    try {
      return normalizeText(element.closest?.('label')?.textContent || '');
    } catch {
      return '';
    }
  }

  function getTextFromPrecedingSibling(element) {
    try {
      let sibling = element.previousSibling;
      while (sibling) {
        const text = normalizeText(sibling.textContent || '');
        if (text) {
          return text;
        }
        sibling = sibling.previousSibling;
      }
    } catch {
      return '';
    }
    return '';
  }

  function getLabelText(element) {
    return (
      getTextFromLabels(element)
      || getTextFromAriaLabelledBy(element)
      || getTextFromWrappingLabel(element)
      || getTextFromPrecedingSibling(element)
    );
  }

  function getNearbyText(element) {
    try {
      const container = element.closest?.(
        'label, fieldset, [role="group"], form, div, p, section, article, li, td, th',
      ) || element.parentElement;
      return normalizeText(container?.textContent || '')
        .slice(0, MAX_NEARBY_TEXT_LENGTH);
    } catch {
      return '';
    }
  }

  function getAttributeMaxLength(element) {
    const rawMaxLength = getAttribute(element, 'maxlength');
    if (!rawMaxLength) {
      return null;
    }

    const maxLength = Number(rawMaxLength);
    return Number.isInteger(maxLength) && maxLength >= 0 ? maxLength : null;
  }

  function inferCounterMaxLength(element) {
    try {
      const candidates = [
        element.previousSibling,
        element.nextSibling,
        element.parentElement,
      ];
      for (const candidate of candidates) {
        const match = normalizeText(candidate?.textContent || '').match(COUNTER_PATTERN);
        if (!match) {
          continue;
        }
        const maximum = Number(match[1]);
        if (Number.isSafeInteger(maximum) && maximum >= 0) {
          return maximum;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  function collectContext(element) {
    const classification = classifyField(element);
    const attributeMaxLength = getAttributeMaxLength(element);

    return {
      labelText: getLabelText(element),
      name: getAttribute(element, 'name'),
      id: normalizeText(element?.id),
      placeholder: getAttribute(element, 'placeholder'),
      ariaLabel: getAttribute(element, 'aria-label'),
      autocomplete: getAttribute(element, 'autocomplete'),
      inputType: classification.inputType,
      nearbyText: getNearbyText(element),
      maxLength: attributeMaxLength ?? inferCounterMaxLength(element),
    };
  }

  globalThis.LBA.fieldContext = Object.freeze({
    classifyField,
    isSupportedField,
    collectContext,
  });
})();
