'use strict';
/**
 * CAP production bootstrap with React UI served publicly at /.
 * Uses CDS's built-in middleware hook to register static files
 * BEFORE the XSUAA auth guard, so the UI is accessible without login.
 */
const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  const path    = require('path');
  const express = require('express');
  const fs      = require('fs');

  const uiDir = path.join(__dirname, 'app');
  if (fs.existsSync(path.join(uiDir, 'index.html'))) {
    // Serve static assets (JS/CSS bundles) publicly
    app.use(express.static(uiDir));

    // Serve index.html for all non-API routes (React client-side routing)
    app.get(/^\/(?!reconciliation).*/, (_req, res) => {
      res.sendFile(path.join(uiDir, 'index.html'));
    });

    cds.log('server').info('React UI served publicly from', uiDir);
  }
});

module.exports = cds.server;
