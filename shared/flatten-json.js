'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (globalThis.LBA.flatten) {
    return;
  }

  function isJsonContainer(value) {
    if (Array.isArray(value)) {
      return true;
    }

    if (value === null || typeof value !== 'object') {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function getPrimitiveType(value, path) {
    if (value === null) {
      return 'null';
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'boolean') {
      return valueType;
    }

    if (valueType === 'number' && Number.isFinite(value)) {
      return valueType;
    }

    throw new TypeError(`Value at "${path}" is not valid JSON.`);
  }

  function createEntry(pathSegments, primitiveValue) {
    const valueType = getPrimitiveType(primitiveValue, pathSegments.join('.'));
    const value = primitiveValue === null ? '' : String(primitiveValue);
    const label = pathSegments[pathSegments.length - 1];

    return {
      path: pathSegments.join('.'),
      pathSegments,
      label,
      value,
      valueType,
      characterCount: value.length,
      searchableText: globalThis.LBA.normalize.normalizeText(
        [...pathSegments, label, value].join(' '),
      ),
    };
  }

  /**
   * Flatten every primitive leaf of a JSON object or array.
   *
   * Iterative traversal prevents call-stack exhaustion for deeply nested profiles.
   *
   * @param {object|Array} rawJson
   * @returns {Array<object>}
   */
  function flattenJson(rawJson) {
    if (!isJsonContainer(rawJson)) {
      throw new TypeError('JSON root must be an object or array.');
    }

    const entries = [];
    const visited = new WeakSet();
    const stack = [{ value: rawJson, pathSegments: [] }];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!isJsonContainer(current.value)) {
        entries.push(createEntry(current.pathSegments, current.value));
        continue;
      }

      if (visited.has(current.value)) {
        throw new TypeError('JSON data must not contain circular or repeated object references.');
      }
      visited.add(current.value);

      if (Array.isArray(current.value)) {
        for (let index = current.value.length - 1; index >= 0; index -= 1) {
          if (!Object.hasOwn(current.value, index)) {
            throw new TypeError(
              `Sparse array at "${current.pathSegments.join('.')}" is not valid JSON.`,
            );
          }
          stack.push({
            value: current.value[index],
            pathSegments: [...current.pathSegments, String(index)],
          });
        }
        continue;
      }

      const keys = Object.keys(current.value);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        stack.push({
          value: current.value[key],
          pathSegments: [...current.pathSegments, key],
        });
      }
    }

    return entries;
  }

  globalThis.LBA.flatten = Object.freeze({
    flattenJson,
  });
})();
