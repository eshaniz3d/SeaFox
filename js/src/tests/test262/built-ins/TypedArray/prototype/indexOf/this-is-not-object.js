// |reftest| shell-option(--enable-float16array)
// Copyright (C) 2016 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-%typedarray%.prototype.indexof
description: Throws a TypeError exception when `this` is not Object
info: |
  22.2.3.13 %TypedArray%.prototype.indexOf (searchElement [ , fromIndex ] )

  This function is not generic. ValidateTypedArray is applied to the this value
  prior to evaluating the algorithm. If its result is an abrupt completion that
  exception is thrown instead of evaluating the algorithm.

  22.2.3.5.1 Runtime Semantics: ValidateTypedArray ( O )

  1. If Type(O) is not Object, throw a TypeError exception.
  ...
includes: [testTypedArray.js]
features: [Symbol, TypedArray]
---*/

var indexOf = TypedArray.prototype.indexOf;

assert.throws(TypeError, function() {
  indexOf.call(undefined, 42);
}, "this is undefined");

assert.throws(TypeError, function() {
  indexOf.call(null, 42);
}, "this is null");

assert.throws(TypeError, function() {
  indexOf.call(42, 42);
}, "this is 42");

assert.throws(TypeError, function() {
  indexOf.call("1", 42);
}, "this is a string");

assert.throws(TypeError, function() {
  indexOf.call(true, 42);
}, "this is true");

assert.throws(TypeError, function() {
  indexOf.call(false, 42);
}, "this is false");

var s = Symbol("s");
assert.throws(TypeError, function() {
  indexOf.call(s, 42);
}, "this is a Symbol");

reportCompare(0, 0);
