/**
 * Copyright 2015 Vimond Media Solutions
 *
 * @fileoverview Implements a DASH video source where the manifest can be modified client side.
 */

goog.provide('shaka.vimond.player.ModifyableDashVideoSource');

goog.require('shaka.player.DashVideoSource');
goog.require('shaka.dash.MpdProcessor');
goog.require('shaka.vimond.dash.PreprocessableMpdRequest');
goog.require('shaka.dash.mpd');
goog.require('shaka.vimond.dash.ManifestModificationSetup');

/**
 * Creates a DashVideoSource where the manifest can be modified.
 * @param {string} mpdUrl The MPD URL.
 * @param {?shaka.player.DashVideoSource.ContentProtectionCallback} interpretContentProtection A callback to interpret the ContentProtection elements in the MPD.
 * @param {shaka.util.IBandwidthEstimator} estimator
 * @param {shaka.media.IAbrManager} abrManager
 * @param {?function(number)} availabilityStartTimeReady A callback providing the parsed MPD's availabilityStartTime to the consumer, for computing absolute times.
 * @param {shaka.vimond.dash.ManifestModificationSetup=} opt_manifestModificationSetup
 *
 * @constructor
 * @struct
 * @extends {shaka.player.DashVideoSource}
 * @exportDoc
 */
shaka.vimond.player.ModifyableDashVideoSource = function(mpdUrl, interpretContentProtection, estimator, abrManager, availabilityStartTimeReady, opt_manifestModificationSetup) {
    shaka.player.DashVideoSource.call(this, mpdUrl, interpretContentProtection, estimator, abrManager);
    /** @private {?shaka.vimond.dash.ManifestModificationSetup} */
    this.opt_manifestModificationSetup_ = opt_manifestModificationSetup || null;
    /** @private {?function(number)} */
    this.availabilityStartTimeReady_ = availabilityStartTimeReady;
};

goog.inherits(shaka.vimond.player.ModifyableDashVideoSource, shaka.player.DashVideoSource);
if (shaka.features.Dash) {
    goog.exportSymbol('shaka.vimond.player.ModifyableDashVideoSource', shaka.vimond.player.ModifyableDashVideoSource);
}

/** @override */
shaka.vimond.player.ModifyableDashVideoSource.prototype.load = function() {
    var url = new shaka.util.FailoverUri(this.networkCallback_, [new goog.Uri(this.mpdUrl_)]);
    var mpdRequest =
        new shaka.vimond.dash.PreprocessableMpdRequest(url, this.mpdRequestTimeout, this.opt_manifestModificationSetup_);
    return mpdRequest.send().then(shaka.util.TypedBind(this,
            /** @param {!shaka.dash.mpd.Mpd} mpd */
            function(mpd) {
                for (var i = 0; i < this.captionsUrl_.length; i++) {
                    mpd.addExternalCaptions(this.captionsUrl_[i],
                        this.captionsLang_[i], this.captionsMime_[i]);
                }

                if (!shaka.features.Live && mpd.type == 'dynamic') {
                    var error = new Error('Live manifest support not enabled.');
                    error.type = 'stream';
                    return Promise.reject(error);
                }

                var mpdProcessor =
                    new shaka.dash.MpdProcessor(this.interpretContentProtection_);
                this.manifestInfo = mpdProcessor.process(mpd, this.networkCallback_);

                var baseClassLoad = shaka.player.StreamVideoSource.prototype.load;
                var p = baseClassLoad.call(this);

                try {
                    if (this.availabilityStartTimeReady_ && mpd.availabilityStartTime) {
                        this.availabilityStartTimeReady_(mpd.availabilityStartTime);
                    }
                } catch(e) {
                    shaka.log.warning('mpdReady callback failed.', e);
                }
                
                return p;
            })
    );
};

/** @override */
shaka.vimond.player.ModifyableDashVideoSource.prototype.onUpdateManifest = function(url) {
    var mpdRequest =
        new shaka.vimond.dash.PreprocessableMpdRequest(url, this.mpdRequestTimeout, this.opt_manifestModificationSetup_);
    return mpdRequest.send().then(shaka.util.TypedBind(this,
            /** @param {!shaka.dash.mpd.Mpd} mpd */
            function(mpd) {
                var mpdProcessor =
                    new shaka.dash.MpdProcessor(this.interpretContentProtection_);
                var newManifestInfo = mpdProcessor.process(mpd, this.networkCallback_);
                return Promise.resolve(newManifestInfo);
            })
    );
};
