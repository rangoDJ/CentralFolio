/**
 * Shared pure formatting/escaping helpers — no DOM, no globals beyond what they
 * export. Loaded before ui.js/app.js so `sanitize` is available as a global to
 * the existing (non-module) frontend code. Kept dependency-free and side-effect
 * free so it can be unit-tested directly, like divmath.js.
 *
 * This is the first extraction in breaking the monolithic ui.js/app.js into
 * smaller, testable units.
 */
(function (root, factory) {
    const mod = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = mod;
    else {
        root.Format = mod;
        // Preserve the existing global call sites (`sanitize(...)`).
        root.sanitize = mod.sanitize;
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** HTML-escape a value for safe interpolation into innerHTML. */
    function sanitize(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { sanitize };
});
