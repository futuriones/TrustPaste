'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (globalThis.LBA.ranking) {
    return;
  }

  function comparePaths(leftPath, rightPath) {
    if (leftPath < rightPath) {
      return -1;
    }
    if (leftPath > rightPath) {
      return 1;
    }
    return 0;
  }

  function normalize(value) {
    return globalThis.LBA.normalize.normalizeText(value);
  }

  function normalizePathSegments(entry) {
    const segments = Array.isArray(entry.pathSegments)
      ? entry.pathSegments
      : String(entry.path || '').split('.');
    return segments.map(normalize).filter(Boolean);
  }

  function normalizeScope(scope) {
    return String(scope || '')
      .split('.')
      .map(normalize)
      .filter(Boolean);
  }

  function isInScope(entry, activeScope) {
    if (activeScope.length === 0) {
      return false;
    }
    const pathSegments = normalizePathSegments(entry);
    return activeScope.every(
      (scopeSegment, index) => pathSegments[index] === scopeSegment,
    );
  }

  function createLanguageAliasSets() {
    return Object.fromEntries(
      Object.entries(globalThis.LBA.constants.LANGUAGE_ALIASES)
        .map(([language, aliases]) => [
          language,
          new Set([language, ...aliases].map(normalize)),
        ]),
    );
  }

  function getLanguageScore(entry, preferredLanguage) {
    if (!preferredLanguage || preferredLanguage === 'none' || preferredLanguage === 'auto') {
      return 0;
    }
    const aliasesByLanguage = createLanguageAliasSets();
    if (!Object.hasOwn(aliasesByLanguage, preferredLanguage)) {
      return 0;
    }
    const segments = new Set(normalizePathSegments(entry));
    let score = 0;
    for (const [language, aliases] of Object.entries(aliasesByLanguage)) {
      const isRepresented = [...aliases].some((alias) => segments.has(alias));
      if (isRepresented) {
        score += language === preferredLanguage ? 3 : -2;
      }
    }
    return score;
  }

  function getFieldText(fieldContext) {
    if (!fieldContext || typeof fieldContext !== 'object') {
      return '';
    }
    return normalize([
      fieldContext.labelText,
      fieldContext.name,
      fieldContext.id,
      fieldContext.placeholder,
      fieldContext.ariaLabel,
      fieldContext.autocomplete,
      fieldContext.nearbyText,
    ].filter((value) => typeof value === 'string').join(' '));
  }

  function getSynonymScore(entry, fieldContext) {
    const fieldText = getFieldText(fieldContext);
    if (!fieldText) {
      return 0;
    }
    const entryText = normalize([
      ...(Array.isArray(entry.pathSegments) ? entry.pathSegments : [entry.path]),
      entry.label,
    ].join(' '));
    let score = 0;

    for (const [groupKey, configuredAliases] of Object.entries(globalThis.LBA.synonyms)) {
      if (!Array.isArray(configuredAliases)) {
        continue;
      }
      const aliases = [...new Set([groupKey, ...configuredAliases].map(normalize))]
        .filter(Boolean);
      if (
        aliases.some((alias) => fieldText.includes(alias))
        && aliases.some((alias) => entryText.includes(alias))
      ) {
        score += 3;
      }
    }
    return score;
  }

  function isTelephoneValue(value) {
    const text = String(value || '');
    const digits = text.match(/\d/g) || [];
    return digits.length >= 7 && /^[+\d().\-/\s]+$/.test(text);
  }

  function getInputTypeScore(entry, fieldContext) {
    const inputType = normalize(fieldContext?.inputType);
    const value = String(entry.value || '');
    switch (inputType) {
      case 'url':
        return /^https?:\/\//i.test(value) ? 2 : 0;
      case 'email':
        return value.includes('@') ? 2 : 0;
      case 'tel':
      case 'telephone':
        return isTelephoneValue(value) ? 2 : 0;
      case 'number':
        return entry.valueType === 'number' ? 2 : 0;
      default:
        return 0;
    }
  }

  function getMaximumLengthScore(entry, fieldContext) {
    const maximumLength = fieldContext?.maxLength;
    if (!Number.isInteger(maximumLength) || maximumLength < 0) {
      return 0;
    }
    const characterCount = Number.isInteger(entry.characterCount)
      ? entry.characterCount
      : String(entry.value || '').length;
    return characterCount <= maximumLength ? 2 : -3;
  }

  /**
   * Add contextual bonuses and deterministically order search matches.
   *
   * The function is pure: input arrays, entries, and context are never mutated.
   *
   * @param {Array<{entry: object, baseScore: number}>} scored
   * @param {object} [context]
   * @returns {Array<{entry: object, baseScore: number, score: number}>}
   */
  function rankEntries(scored, context = {}) {
    const favoritePaths = new Set(Array.isArray(context.favorites) ? context.favorites : []);
    const recentUseCounts = new Map();
    const preferences = context.preferences && typeof context.preferences === 'object'
      ? context.preferences
      : {};
    const activeScope = normalizeScope(preferences.activeScope);

    if (Array.isArray(context.recent)) {
      for (const item of context.recent) {
        if (
          item
          && typeof item.path === 'string'
          && Number.isFinite(item.useCount)
          && !recentUseCounts.has(item.path)
        ) {
          recentUseCounts.set(item.path, Math.max(0, item.useCount));
        }
      }
    }

    return scored
      .map((item, originalPosition) => {
        const isScoped = isInScope(item.entry, activeScope);
        const favoriteBonus = favoritePaths.has(item.entry.path) ? 5 : 0;
        const recentBonus = Math.min(recentUseCounts.get(item.entry.path) || 0, 3);
        const score = (
          item.baseScore
          + favoriteBonus
          + recentBonus
          + (isScoped ? 4 : 0)
          + getLanguageScore(item.entry, preferences.preferredLanguage)
          + getSynonymScore(item.entry, context.fieldContext)
          + getInputTypeScore(item.entry, context.fieldContext)
          + getMaximumLengthScore(item.entry, context.fieldContext)
        );

        return {
          entry: item.entry,
          baseScore: item.baseScore,
          score,
          isScoped,
          originalPosition,
        };
      })
      .filter((item) => (
        activeScope.length === 0
        || preferences.scopeOnly !== true
        || item.isScoped
      ))
      .sort((left, right) => (
        right.score - left.score
        || left.entry.path.length - right.entry.path.length
        || comparePaths(left.entry.path, right.entry.path)
        || left.originalPosition - right.originalPosition
      ))
      .map(({ entry, baseScore, score }) => ({ entry, baseScore, score }));
  }

  globalThis.LBA.ranking = Object.freeze({
    rankEntries,
  });
})();
