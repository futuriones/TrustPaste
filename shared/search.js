'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (globalThis.LBA.search) {
    return;
  }

  function getWordScore(entry, word) {
    const normalizeText = globalThis.LBA.normalize.normalizeText;
    const parentPath = normalizeText(entry.pathSegments.slice(0, -1).join(' '));
    const label = normalizeText(entry.label);
    const value = normalizeText(entry.value);

    if (parentPath.includes(word)) {
      return 3;
    }
    if (label.includes(word)) {
      return 2;
    }
    if (value.includes(word)) {
      return 1;
    }
    return 0;
  }

  /**
   * Find entries containing every normalized query word.
   *
   * @param {Array<object>} entries
   * @param {*} query
   * @param {object} [options] Reserved for future phases.
   * @returns {Array<{entry: object, baseScore: number}>}
   */
  function searchEntries(entries, query, options = {}) {
    void options;
    const normalizedQuery = globalThis.LBA.normalize.normalizeText(query);
    if (normalizedQuery === '') {
      return [];
    }

    const words = normalizedQuery.split(' ');
    const matches = [];

    for (const entry of entries) {
      if (!words.every((word) => entry.searchableText.includes(word))) {
        continue;
      }

      matches.push({
        entry,
        baseScore: words.reduce(
          (score, word) => score + getWordScore(entry, word),
          0,
        ),
      });
    }

    return matches;
  }

  globalThis.LBA.search = Object.freeze({
    searchEntries,
  });
})();
