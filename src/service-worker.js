// service worker that imports background dependencies
importScripts(
  'browser-polyfill.min.js',
  'background/apache-mime-types.js',
  'background/moment.min.js',
  'background/turndown.js',
  'background/turndown-plugin-gfm.js',
  '/background/Readability.js',
  'shared/context-menus.js',
  'shared/default-options.js',
  'background/background.js'
);
