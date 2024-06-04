// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-setintegritylevel
description: >
    Object.seal - 'P' is own property of an Arguments object which
    implements its own [[GetOwnProperty]]
includes: [propertyHelper.js]
---*/

var obj = (function() {
  return arguments;
})();

obj.foo = 10;

assert(Object.isExtensible(obj));
Object.seal(obj);

verifyProperty(obj, "foo", {
  value: 10,
  configurable: false,
});

reportCompare(0, 0);