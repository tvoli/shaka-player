/**
 * Copyright 2014 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Implements a segmented text stream.
 */

goog.provide('shaka.media.SegmentedTextStream');

goog.require('shaka.media.TextTracksManager');
goog.require('shaka.asserts');
goog.require('shaka.log');
goog.require('shaka.media.IStream');
goog.require('shaka.media.Stream');
goog.require('shaka.media.StreamInfo');
goog.require('shaka.util.FakeEvent');
goog.require('shaka.util.FakeEventTarget');
goog.require('shaka.util.TypedBind');


/**
 * Creates a SegmentedTextStream.
 * @param {!shaka.util.FakeEventTarget} parent The parent for event bubbling.
 * @param {!HTMLVideoElement} video The video element.
 * @param {!TextTrackList} textTracks Text Tracks object attached to video.
 *
 * @fires shaka.media.Stream.AdaptationEvent
 * @fires shaka.media.Stream.EndedEvent
 * @fires shaka.media.Stream.StartedEvent
 * @fires shaka.player.Player.ErrorEvent
 *
 * @struct
 * @constructor
 * @implements {shaka.media.IStream}
 * @extends {shaka.util.FakeEventTarget}
 */
shaka.media.SegmentedTextStream =
  function(parent, video, textTracks) {
    shaka.util.FakeEventTarget.call(this, parent);

    /** @private {!HTMLVideoElement} */
    this.video_ = video;

    /** @private {!shaka.media.TextTracksManager} */
    this.sbm_ = this.ttm_ =
      new shaka.media.TextTracksManager(video, textTracks);

    /** @private {shaka.media.StreamInfo} */
    this.streamInfo_ = null;

    /** @private {shaka.media.SegmentIndex} */
    this.segmentIndex_ = null;

    /** @private {number} */
    this.minBufferTime_ = 0;

    /** @private {boolean} */
    this.switched_ = false;

    /** @private {?number} */
    this.updateTimer_ = null;

    /** @private {boolean} */
    this.resyncing_ = false;

    /** @private {?number} */
    this.timestampCorrection_ = null;

    /** @private {boolean} */
    this.started_ = false;

    /** @private {boolean} */
    this.ended_ = false;

    /** @private {boolean} */
    this.enabled_= true;

    if (!COMPILED) {
      /**
       * For debugging purposes.
       * @private {boolean}
       */
      this.fetching_ = false;
    }
  };
goog
  .inherits(shaka.media.SegmentedTextStream, shaka.media.Stream);


/** @override */
shaka.media.SegmentedTextStream.prototype.destroy = function() {
  this.cancelUpdateTimer_();

  this.streamInfo_ = null;

  this.ttm_.destroy();
  this.ttm_ = null;

  this.video_ = null;

  this.parent = null;

  this.enabled_= false;
  this.started_ = false;
  this.ended_ = false;
};


/** @override */
shaka.media.SegmentedTextStream.prototype.switch = function(
  streamInfo, minBufferTime, clearBuffer) {
  if (streamInfo == this.streamInfo_) {
    shaka.log.debug('Already using stream', streamInfo);
    return;
  }

  streamInfo.segmentIndexSource.create()
    .then(shaka.util.TypedBind(this,
      /** @param {!Array} result */
      function(result) {
        var previousStreamInfo = this.streamInfo_;

        this.streamInfo_ = streamInfo;
        this.segmentIndex_ = result;
        this.minBufferTime_ = minBufferTime;
        this.switched_ = true;

        if (this.resyncing_) {
          // resync() was called while creating the SegmentIndex and init data.
          // resync() will set the update timer if needed.
          return;
        }

        if (!previousStreamInfo) {
          // Call onUpdate_() asynchronously so it can more easily assert that
          // it was called at an appopriate time.
          this.setUpdateTimer_(0);
        } else if (clearBuffer) {
          this.resync_(true /* forceClear */);
        } else {
          shaka.asserts.assert((this.updateTimer_ != null) || this.fetching_);
        }
      })
  ).catch(shaka.util.TypedBind(this,
      /** @param {*} error */
      function(error) {
        if (error.type != 'aborted') {
          var event = shaka.util.FakeEvent.createErrorEvent(error);
          this.dispatchEvent(event);
        }
      })
  );
};


/**
 * Resync the stream.
 *
 * @param {boolean} forceClear
 * @private
 */
shaka.media.SegmentedTextStream.prototype.resync_ = function(forceClear) {
  if (!this.streamInfo_ || this.resyncing_) {
    return;
  }

  shaka.asserts.assert((this.updateTimer_ != null) || this.fetching_);

  this.resyncing_ = true;
  this.cancelUpdateTimer_();

  this.ttm_.abort().then(shaka.util.TypedBind(this,
      function() {
        shaka.log.v1('Abort done.');
        shaka.asserts.assert((this.updateTimer_ == null) && this.resyncing_);
        shaka.asserts.assert(!this.fetching_);

        // Clear the source buffer if we are seeking outside of the currently
        // buffered range.  This seems to make the browser's eviction policy
        // saner and fixes "dead-zone" issues such as #15 and #26.  If seeking
        // within the buffered range, we avoid clearing so that we don't
        // re-download content.
        var currentTime = this.video_.currentTime;
        if (forceClear ||
          !this.ttm_.isBuffered(currentTime) ||
          !this.ttm_.isInserted(currentTime)) {
          return this.ttm_.clear();
        } else {
          return Promise.resolve();
        }
      })
  ).then(shaka.util.TypedBind(this,
      function() {
        shaka.asserts.assert((this.updateTimer_ == null) && this.resyncing_);
        shaka.asserts.assert(!this.fetching_);
        this.resyncing_ = false;
        this.setUpdateTimer_(0);
      })
  ).catch(shaka.util.TypedBind(this,
      function(error) {
        shaka.asserts.assert(error.type != 'aborted');
        this.resyncing_ = false;

        // Dispatch the event to the application.
        var event = shaka.util.FakeEvent.createErrorEvent(error);
        this.dispatchEvent(event);
      })
  );
};


/** @override */
shaka.media.SegmentedTextStream.prototype.setEnabled = function(enabled) {
  this.enabled_ = enabled;
  var strId = (this.streamInfo_) ? this.streamInfo_.id : 'undefined';
  var objTrack = this.ttm_.getTextTrack(strId);
  if (objTrack) {
    objTrack.mode = enabled ? 'showing' : 'disabled';
  }

  //this.setUpdateTimer_(0);
};


/** @override */
shaka.media.SegmentedTextStream.prototype.getEnabled = function() {
  return this.enabled_;
};


/**
 * Update callback.
 * @private
 */
shaka.media.SegmentedTextStream.prototype.onUpdate_ = function() {
  shaka.log.v2('onUpdate_');

  shaka.asserts.assert(this.streamInfo_);
  shaka.asserts.assert(this.segmentIndex_);
  shaka.asserts.assert((this.updateTimer_ != null) && !this.resyncing_);
  shaka.asserts.assert(!this.fetching_);

  // We should only have one buffered range at any given time, so the next
  // segment we need is after the last one we inserted. However, non-ideal
  // content and/or browser eviction policy may induce multiple buffered
  // ranges in some cases.
  if (this.ttm_.detectMultipleBufferedRanges() && this.started_) {
    // Try to recover by clearing the buffer.
    console.log('resync');
    this.resync_(true);
    return;
  }

  this.updateTimer_ = null;

  // Retain local copies since switch() may be called while fetching.
  var streamInfo = /** @type {!shaka.media.StreamInfo} */ (this.streamInfo_);
  var segmentIndex =
  /** @type {!shaka.media.SegmentIndex} */ (this.segmentIndex_);

  var currentTime = this.video_.currentTime;

  var bufferedAhead = this.ttm_.bufferedAheadOf(currentTime);
  var bufferingGoal = this.getBufferingGoal_();
  if (bufferedAhead >= bufferingGoal) {
    shaka.log.v1('Buffering goal reached.');
    this.startIfNeeded_();
    // TODO: trigger onUpdate_ when playback rate changes (assuming changed
    // through Player.setPlaybackRate).
    var rate = Math.abs(this.video_.playbackRate) || 1;
    this.setUpdateTimer_(1000 / rate);
    return;
  }

  var reference = this.getNext_(currentTime, segmentIndex);
  if (!reference) {
    shaka.log.v1('A new segment is not needed or is not available.');

    // We haven't hit our buffering goal yet, but there's nothing left to
    // buffer.
    this.startIfNeeded_();

    if (!this.ended_) {
      shaka.log.debug('Stream', streamInfo.mimeType, 'has ended.');
      this.ended_ = true;
      this.fireEndedEvent_();
    }

    // Check again in a second: the SegmentIndex might be generating
    // SegmentReferences or there might be a manifest update.
    this.setUpdateTimer_(1000);
    return;
  }

  // Fetch and append the next segment. We only fetch a single segment at a
  // time because fetching multiple segments can cause buffering when bandwidth
  // is limited. If we are behind our buffering goal by more than one segment,
  // we should still be able to catch up by requesting single segments.

  shaka.log.v1('Fetching segment', reference);

  //TODO: Maybe only this.switched?
  //shaka.asserts.assert(!this.switched_);

  if (!COMPILED) {
    this.fetching_ = true;
  }
  var fetch = this.ttm_.fetch(reference, this.streamInfo_);
  this.initData_ = null;
  if (this.switched_) {
    this.switched_ = false;
    this.fireAdaptationEvent_(streamInfo);
  }

  fetch.then(shaka.util.TypedBind(this,
      /** @param {?number} timestampCorrection */
      function(timestampCorrection) {
        shaka.log.v1('Fetch done.');
        shaka.asserts.assert((this.updateTimer_ == null) && !this.resyncing_);
        shaka.asserts.assert(this.fetching_);

        if (!COMPILED) {
          this.fetching_ = false;
        }

        this.ended_ = false;

        //TODO: Do we need all of this?
        if (this.timestampCorrection_ == null) {
          shaka.asserts.assert(!this.started_);
          shaka.asserts.assert(timestampCorrection != null);
          this.timestampCorrection_ = timestampCorrection;
        }

        this.started_ = true;
        //this.setEnabled(this.enabled_);

        this.setUpdateTimer_(0);
      })
  ).catch(shaka.util.TypedBind(this,
      /** @param {*} error */
      function(error) {
        if (!COMPILED) {
          this.fetching_ = false;
        }

        if (error.type == 'aborted') {
          // We were aborted from either destroy() or resync().
          shaka.log.v1('Fetch aborted.');
          shaka.asserts.assert(!this.ttm_ || this.resyncing_);
          return;
        }

        // Dispatch the event to the application.
        var event = shaka.util.FakeEvent.createErrorEvent(error);
        this.dispatchEvent(event);

        var recoverableErrors = [0, 404, 410];
        if (error.type == 'net' &&
          recoverableErrors.indexOf(error.xhr.status) != -1) {
          shaka.log.debug('Calling onUpdate_() in 5 seconds...');
          // Depending on application policy, this could be recoverable,
          // so set a timer on the supposition that the app might not end
          // playback.
          this.setUpdateTimer_(5000);
        }
      })
  );
};
