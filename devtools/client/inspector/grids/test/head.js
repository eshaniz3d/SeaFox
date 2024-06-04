/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */
/* eslint no-unused-vars: [2, {"vars": "local"}] */

"use strict";

// Import the inspector's head.js first (which itself imports shared-head.js).
Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/devtools/client/inspector/test/head.js",
  this
);

const asyncStorage = require("resource://devtools/shared/async-storage.js");

Services.prefs.setIntPref("devtools.toolbox.footer.height", 350);
registerCleanupFunction(async function () {
  Services.prefs.clearUserPref("devtools.toolbox.footer.height");
  await asyncStorage.removeItem("gridInspectorHostColors");
});

/**
 * Simulate a mouseover event on a grid cell currently rendered in the grid
 * inspector.
 *
 * @param {Document} doc
 *        The owner document for the grid inspector.
 * @param {Number} gridCellIndex
 *        The index (0-based) of the grid cell that should be hovered.
 */
function synthesizeMouseOverOnGridCell(doc, gridCellIndex = 0) {
  // Make sure to retrieve the current live grid item before attempting to
  // interact with it using mouse APIs.
  const gridCell = doc.querySelectorAll("#grid-cell-group rect")[gridCellIndex];

  EventUtils.synthesizeMouseAtCenter(
    gridCell,
    { type: "mouseover" },
    doc.defaultView
  );
}
