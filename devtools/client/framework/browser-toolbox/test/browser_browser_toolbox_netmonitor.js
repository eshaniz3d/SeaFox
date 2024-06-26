/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* global gToolbox */

add_task(async function () {
  // Disable several prefs to avoid network requests.
  await pushPref("browser.safebrowsing.blockedURIs.enabled", false);
  await pushPref("browser.safebrowsing.downloads.enabled", false);
  await pushPref("browser.safebrowsing.malware.enabled", false);
  await pushPref("browser.safebrowsing.phishing.enabled", false);
  await pushPref("privacy.query_stripping.enabled", false);
  await pushPref("extensions.systemAddon.update.enabled", false);

  await pushPref("services.settings.server", "invalid://err");

  // Define a set list of visible columns
  await pushPref(
    "devtools.netmonitor.visibleColumns",
    JSON.stringify(["file", "url", "status"])
  );

  // Force observice all processes to see the content process requests
  await pushPref("devtools.browsertoolbox.scope", "everything");

  const ToolboxTask = await initBrowserToolboxTask();

  await ToolboxTask.importFunctions({
    waitUntil,
    waitForDOM,
  });

  await ToolboxTask.spawn(null, async () => {
    const { resourceCommand } = gToolbox.commands;

    // Assert that the toolbox is not listening to network events
    // before the netmonitor panel is opened.
    is(
      resourceCommand.isResourceWatched(resourceCommand.TYPES.NETWORK_EVENT),
      false,
      "The toolox is not watching for network event resources"
    );

    await gToolbox.selectTool("netmonitor");
    const monitor = gToolbox.getCurrentPanel();
    const { document, store, windowRequire } = monitor.panelWin;

    const Actions = windowRequire(
      "devtools/client/netmonitor/src/actions/index"
    );

    store.dispatch(Actions.batchEnable(false));

    await waitUntil(
      () => !!document.querySelector(".request-list-empty-notice")
    );

    is(
      resourceCommand.isResourceWatched(resourceCommand.TYPES.NETWORK_EVENT),
      true,
      "The network panel is now watching for network event resources"
    );

    const emptyListNotice = document.querySelector(
      ".request-list-empty-notice"
    );

    ok(
      !!emptyListNotice,
      "An empty notice should be displayed when the frontend is opened."
    );

    is(
      emptyListNotice.innerText,
      "Perform a request to see detailed information about network activity.",
      "The reload and perfomance analysis details should not be visible in the browser toolbox"
    );

    is(
      store.getState().requests.requests.length,
      0,
      "The requests should be empty when the frontend is opened."
    );

    ok(
      !document.querySelector(".requests-list-network-summary-button"),
      "The perfomance analysis button should not be visible in the browser toolbox"
    );
  });

  info("Trigger request in parent process and check that it shows up");
  await fetch("https://example.org/document-builder.sjs?html=fromParent");

  await ToolboxTask.spawn(null, async () => {
    const monitor = gToolbox.getCurrentPanel();
    const { document, store, windowRequire } = monitor.panelWin;
    const Actions = windowRequire(
      "devtools/client/netmonitor/src/actions/index"
    );

    await waitUntil(
      () => !document.querySelector(".request-list-empty-notice")
    );
    ok(true, "The empty notice is no longer displayed");
    is(
      store.getState().requests.requests.length,
      1,
      "There's 1 request in the store"
    );

    const requests = Array.from(
      document.querySelectorAll("tbody .requests-list-column.requests-list-url")
    );
    is(requests.length, 1, "One request displayed");
    const requestUrl =
      "https://example.org/document-builder.sjs?html=fromParent";
    is(requests[0].textContent, requestUrl, "Expected request is displayed");

    const waitForHeaders = waitForDOM(document, ".headers-overview");
    store.dispatch(Actions.toggleNetworkDetails());
    await waitForHeaders;

    const tabpanel = document.querySelector("#headers-panel");
    is(
      tabpanel.querySelector(".url-preview .url").innerText,
      requestUrl,
      "The url summary value is incorrect."
    );
  });

  info("Trigger content process requests");
  const urlImg = `${URL_ROOT_SSL}test-image.png?fromContent&${Date.now()}-${Math.random()}`;
  await addTab(
    `https://example.com/document-builder.sjs?html=${encodeURIComponent(
      `<img src='${urlImg}'>`
    )}`
  );

  await ToolboxTask.spawn(urlImg, async innerUrlImg => {
    const monitor = gToolbox.getCurrentPanel();
    const { document, store } = monitor.panelWin;

    // Note that we may have lots of other requests relates to browser activity,
    // like file:// requests for many internal UI ressources.
    await waitUntil(() => store.getState().requests.requests.length >= 3);
    ok(true, "Expected content requests are displayed");

    async function waitForRequest(url, requestName) {
      info(`Wait for ${requestName} request`);
      await waitUntil(() => {
        const requests = Array.from(
          document.querySelectorAll(
            "tbody .requests-list-column.requests-list-url"
          )
        );
        return requests.some(r => r.textContent.includes(url));
      });
      info(`Got ${requestName} request`);
    }
    await waitForRequest("https://example.com/document-builder.sjs", "tab");
    await waitForRequest(innerUrlImg, "image in tab");
  });
});
