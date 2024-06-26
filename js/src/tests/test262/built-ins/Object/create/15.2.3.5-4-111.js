// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es5id: 15.2.3.5-4-111
description: >
    Object.create - 'configurable' property of one property in
    'Properties' is an inherited accessor property without a get
    function (8.10.5 step 4.a)
includes: [propertyHelper.js]
---*/

var proto = {};

Object.defineProperty(proto, "configurable", {
  set: function() {}
});

var ConstructFun = function() {};
ConstructFun.prototype = proto;
var descObj = new ConstructFun();

var newObj = Object.create({}, {
  prop: descObj
});

verifyProperty(newObj, "prop", {
  configurable: false,
});

reportCompare(0, 0);
