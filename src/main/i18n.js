'use strict';
const { app } = require('electron');
const I18N = require('../shared/i18n');
const settings = require('./settings');

function lang() {
  return I18N.detect(settings.get('appearance.language'), app.getLocale());
}

function t(key, vars) {
  return I18N.translate(lang(), key, vars);
}

module.exports = { t, lang };
