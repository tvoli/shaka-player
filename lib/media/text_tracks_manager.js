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
 * @fileoverview Manages a SourceBuffer an provides an enhanced interface
 * based on Promises.
 */

goog.provide('shaka.media.TextTracksManager');

goog.require('shaka.asserts');
goog.require('shaka.util.EventManager');
goog.require('shaka.util.IBandwidthEstimator');
goog.require('shaka.util.PublicPromise');
goog.require('shaka.util.RangeRequest');
goog.require('shaka.util.Task');
goog.require('shaka.util.TypedBind');
goog.require('shaka.log');
goog.require('shaka.util.WebVttParser');


/**
 * Creates a TextTracksManager (TTM).
 *
 * The TTM manages access to a TextTracks object through a fetch operation
 * and a clear operation. It also maintains a "virtual source buffer" to keep
 * track of which segments have been appended to the actual underlying
 * TextTracks. The TTM uses this virtual source buffer because it cannot rely
 * on the browser to tell it what is in the underlying TextTracks because a
 * SegmentIndex may use PTS (presentation timestamps) and a browser may use
 * DTS (decoding timestamps) or vice-versa.
 *
 * @param {!HTMLVideoElement} video The video element.
 * @param {!TextTrackList} textTracksSource
 * @struct
 * @constructor
 */
shaka.media.TextTracksManager = function(
  video, textTracksSource) {

  /** @private {!HTMLVideoElement} */
  this.video_ = video;

  /** @private {!TextTrackList} */
  this.textTracksSource_ = textTracksSource;

  /** @private {!shaka.util.EventManager} */
  this.eventManager_ = new shaka.util.EventManager();

  /**
   * Contains a list of segments that have been inserted into the SourceBuffer.
   * These segments may or may not have been evicted by the browser.
   * @private {!Array.<!shaka.media.SegmentReference>}
   */
  this.inserted_ = [];

  /** @private {number} */
  this.timestampCorrection_ = 0;

  /** @private {shaka.util.Task} */
  this.task_ = null;

  /** @private {shaka.util.PublicPromise} */
  this.operationPromise_ = null;

  this.strTextTrackLabel = null;
};
goog
  .inherits(shaka.media.TextTracksManager, shaka.media.SourceBufferManager);


/**
 * Destroys the SourceBufferManager.
 * @override
 */
shaka.media.TextTracksManager.prototype.destroy = function() {
  this.abort();
  this.clearTextTracks();

  this.operationPromise_ = null;
  this.task_ = null;

  this.inserted_ = null;

  this.eventManager_.destroy();
  this.eventManager_ = null;

  this.textTracksSource_ = null;
  this.strTextTrackLabel = null;
  this.video_ = null;
};


/**
 * Computes how far ahead of the given timestamp we have buffered according to
 * the underlying TextTrackList.
 *
 * @param {number} timestamp The timestamp in seconds.
 * @return {number} in seconds
 */
shaka.media.TextTracksManager.prototype.bufferedAheadOf = function(timestamp) {
  var objTrack;
  var numDifference = 0;
  var objLastTime;
  if (this.textTracksSource_.length) {
    try {
      objTrack = this.getTextTrack(this.strTextTrackLabel);
      if ((objTrack) && objTrack.cues) {
        shaka.asserts.assert(timestamp);
        shaka.asserts.assert(objTrack.cues);

        objLastTime = Array.prototype.slice.call(objTrack.cues)
          .sort(function (objA, objB) {
            return objB.endTime - objA.endTime;
          })[0];
        numDifference = objLastTime.endTime - timestamp;
      }
    } catch (e) {
      shaka.log.debug('Could not figure out buffered ahead time:', e);
    }
  }
  return numDifference;
};


/**
 * Fetches the segment corresponding to the given SegmentReference and appends
 * the it to the underlying SourceBuffer. This cannot be called if another
 * operation is in progress.
 *
 * @param {!shaka.media.SegmentReference} reference
 * @param {Object} streamInfo Optional information used for constructing
 * textTracks information
 * @return {!Promise.<?number>} A promise to a timestamp correction, which may
 *     be null if a timestamp correction could not be computed. A timestamp
 *     correction is computed if the underlying SourceBuffer is initially
 *     empty. The timestamp correction, if one is computed, is not
 *     automatically applied to the virtual source buffer; to apply a timestamp
 *     correction, call correct().
 */
shaka.media.TextTracksManager.prototype.fetch = function(
  reference, streamInfo) {
  shaka.log.v1('fetch');

  this.strTextTrackLabel = streamInfo.id;

  // Check state.
  shaka.asserts.assert(!this.task_);
  if (this.task_) {
    var error = new Error('Cannot fetch: previous operation not complete.');
    error.type = 'stream';
    return Promise.reject(error);
  }

  this.task_ = new shaka.util.Task();

  this.task_.append(
    function() {
      var refDuration =
        reference.endTime ? (reference.endTime - reference.startTime) : 1;
      var request = new shaka.util.RangeRequest(
        reference.url.toString(),
        reference.startByte,
        reference.endByte,
        3,
        refDuration * 1000);
      request.parameters.responseType = 'text';
      return [request.send(), request.abort.bind(request)];
    }.bind(this));

  this.task_.append(shaka.util.TypedBind(this,
    function(data) {
      var append = this.append_.call(this, data, streamInfo);
      return [append, this.abort_.bind(this)];
    }));

  this.task_.append(
    function() {
      var i = shaka.media.SegmentReference
        .find(this.inserted_, reference.startTime);
      if (i >= 0) {
        // The SegmentReference at i has a start time less than |reference|'s.
        this.inserted_.splice(i + 1, 0, reference);
      } else {
        this.inserted_.push(reference);
      }
    }.bind(this));

  return this.startTask_().then(
    function() {
      return Promise.resolve(0);
    }.bind(this));
};


/** @override */
shaka.media.TextTracksManager.prototype.detectMultipleBufferedRanges =
  function() {
  return false; //TODO: Fix this properly

  if (this.textTracksSource_.length > 1) {
    shaka.log.error(
      'Multiple buffered ranges detected:',
      'Either the content has gaps in it,',
      'the content\'s segments are not aligned across bitrates,',
      'or the browser has evicted the middle of the buffer.');
    return true;
  } else {
    return false;
  }
};


/**
 * Append to the text tracks object.
 *
 * @param {!String} data
 * @param {Object} streamInfo
 * @return {!Promise}
 * @private
 */
shaka.media.TextTracksManager.prototype.append_ = function(data, streamInfo) {
  shaka.asserts.assert(!this.operationPromise_);
  shaka.asserts.assert(this.task_);

  try {
    var strId = streamInfo.id;
    var strLang = streamInfo.segmentIndexSource ?
      streamInfo.segmentIndexSource.representation_.lang : '';
    var strSubtitles = data;

    var boolTrack = strSubtitles.indexOf('-->') !== -1;
    var objTrack = this.addOrGetTextTrack(strId, strLang);

    if (boolTrack) {
      var objParsed = new shaka.util.WebVttParser().parse(strSubtitles);
      objParsed.cues.forEach(function(objCue) {
        var objMatchedCue =
          Array.prototype.slice.call(objTrack.cues || []).slice(-10)
            .filter(function(objStoredCue) {
              return objStoredCue.text === objCue.text;
            })
            .slice(-1)[0];
        if (objMatchedCue) {
          objMatchedCue.endTime = objCue.endTime;
          shaka.log.debug('Editing parsed VTT cue', {
            start: objMatchedCue.startTime,
            end: objCue.endTime,
            text: objMatchedCue.text
          });
        } else {
          objTrack
            .addCue(new VTTCue(objCue.startTime, objCue.endTime, objCue.text));
          shaka.log.debug('Adding parsed VTT cue', {
            start: objCue.startTime,
            end: objCue.endTime,
            text: objCue.text
          });
        }
      });
    }

  } catch (exception) {
    shaka.log.debug('Failed to append buffer:', exception);
    return Promise.reject(exception);
  }

  setTimeout(function () {
    this.onSourceBufferUpdateEnd_(new Event('someEvent'));
  }.bind(this), 0);

  this.operationPromise_ = new shaka.util.PublicPromise();
  return this.operationPromise_;
};


shaka.media.TextTracksManager.prototype.getTextTrack = function (strLabel) {
  return this.findTrackByProperty('label', strLabel);
};

shaka.media.TextTracksManager.prototype.addOrGetTextTrack =
  function (strLabel, strLang, strKind) {
    var strKindDefault = 'subtitles';
    var objTrack = this.getTextTrack(strLabel);
    if (!objTrack) {
      objTrack = this.video_
        .addTextTrack((strKind || strKindDefault), strLabel, strLang);
    }
    return objTrack;
  };


shaka.media.TextTracksManager.prototype.clearTextTracks = function() {
  if (!this.textTracksSource_) {
    return false;
  }
  shaka.asserts.assert(this.textTracksSource_);

  Array.prototype.slice.call(this.textTracksSource_)
    .forEach(function(objTextTrack) {
      Array.prototype.slice.call(objTextTrack.cues || [])
        .forEach(function(objCue) {
          objTextTrack.removeCue(objCue);
        });
      shaka.log.debug('Removed track cues:', objTextTrack);
    });
};


shaka.media.TextTracksManager.prototype.findTrackByProperty =
  function (strKey, strValue) {
    var arrFiltered = Array.prototype.slice.call(this.textTracksSource_)
      .filter(function(objTrack) {
        return objTrack[strKey] === strValue;
      });
    return (arrFiltered.length) ? arrFiltered[0] : null;
  };


/**
 * Clear the source buffer.
 *
 * @return {!Promise}
 * @private
 */
shaka.media.TextTracksManager.prototype.clear_ = function() {
  shaka.asserts.assert(!this.operationPromise_);

  // TODO: Find a way to clear
  if (this.textTracksSource_.length == 0) {
    shaka.log.v1('Nothing to clear.');
    shaka.asserts.assert(this.inserted_.length == 0);
    return Promise.resolve();
  }

  try {
    // This will trigger an 'updateend' event.
    this.clearTextTracks();
    this.inserted_ = [];
    this.strTextTrackLabel = null;
    return Promise.resolve();
  } catch (exception) {
    shaka.log.debug('Failed to clear buffer:', exception);
    return Promise.reject(exception);
  }

  // Clear |inserted_| immediately since any inserted segments will be
  // gone soon.
  this.inserted_ = [];

  this.operationPromise_ = new shaka.util.PublicPromise();
  return this.operationPromise_;
};


/**
 * Abort the current operation on the source buffer.
 *
 * @private
 */
shaka.media.TextTracksManager.prototype.abort_ = function() {
  shaka.log.v1('abort_');
  shaka.asserts.assert(this.operationPromise_);
  // Dont care
};


/**
 * |sourceBuffer_|'s 'updateend' callback.
 *
 * @param {!Event} event
 * @private
 */
shaka.media.TextTracksManager.prototype.onSourceBufferUpdateEnd_ =
  function(event) {

    shaka.log.v2('onSourceBufferUpdateEnd_');
    shaka.asserts.assert(this.operationPromise_);


    this.operationPromise_.resolve();
    this.operationPromise_ = null;
  };
