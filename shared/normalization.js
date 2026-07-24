'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (globalThis.LBA.normalize) {
    return;
  }

  /**
   * Normalize user-entered and profile text for matching.
   *
   * @param {*} value
   * @returns {string}
   */
  function normalizeText(value) {
    return String(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[_./\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  globalThis.LBA.normalize = Object.freeze({
    normalizeText,
  });
})();
