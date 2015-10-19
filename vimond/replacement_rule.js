/**
 * Copyright 2015 Vimond Media Solutions
 *
 * @fileoverview Specifies a replacement rule to be used in the manifest modifier setup.
 */

goog.provide('shaka.vimond.dash.ReplacementRule');

/**
 * 
 * @param {RegExp|string} match
 * @param {string} replacement
 * @param {string=} opt_options
 * @constructor
 * @struct
 * @exportDoc
 */
shaka.vimond.dash.ReplacementRule = function(match, replacement, opt_options) {
    'use strict';

    /** @public */
    this.match = match;
    /** @public */
    this.options = opt_options || null;
    /** @public  */
    this.replacement = replacement;
};
goog.exportSymbol('shaka.vimond.dash.ReplacementRule', shaka.vimond.dash.ReplacementRule);