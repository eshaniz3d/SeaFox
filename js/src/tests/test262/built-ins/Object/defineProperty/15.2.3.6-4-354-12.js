// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es5id: 15.2.3.6-4-354-12
description: >
    Object.defineProperty will update [[Value]] attribute of indexed
    property successfully when [[Configurable]] attribute is true and
    [[Writable]] attribute is false, 'O' is an Arguments object
    (8.12.9 - step Note)
includes: [propertyHelper.js]
---*/


var obj = (function() {
  return arguments;
}());

Object.defineProperty(obj, "0", {
  value: 1001,
  writable: false,
  configurable: true
});

Object.defineProperty(obj, "0", {
  value: 1002
});

verifyProperty(obj, "0", {
  value: 1002,
  writable: false,
  enumerable: false,
  configurable: true,
});

reportCompare(0, 0);
