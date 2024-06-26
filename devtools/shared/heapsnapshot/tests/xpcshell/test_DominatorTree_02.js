/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";

// Test that we can compute dominator trees from a snapshot in a worker.

add_task(async function () {
  const worker = new ChromeWorker("resource://test/dominator-tree-worker.js");
  worker.postMessage({});

  let assertionCount = 0;
  worker.onmessage = e => {
    if (e.data.type !== "assertion") {
      return;
    }

    ok(e.data.passed, e.data.msg + "\n" + e.data.stack);
    assertionCount++;
  };

  await waitForDone(worker);

  Assert.greater(assertionCount, 0);
  worker.terminate();
});

function waitForDone(w) {
  return new Promise((resolve, reject) => {
    w.onerror = e => {
      reject();
      ok(false, "Error in worker: " + e);
    };

    w.addEventListener("message", function listener(e) {
      if (e.data.type === "done") {
        w.removeEventListener("message", listener);
        resolve();
      }
    });
  });
}
