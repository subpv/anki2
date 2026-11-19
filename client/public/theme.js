// Runs before the app so the page starts in the right theme and language (no flash).
try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.lang = localStorage.getItem('lang') || 'de';
} catch (e) { /* private mode */ }
