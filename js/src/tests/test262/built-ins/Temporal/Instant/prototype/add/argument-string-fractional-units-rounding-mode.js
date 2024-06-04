// |reftest| skip-if(!this.hasOwnProperty('Temporal')) -- Temporal is not enabled unconditionally
// Copyright (C) 2022 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.instant.prototype.add
description: Strings with fractional duration units are rounded with the correct rounding mode
features: [Temporal]
---*/

const epoch = new Temporal.Instant(0n);

assert.sameValue(epoch.add("PT1.03125H").epochNanoseconds, 3712_500_000_000n,
  "positive fractional units rounded with correct rounding mode");
assert.sameValue(epoch.add("-PT1.03125H").epochNanoseconds, -3712_500_000_000n,
  "negative fractional units rounded with correct rounding mode");

reportCompare(0, 0);