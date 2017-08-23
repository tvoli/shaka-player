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

describe('MagineUtils', function() {
  var MagineUtils;

  beforeAll(function() {
    MagineUtils = shaka.util.MagineUtils;
  });

  describe('arrayItemRemover', function() {
    it('will remove all elements that is 2', function() {
      var arr = [1, 2, 2, 5, 6, 3, 1, 2];
      expect(MagineUtils.arrayItemRemover(arr, 2)).toEqual([1, 5, 6, 3]);
    });
  });
});
