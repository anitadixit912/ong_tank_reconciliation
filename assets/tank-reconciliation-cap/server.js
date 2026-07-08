'use strict';
// CAP production bootstrap.
// Delegates to @sap/cds's built-in serve CLI entry point.
const path = require('path');
process.argv.push('all', '--production');
require(path.join(__dirname, 'node_modules', '@sap/cds', 'bin', 'serve.js'));
