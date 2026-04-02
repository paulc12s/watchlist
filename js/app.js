// ============================================================================
// Application Initialization
// ============================================================================

'use strict';

// Browser feature detection
function checkBrowserSupport() {
  const required = {
    'IndexedDB': !!window.indexedDB,
    'Fetch API': !!window.fetch,
    'ES6 Features': typeof Promise !== 'undefined' && typeof Symbol !== 'undefined',
    'LocalStorage': (() => {
      try {
        const test = '__test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
      } catch (e) {
        return false;
      }
    })()
  };

  const missing = Object.entries(required)
    .filter(([name, supported]) => !supported)
    .map(([name]) => name);

  if (missing.length > 0) {
    const message = `Your browser doesn't support required features:\n\n${missing.join('\n')}\n\nPlease use a modern browser (Chrome, Firefox, Safari, or Edge).`;
    alert(message);
    console.error('Missing browser features:', missing);
    return false;
  }

  return true;
}

// Application initialization with error boundary
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Check browser support
    if (!checkBrowserSupport()) {
      return;
    }

    // Initialize UI
    UI.init();

    // Load data
    await ItemManager.load();

  } catch (error) {
    console.error('Application initialization failed:', error);
    alert('Failed to start the application. Please refresh the page.\n\nError: ' + error.message);
  }
});

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault(); // Prevent default browser behavior
});
