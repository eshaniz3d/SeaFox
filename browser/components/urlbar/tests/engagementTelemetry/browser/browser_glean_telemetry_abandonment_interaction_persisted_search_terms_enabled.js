/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Test abandonment telemetry with persisted search terms enabled.

// Allow more time for Mac machines so they don't time out in verify mode.
if (AppConstants.platform == "macosx") {
  requestLongerTimeout(3);
}

add_setup(async function () {
  await initInteractionTest();

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.urlbar.showSearchTerms.featureGate", true],
      ["browser.urlbar.showSearchTerms.enabled", true],
      ["browser.search.widget.inNavBar", false],
    ],
  });
});

add_task(async function persisted_search_terms() {
  await doPersistedSearchTermsTest({
    trigger: () => doBlur(),
    assert: () =>
      assertAbandonmentTelemetry([{ interaction: "persisted_search_terms" }]),
  });
});

add_task(async function persisted_search_terms_restarted_refined() {
  await doPersistedSearchTermsRestartedRefinedTest({
    enabled: true,
    trigger: () => doBlur(),
    assert: expected => assertAbandonmentTelemetry([{ interaction: expected }]),
  });
});

add_task(
  async function persisted_search_terms_restarted_refined_via_abandonment() {
    await doPersistedSearchTermsRestartedRefinedViaAbandonmentTest({
      enabled: true,
      trigger: () => doBlur(),
      assert: expected =>
        assertAbandonmentTelemetry([
          { interaction: "persisted_search_terms_restarted" },
          { interaction: expected },
        ]),
    });
  }
);
