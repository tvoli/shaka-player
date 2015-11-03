/**
 * Copyright 2015 Vimond Media Solutions.
 *
 * @fileoverview Implements an MPD request where the data sent to parsing can be preprocessed and modified.
 */

goog.provide('shaka.vimond.dash.PreprocessableMpdRequest');
goog.require('shaka.dash.MpdRequest');
goog.require('shaka.dash.mpd');
goog.require('shaka.vimond.dash.ManifestTextPreprocessor');
goog.require('shaka.player.Defaults');
goog.require('shaka.util.AjaxRequest');
goog.require('shaka.util.FailoverUri');
goog.require('shaka.util.FailoverUri');

/**
 * Creates an MpdRequest where the manifest can be modified.
 *
 * @param {!shaka.util.FailoverUri} url The URL.
 * @param {number=} opt_requestTimeout The timeout for a MpdRequest in seconds.
 * @param {shaka.vimond.dash.ManifestModificationSetup=} opt_modificationSetup
 *
 * @constructor
 * @struct
 * @extends {shaka.dash.MpdRequest}
 * @exportDoc
 */
shaka.vimond.dash.PreprocessableMpdRequest = function(url, opt_requestTimeout, opt_modificationSetup) {
    shaka.dash.MpdRequest.call(this, url, opt_requestTimeout);
    /** @private {shaka.vimond.dash.ManifestTextPreprocessor} */
    this.manifestTextPreprocessor_ = new shaka.vimond.dash.ManifestTextPreprocessor(opt_modificationSetup);
    /** @private {?shaka.vimond.dash.ManifestModificationSetup} */
    this.modificationSetup_ = opt_modificationSetup || null;
    this.presentationTimeOffsetFixMethod_ = null;
    if (this.modificationSetup_ && this.modificationSetup_.presentationTimeOffsetFixPolicy) {
        this.presentationTimeOffsetFixMethod_ = this.modificationSetup_.presentationTimeOffsetFixPolicy == 'highest' ? this.findHighestOffset_ :
            (this.modificationSetup_.presentationTimeOffsetFixPolicy == 'lowest' ? this.findLowestOffset_ : this.findFirstOffsetWithVideo_);  
    }

};

goog.inherits(shaka.vimond.dash.PreprocessableMpdRequest, shaka.dash.MpdRequest);

/** @override */
shaka.vimond.dash.PreprocessableMpdRequest.prototype.send = function() {
    var url = this.url_;
    return url.fetch(this.parameters_).then(function(data) {
            var mpd = shaka.dash.mpd.parseMpd(this.manifestTextPreprocessor_.process(data), url.urls);
            if (mpd) {
                return Promise.resolve(this.applyPresentationTimeOffsetFix_(mpd));
            }

            var error = new Error('MPD parse failure.');
            error.type = 'mpd';
            return Promise.reject(error);
        }.bind(this));
};

/**
 * If a presentationTimeOffset fix policy is specified, applies such a fix if needed, by mutating the Mpd instance.
 * @param {shaka.dash.mpd.Mpd} mpd
 * @returns {shaka.dash.mpd.Mpd}
 */
shaka.vimond.dash.PreprocessableMpdRequest.prototype.applyPresentationTimeOffsetFix_ = function(mpd) {
    "use strict";
    if (mpd.type === 'static' && mpd.periods && this.presentationTimeOffsetFixMethod_) {
        mpd.periods.forEach(function(/** @type {shaka.dash.mpd.Period} */ period) {
            var offset = this.presentationTimeOffsetFixMethod_(period);
            try {
                if (offset > 0) {
                    shaka.log.info('Found missing presentationTimeOffset from segment start offset, based on the configured ' + this.modificationSetup_.presentationTimeOffsetFixPolicy + ' policy.', offset);
                    period.adaptationSets.forEach(function (a) {
                        if (!a.segmentTemplate.presentationTimeOffset) {
                            a.segmentTemplate.presentationTimeOffset = offset * (a.segmentTemplate.timescale || 1);
                        }
                        if (a.representations) {
                            a.representations.forEach(function(/** {shaka.dash.mpd.Representation} */ r) {
                                if (r.segmentTemplate && !r.segmentTemplate.presentationTimeOffset) {
                                    r.segmentTemplate.presentationTimeOffset = offset * (r.segmentTemplate.timescale || 1);
                                }
                            });
                        }
                    });
                }
            } catch(e) {
                shaka.log.warning('Attempt of fixing presentationTimeOffset in manifest failed. Trying to continue anyway.', e, period);
            }
        }.bind(this));
    }
    shaka.log.info('MPD', mpd);
    return mpd;
};

/**
 * This algorithm of finding the value to be used as the missing presentationTimeOffset has proven to work best in practical testing.
 * @param {shaka.dash.mpd.Period} period
 * @returns {number} The offset based on the video segment list, if relevant.
 * @private
 */
shaka.vimond.dash.PreprocessableMpdRequest.prototype.findFirstOffsetWithVideo_ = function(period) {
    'use strict';
    var videoOffset = 0;
    try {
        period.adaptationSets.forEach(function(/** @type {shaka.dash.mpd.AdaptationSet} */ as) {
            var st = as.segmentTemplate;
            if (st && !st.presentationTimeOffset) {
                var firstSegment = st.timeline && st.timeline.timePoints && st.timeline.timePoints[0];
                if (firstSegment.startTime) {
                    var offset = firstSegment.startTime / (st.timescale || 1);
                    if (as.contentType === 'video') {
                        videoOffset = offset;
                    }
                }
            }
        });
    } catch(e) {
        shaka.log.warning('Error when searching for start offset snapping to video segment start.', e);
        return 0;
    }
    return videoOffset;
};

shaka.vimond.dash.PreprocessableMpdRequest.prototype.findLowestOffset_ = function(period) {
    'use strict';
    var lowestOffset = 0;
    try {
        period.adaptationSets.forEach(function (/** @type {shaka.dash.mpd.AdaptationSet} */ as) {
            var st = as.segmentTemplate;
            if (st && !st.presentationTimeOffset) {
                var firstSegment = st.timeline && st.timeline.timePoints && st.timeline.timePoints[0];
                if (firstSegment.startTime) {
                    var offset = firstSegment.startTime / (st.timescale || 1);
                    lowestOffset = lowestOffset === 0 ? offset : Math.min(lowestOffset, offset);
                }
            }
        });
    } catch(e) {
        shaka.log.warning('Error when searching for lowest start offset.', e);
        return 0;
    }
    return lowestOffset;
};

shaka.vimond.dash.PreprocessableMpdRequest.prototype.findHighestOffset_ = function(period) {
    'use strict';
    var highestOffset = 0;
    try {
        period.adaptationSets.forEach(function (/** @type {shaka.dash.mpd.AdaptationSet} */ as) {
            var st = as.segmentTemplate;
            if (st && !st.presentationTimeOffset) {
                var firstSegment = st.timeline && st.timeline.timePoints && st.timeline.timePoints[0];
                if (firstSegment.startTime) {
                    var offset = firstSegment.startTime / (st.timescale || 1);
                    highestOffset = Math.max(highestOffset, offset);
                }
            }
        });
    } catch(e) {
        shaka.log.warning('Error when searching for highest start offset.', e);
        return 0;
    }
    return highestOffset;
};

