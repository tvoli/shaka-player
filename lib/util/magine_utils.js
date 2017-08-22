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

goog.provide('shaka.util.MagineStreamUtils');

goog.require('shaka.util.XmlUtils');


/**
 * @namespace shaka.util.MagineStreamUtils
 * @summary Magine stream utility functions.
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
 */


/**
 * This method takes in and adapationSet or a representationSet.
 * If there exists a child element with the accessibility tag,
 * the method will return true otherwise false.
 *
 * @param {!Element} elem
 * @return {boolean} hasAccessibilityElements
 * @private
 */
shaka.util.MagineStreamUtils.prototype.hasAccessibTag_ = function(elem) {
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
 * @private
 */
shaka.util.MagineStreamUtils.prototype.modifyIfAccessibTag_ =
    function(roles, elem) {
  var XmlUtils = shaka.util.XmlUtils,
      accessbilityElems = XmlUtils.findChildren(elem, 'Accessibility'),
      modifiedRoles = roles,
      containsMainRole = null,
      containsCommentaryRole = null,
      containsNoMainRole = null;

  if (accessbilityElems.length > 0) {
    // Lets remove the main role if there is such a role,
    // and then just add our commentary role to the variant.
    containsMainRole = this.stringExistsWithinArray(roles, 'main');
    if (containsMainRole) {
      // Remove the main element at index
      modifiedRoles = this.arrayItemRemover(roles, 'main');
    }

    // Maybe check if we already have a commentary role here,
    // maybe was included in the manifest and parsed in the dash_parser.
    // TODO: Make a check if commentary role already added

    containsCommentaryRole = this.stringExistsWithinArray(roles, 'commentary');
    // roles.indexOf('commentary') === -1 ? false : true;
    // Check if we already have commentary roles here

    // Either we have commentary and we DO not want to add main
    // or we have main and DO not want to add commentary, -> this is solved
    modifiedRoles.push('commentary');
  } else {
    // Now lets try to see if the roles we have contain the role main,
    // if not we should add it
    containsNoMainRole =
        !this.stringExistsWithinArray(roles, 'main');
    containsCommentaryRole =
        this.stringExistsWithinArray(roles, 'commentary');

    //containsMainRole = this.stringExistsWithinArray(roles, 'commentary');
    if (containsNoMainRole &&
        !containsCommentaryRole) {
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
shaka.util.MagineStreamUtils.prototype.stringExistsWithinArray =
    function(arr, string) {
  return arr.indexOf(string) === -1 ? false : true;
  // return stringExists;
};


/**
 * A utility method to remove all instances of a
 * peticular element from a string array
 *
 * @param {!Array<string>} arr
 * @param {string} string
 * @return {!Array<string>} newArray
 */
shaka.util.MagineStreamUtils.prototype.arrayItemRemover =
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
