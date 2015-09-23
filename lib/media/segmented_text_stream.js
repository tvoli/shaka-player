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

goog.require('shaka.util.FakeEventTarget');
goog.require('shaka.media.TextTracksManager');

goog.provide('shaka.media.SegmentedTextStream');


shaka.media.SegmentedTextStream = function(parent, video, textTracks) {
  shaka.util.FakeEventTarget.call(this, parent);
  console.log("HELLO", parent, video, textTracks);

  /** @private {!HTMLVideoElement} */
  this.video_ = video;

  /** @private {!shaka.media.TextTracksManager} */
  this.ttm_ = this.sbm_ =
    new shaka.media.TextTracksManager(video, textTracks);

  /** @private {?number} */
  this.updateTimer_ = null;

  if (!COMPILED) {
    /**
     * For debugging purposes.
     * @private {boolean}
     */
    this.fetching_ = false;
  }
};

goog.inherits(shaka.media.SegmentedTextStream, shaka.util.FakeEventTarget);

/**
 * Destroys the Stream.
 */
shaka.media.SegmentedTextStream.prototype.destroy = function() {
  console.log("destroy");
};


/** @return {shaka.media.StreamInfo} */
shaka.media.SegmentedTextStream.prototype.getStreamInfo = function() {
  console.log("getStreamInfo");
  return this.streamInfo_;
};


/** @return {shaka.media.SegmentIndex} */
shaka.media.SegmentedTextStream.prototype.getSegmentIndex = function() {
  console.log("getSegmentIndex");
  return this.segmentIndex_;
};


/** @return {boolean} */
shaka.media.SegmentedTextStream.prototype.hasStarted = function() {
  console.log("hasStarted");
  return true;
};


/** @return {boolean} */
shaka.media.SegmentedTextStream.prototype.hasEnded = function() {
  console.log("hasEnded");
  return true;
};

shaka.media.SegmentedTextStream.prototype.onUpdate_ = function() {
  shaka.asserts.assert(this.streamInfo_);
  shaka.asserts.assert(this.segmentIndex_);
  shaka.asserts.assert((this.updateTimer_ != null) && !this.resyncing_);
  shaka.asserts.assert(!this.fetching_);

  this.updateTimer_ = null;

  var segmentIndex =
  /** @type {!shaka.media.SegmentIndex} */ (this.segmentIndex_);

  var currentTime = this.video_.currentTime;

  var reference = this.getNext_(currentTime, segmentIndex);
  if (!reference) {
    shaka.log.v1('A new segment is not needed or is not available.');

    // Check again in a second: the SegmentIndex might be generating
    // SegmentReferences or there might be a manifest update.
    this.setUpdateTimer_(1000);
    return;
  }
  
  if (!COMPILED) {
    this.fetching_ = true;
  }

  var fetch = this.ttm_.fetch(reference, this.streamInfo_);
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


/**
 * Start or switch the stream to the given |streamInfo|.
 *
 * @param {!shaka.media.StreamInfo} streamInfo
 * @param {number} minBufferTime The amount of content to buffer, in seconds,
 *     when the stream starts for the first time.
 * @param {boolean} clearBuffer If true, removes the previous stream's content
 *     before switching to the new stream.
 */
shaka.media.SegmentedTextStream.prototype.switch = function(
    streamInfo, minBufferTime, clearBuffer) {
  console.log("clear buffer", clearBuffer);

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
 * Resync the stream with the video's currentTime.  Called on seeking.
 */
shaka.media.SegmentedTextStream.prototype.resync = function() {
  console.log("resync");
  return this.resync_(false /* forceClear */);
};


/**
 * Enable or disable the stream.  Not supported for all stream types.
 *
 * @param {boolean} enabled
 */
shaka.media.SegmentedTextStream.prototype.setEnabled = function(enabled) {
  console.log("setEnabled");
  //this.setUpdateTimer_(0);
};


/**
 * @return {boolean} true if the stream is enabled.
 */
shaka.media.SegmentedTextStream.prototype.getEnabled = function() {
  console.log("getEnabled");
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
          shaka.log.debug('Nudge needed!');
          this.needsNudge_ = true;
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



/**
 * Sets the update timer.
 *
 * @param {number} ms The timeout in milliseconds.
 * @private
 */
shaka.media.SegmentedTextStream.prototype.setUpdateTimer_ = function(ms) {
  shaka.asserts.assert(this.updateTimer_ == null);
  this.updateTimer_ = window.setTimeout(this.onUpdate_.bind(this), ms);
};


/**
 * Cancels the update timer if it is running.
 *
 * @private
 */
shaka.media.SegmentedTextStream.prototype.cancelUpdateTimer_ = function() {
  if (this.updateTimer_ != null) {
    window.clearTimeout(this.updateTimer_);
    this.updateTimer_ = null;
  }
};


shaka.media.SegmentedTextStream.prototype.getNext_ = function(
    currentTime, segmentIndex) {
  var last = this.ttm_.getLastInserted();
  return last != null ?
         (last.endTime != null ? segmentIndex.find(last.endTime) : null) :
         segmentIndex.find(currentTime);
};

