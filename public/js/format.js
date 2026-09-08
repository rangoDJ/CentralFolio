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
        root.csvCell = mod.csvCell;
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

    /**
     * One CSV cell: quoted where needed, and neutralised against spreadsheet
     * formula injection.
     *
     * Excel and LibreOffice execute a cell beginning `=`, `+`, `-`, `@`, tab or
     * CR as a formula, and these exports carry broker-supplied text (symbols,
     * holding descriptions, account names) the user never typed.
     *
     * Plain numbers are exempt: a leading `-` is just a negative value, and
     * quoting it would turn every loss into text a spreadsheet cannot sum.
     *
     * Mirrors csvCell in src/utils/csv.ts — the two cannot share a module
     * because that one is TypeScript under src/ and this loads as a script tag.
     */
    function csvCell(value) {
        let s = value == null ? '' : String(value);
        // `-` sits last in the class so it reads as a literal, not a range.
        if (/^[=+@\t\r-]/.test(s) && !isPlainNumber(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /** A bare numeric literal as JS stringifies one — never a leading `+`. */
    function isPlainNumber(s) {
        return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s.trim());
    }

    return { sanitize, csvCell };
});
