'use strict';

globalThis.LBA = globalThis.LBA || {};

(() => {
  if (typeof globalThis.LBA.notifications?.show === 'function') {
    return;
  }

  const DISMISS_AFTER_MS = 4000;
  const TOAST_Z_INDEX = '2147483647';
  let activeHost = null;
  let dismissalTimer = null;

  function dismiss() {
    if (dismissalTimer !== null) {
      globalThis.clearTimeout(dismissalTimer);
      dismissalTimer = null;
    }
    activeHost?.remove();
    activeHost = null;
  }

  function applyStyles(element, styles) {
    Object.assign(element.style, styles);
  }

  function show(message, kind = 'info', action) {
    dismiss();

    const host = document.createElement('div');
    host.setAttribute('data-lba-notification-host', '');
    applyStyles(host, {
      all: 'initial',
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: TOAST_Z_INDEX,
    });

    const shadowRoot = host.attachShadow({ mode: 'closed' });
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    applyStyles(toast, {
      alignItems: 'center',
      background: kind === 'error' ? '#7f1d1d' : '#172033',
      border: '1px solid rgba(255, 255, 255, 0.24)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
      color: '#ffffff',
      display: 'flex',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '14px',
      gap: '12px',
      lineHeight: '1.4',
      maxWidth: 'min(420px, calc(100vw - 32px))',
      padding: '12px 14px',
      pointerEvents: 'auto',
    });

    const messageElement = document.createElement('span');
    messageElement.textContent = String(message ?? '');
    toast.append(messageElement);

    if (
      action
      && typeof action.label === 'string'
      && typeof action.onClick === 'function'
    ) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      applyStyles(button, {
        background: '#ffffff',
        border: '0',
        borderRadius: '5px',
        color: '#172033',
        cursor: 'pointer',
        flex: 'none',
        font: '600 13px system-ui, sans-serif',
        padding: '7px 9px',
      });
      button.addEventListener('click', () => {
        try {
          action.onClick();
        } finally {
          dismiss();
        }
      }, { once: true });
      toast.append(button);
    }

    shadowRoot.append(toast);
    (document.body || document.documentElement).append(host);
    activeHost = host;
    dismissalTimer = globalThis.setTimeout(dismiss, DISMISS_AFTER_MS);
  }

  globalThis.LBA.notifications = Object.freeze({ show });
})();
