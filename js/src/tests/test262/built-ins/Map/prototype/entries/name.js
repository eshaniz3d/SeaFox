// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-map.prototype.entries
description: >
  Map.prototype.entries.name value and descriptor.
info: |
  Map.prototype.entries ( )

  17 ECMAScript Standard Built-in Objects

includes: [propertyHelper.js]
---*/

verifyProperty(Map.prototype.entries, "name", {
  value: "entries",
  writable: false,
  enumerable: false,
  configurable: true
});

reportCompare(0, 0);
