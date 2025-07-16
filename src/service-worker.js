// Service worker that imports background dependencies
// The default action shortcut (_execute_action) is defined in the manifest
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
