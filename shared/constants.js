'use strict';

globalThis.LBA = globalThis.LBA || {};

globalThis.LBA.constants = Object.freeze({
  STORAGE_KEY: 'lba',
  SCHEMA_VERSION: 2,
  PRIVACY_POLICY_VERSION: '2026-08-02',
  LEGAL_URLS: Object.freeze({
    PRIVACY_POLICY: 'https://solutions.futurion.es/privacy/',
    TERMS_OF_SERVICE: 'https://solutions.futurion.es/terms/',
  }),

  MESSAGE_TYPES: Object.freeze({
    OPEN_PICKER: 'LBA_OPEN_PICKER',
    OPEN_PICKER_ACK: 'LBA_OPEN_PICKER_ACK',
    OPEN_OPTIONS: 'LBA_OPEN_OPTIONS',
  }),

  SUPPORTED_INPUT_TYPES: Object.freeze([
    'text',
    'url',
    'email',
    'tel',
    'search',
    'number',
  ]),

  UNSUPPORTED_FIELD_MESSAGES: Object.freeze({
    SECURE_OR_PAYMENT: 'Password and payment fields are not supported.',
    SECURE: 'Password fields are not supported.',
    PAYMENT: 'Payment fields are not supported.',
    HIDDEN: 'Hidden fields are not supported.',
    FILE: 'File inputs are not supported.',
    CHECKBOX: 'Checkboxes are not supported.',
    RADIO: 'Radio buttons are not supported.',
    DATE_TIME: 'Date and time fields are not supported.',
    COLOR: 'Color fields are not supported.',
    RANGE: 'Range controls are not supported.',
    BUTTON: 'Button fields are not supported.',
    READONLY: 'Readonly fields cannot be edited.',
    DISABLED: 'Disabled fields cannot be edited.',
    UNKNOWN: 'Fields of type {type} are not supported.',
  }),

  PICKER_LABELS: Object.freeze({
    SEARCH_PLACEHOLDER: 'Search business data…',
    SEARCH_ARIA_LABEL: 'Search business data',
    OPEN_OPTIONS: 'Open options',
    INSERT_ANYWAY: 'Insert anyway',
    FAVORITES: 'Favorites',
    RECENT: 'Recent',
    REPLACE: 'Replace',
    AT_CURSOR: 'At cursor',
    CHARACTER_COUNT: '{valueLength} characters',
    MAX_LENGTH: 'Maximum {maxLength} characters',
    FIELD_INFO: 'Field: {detail}',
    EXPAND_PREVIEW: 'Show full value',
    COLLAPSE_PREVIEW: 'Hide full value',
    FAVORITE_ENTRY: 'Add {detail} to favorites',
    UNFAVORITE_ENTRY: 'Remove {detail} from favorites',
    KEYBOARD_HINTS: '↑↓ navigate · Enter insert · Esc close',
    NO_FAVORITES: 'No favorites yet.',
    NO_RECENT: 'No recently used values yet.',
    INSERT_SUCCESS: 'Value inserted.',
    INSERT_SUCCESS_HISTORY_FAILURE: 'Value inserted, but recent history could not be saved.',
  }),

  OPTIONS_LABELS: Object.freeze({
    CHOOSE_JSON: 'Choose a .json file before importing.',
    JSON_EXTENSION: 'The selected file must use the .json extension.',
    FILE_READ_FAILURE: 'File reading failed',
    MALFORMED_JSON: 'The selected file is not valid JSON',
    FLATTEN_FAILURE: 'The JSON profile could not be flattened',
    PROFILE_SAVE_FAILURE: 'The profile could not be saved',
    FAVORITES_CLEANUP_FAILURE:
      'The profile was saved, but stale favorites could not be cleaned up',
    IMPORT_FAILURE: 'Import failed',
    STORAGE_ESTIMATE_FAILURE: 'Could not calculate local storage usage',
    NO_PROFILE_TO_EXPORT: 'There is no stored profile to export.',
    EXPORT_FAILURE: 'Export failed',
    CLEAR_PROFILE_FAILURE: 'Could not clear the profile',
    RESET_EXTENSION_FAILURE: 'Could not reset the extension',
    SAVE_PREFERENCE_FAILURE: 'Could not save the preference',
    REMOVE_FAVORITE_FAILURE: 'Could not remove the favorite',
    CLEAR_FAVORITES_FAILURE: 'Could not clear favorites',
    CLEAR_RECENT_FAILURE: 'Could not clear recent history',
    RESET_PREFERENCES_FAILURE: 'Could not reset preferences',
    INITIALIZATION_FAILURE: 'The options page could not be initialized',
    RECENT_LIMIT: 'Maximum recent entries must be an integer from {min} to {max}.',
    PRIVACY_ACKNOWLEDGMENT_REQUIRED:
      'Read and acknowledge the Privacy Policy and Terms of Service before importing.',
  }),

  ERROR_MESSAGES: Object.freeze({
    NO_PROFILE: 'No business data imported yet — open the extension options to import your JSON',
    MALFORMED_JSON: 'The selected file is not valid JSON: {detail}',
    NO_EDITABLE_FIELD: 'Focus a supported editable field before opening TrustPaste.',
    UNSUPPORTED_FIELD: 'This {type} field is not supported: {detail}',
    CANNOT_INJECT: 'TrustPaste cannot run on this page: {detail}',
    BROWSER_INTERNAL_PAGE: 'TrustPaste cannot run on browser internal pages.',
    CHROME_WEB_STORE_PAGE: 'TrustPaste cannot run on browser extension store pages.',
    PDF_VIEWER: 'TrustPaste cannot run in the built-in PDF viewer.',
    IFRAME_ACCESS_RESTRICTION: 'TrustPaste cannot access a field inside a cross-origin iframe.',
    FIELD_REMOVED: 'The selected field was removed from the page before the value could be inserted.',
    VALUE_TOO_LONG: 'Value is {valueLength} characters, field allows {maxLength}.',
    STORAGE_FAILURE: 'TrustPaste could not access local storage: {detail}',
    OPEN_OPTIONS_FAILURE: 'The extension options could not be opened: {detail}',
    INSERTION_UNAVAILABLE: 'The value could not be inserted because the insertion engine is unavailable.',
    INSERTION_FAILURE: 'The value could not be inserted into this field.',
    MALFORMED_STORED_DATA: 'Stored TrustPaste data was malformed and has been repaired.',
    NO_SEARCH_RESULTS: 'No results for “{query}”.',
  }),

  LANGUAGE_ALIASES: Object.freeze({
    en: Object.freeze(['en', 'english', 'ingles', 'inglés']),
    es: Object.freeze(['es', 'spanish', 'espanol', 'español']),
  }),

  MAX_RECENT: 20,
  PREVIEW_TRUNCATION_LENGTH: 160,
  PICKER_Z_INDEX: 2147483646,
});
