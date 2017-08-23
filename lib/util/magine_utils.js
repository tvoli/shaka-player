/**
 * @license
 * Copyright 2016 Google Inc.
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
 */

goog.provide('shaka.util.MagineUtils');

goog.require('shaka.util.XmlUtils');


/**
 * @namespace shaka.util.MagineUtils
 * @summary Magine utility functions.
 */


/**
 * @description Magine FIX for descriptive AUDIO.
 * This is just a Proof Of Concept, methods that are used to show that we can
 * parse the manifest and generate language shifts within
 * the variants shaka creates, and then use this to separate
 * descriptive audio from regular audio hence creating variants containing
 * regular or descriptive audio. This is propagated out to public
 * methods of shaka, which in turn gets used by the Hipster-Player.
 *
 * TODO: Fix the method modifyIfAccessibTag, should NOT generate multiple
 * roles if we have the role commentary for instance.
 *
 */


/**
 * Method that just returns the language string modified.
 *
 * @param {string} language
 * @return {string}
 */
shaka.util.MagineUtils.prototype.returnAccessibLang = function(language) {
  var accessbilityTag = '-accessibility';
  return language + accessbilityTag;
};


/**
 * This method takes in and adapationSet or a representationSet.
 * If there exists a child element with the accessibility tag,
 * the method will return true otherwise false.
 *
 * @param {!Element} elem
 * @return {boolean} hasAccessibilityElements
 */
shaka.util.MagineUtils.prototype.hasAccessibTag = function(elem) {
  var XmlUtils = shaka.util.XmlUtils,
      accessbilityElems = XmlUtils.findChildren(elem, 'Accessibility'),
      hasAccessiblityElements = false;
  if (accessbilityElems.length > 0) {
    hasAccessiblityElements = true;
  }
  return hasAccessiblityElements;
};


/**
 * Takes in and adapationSet or a representationSet and the roles. If
 * there exists a child element with the Accessibility tag, the method
 * will push commentary to roles and return roles.
 * Also the method will add the role main to all other variants, making it
 * easier to set a prefered role, for instance when we have descriptive audio
 * and no set roles in the manifest.
 *
 * @param {!Array<string>} roles
 * @param {!Element} elem The AdaptionSet or RepresentationSet element.
 * @return {!Array<string>} modifiedRoles
 */
shaka.util.MagineUtils.prototype.modifyIfAccessibTag =
    function(roles, elem) {
  var XmlUtils = shaka.util.XmlUtils,
      accessbilityElems = XmlUtils.findChildren(elem, 'Accessibility'),
      modifiedRoles = roles,
      containsMainRole = false,
      containsNoCommentaryRole = false,
      containsNoMainRole = false;

  if (accessbilityElems.length > 0) {
    // Lets remove the main role if there is such a role,
    // and then just add our commentary role to the variant.
    containsMainRole = this.stringExistsWithinArray(roles, 'main');
    if (containsMainRole) {
      // Remove the main element at index
      modifiedRoles = this.arrayItemRemover(roles, 'main');
    }

    // Maybe check if we already have a commentary role here,
    // maybe was included in the manifest and parsed in
    // the dash_parser.
    // TODO: Make a check if commentary role already added,
    // if this is the case we should not add the role

    // containsCommentaryRole =
    // this.stringExistsWithinArray(roles, 'commentary');
    // roles.indexOf('commentary') === -1 ? false : true;
    // Check if we already have commentary roles here

    // Either we have commentary and we DO not want to add main
    // or we have main and DO not want to add commentary,
    // -> this is solved
    modifiedRoles.push('commentary');
  } else {
    // Now lets try to see if the roles we have contain the role main,
    // if not we should add it
    containsNoMainRole =
        !Boolean(this.stringExistsWithinArray(roles, 'main'));
    containsNoCommentaryRole =
        !Boolean(this.stringExistsWithinArray(roles, 'commentary'));

    //containsMainRole = this.stringExistsWithinArray(roles, 'commentary');
    if (containsNoMainRole &&
        containsNoCommentaryRole) {
      modifiedRoles.push('main');
    }
  }
  return modifiedRoles;
};


/**
 * Utility method to help with parsing through strings in array,
 * helper-method when finding out which roles will be used
 *
 * @param {!Array<string>} arr
 * @param {string} string
 * @return {boolean} stringExists
 */
shaka.util.MagineUtils.prototype.stringExistsWithinArray =
    function(arr, string) {
  return arr.indexOf(string) === -1 ? false : true;
};


/**
 * A utility method to remove all instances of a
 * peticular element from a string array
 *
 * @param {!Array<string>} arr
 * @param {string} string
 * @return {!Array<string>} newArray
 */
shaka.util.MagineUtils.prototype.arrayItemRemover =
    function(arr, string) {
  var newArray = [];
  // Lets generate a new array from the old one
  for (var i = 0, arrayLength = arr.length; i < arrayLength; i++) {
    if (arr[i] !== string) {
      newArray.push(arr[i]);
    }
  }
  return newArray;
};


/**
 * This method modifies the variants so they include
 * the audio language set within the audio track within
 * the variant, if it exists.
 * MAGINE - Variant fix for descriptive audio bug Magine 2017-08-22
 * https://github.com/tvoli/hipster-player/issues/160
 *
 * @param {!Array.<!shakaExtern.Variant>} variants
 * @return {!Array.<!shakaExtern.Variant>} variants
 */
shaka.util.MagineUtils.modifyVariantsWithAudioLanguage =
    function(variants) {
  for (var i = 0, variantsLength = variants.length; i < variantsLength; i++) {
    // FIX for audio language here
    if (variants[i].audio) {
      variants[i].language = variants[i].audio.language;
    }
  }
  return variants;
};
