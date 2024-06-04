/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file exists so that LaunchModernSettingsDialogDefaultApps can be called
 * without linking to libxul.
 */
#include "Windows11LimitedAccessFeatures.h"

#include "mozilla/Logging.h"

static mozilla::LazyLogModule sLog("Windows11LimitedAccessFeatures");

#define LAF_LOG(level, msg, ...) MOZ_LOG(sLog, level, (msg, ##__VA_ARGS__))

// MINGW32 is not supported for these features
// Fall back function defined in the #else
#ifndef __MINGW32__

#  include "nsString.h"
#  include "nsWindowsHelpers.h"

#  include "mozilla/Atomics.h"

#  include <wrl.h>
#  include <inspectable.h>
#  include <roapi.h>
#  include <windows.services.store.h>
#  include <windows.foundation.h>

using namespace Microsoft::WRL;
using namespace Microsoft::WRL::Wrappers;
using namespace ABI::Windows;
using namespace ABI::Windows::Foundation;
using namespace ABI::Windows::ApplicationModel;

using namespace mozilla;

/**
 * To unlock features, we need:
 * a feature identifier
 * a token,
 * an attestation string
 * a token
 *
 * The token is generated by Microsoft and must
 * match the publisher id Microsoft thinks we have, for a particular
 * feature.
 *
 * To get a token, find the right microsoft email address by doing
 * a search on the web for the feature you want unlocked and reach
 * out to the right people at Microsoft.
 *
 * The token is generated from Microsoft.
 * The jumbled code in the attestation string is a publisher id and
 * must match the code in the resources / .rc file for the identity,
 * looking like this for non-MSIX builds:
 *
 * Identity LimitedAccessFeature {{ L"MozillaFirefox_pcsmm0jrprpb2" }}
 *
 * Broken down:
 * Identity LimitedAccessFeature {{ L"PRODUCTNAME_PUBLISHERID" }}
 *
 * That is injected into our build in create_rc.py and is necessary
 * to unlock the taskbar pinning feature / APIs from an unpackaged
 * build.
 *
 * In the above, the token is generated from the publisher id (pcsmm0jrprpb2)
 * and the product name (MozillaFirefox)
 *
 * All tokens listed here were provided to us by Microsoft.
 *
 * Below and in create_rc.py, we used this set:
 *
 * Token: "kRFiWpEK5uS6PMJZKmR7MQ=="
 * Product Name: "MozillaFirefox"
 * Publisher ID: "pcsmm0jrprpb2"
 *
 * Microsoft also provided these other tokens, which will will
 * work if accompanied by the matching changes to create_rc.py:

 * -----
 * Token: "RGEhsYgKhmPLKyzkEHnMhQ=="
 * Product Name: "FirefoxBeta"
 * Publisher ID: "pcsmm0jrprpb2"
 *
 * -----
 *
 * Token: "qbVzns/9kT+t15YbIwT4Jw=="
 * Product Name: "FirefoxNightly"
 * Publisher ID: "pcsmm0jrprpb2"
 *
 * To use those instead, you have to ensure that the LimitedAccessFeature
 * generated in create_rc.py has the product name and publisher id
 * matching the token used in this file.
 *
 * For non-packaged (non-MSIX) builds, any of the above sets will work.
 * Just make sure the right (ProductName_PublisherID) value is in the
 * generated resource data for the executable, and the matching
* (Token) and attestation string
 *
 * To get MSIX/packaged builds to work, the product name and publisher in
 * the final manifest (searchfox.org/mozilla-central/search?q=APPX_PUBLISHER)
 * should match the token in this file. For that case, the identity value
 * in the resources does not matter.
 *
 * See here for Microsoft examples:
https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/TaskbarManager/CppUnpackagedDesktopTaskbarPin
 */

struct LimitedAccessFeatureInfo {
  const char* debugName;
  const WCHAR* feature;
  const WCHAR* token;
  const WCHAR* attestation;
};

static LimitedAccessFeatureInfo limitedAccessFeatureInfo[] = {
    {// Win11LimitedAccessFeatureType::Taskbar
     "Win11LimitedAccessFeatureType::Taskbar",
     L"com.microsoft.windows.taskbar.pin", L"kRFiWpEK5uS6PMJZKmR7MQ==",
     L"pcsmm0jrprpb2 has registered their use of "
     L"com.microsoft.windows.taskbar.pin with Microsoft and agrees to the "
     L"terms "
     L"of use."}};

static_assert(mozilla::ArrayLength(limitedAccessFeatureInfo) ==
              kWin11LimitedAccessFeatureTypeCount);

/**
 Implementation of the Win11LimitedAccessFeaturesInterface.
 */
class Win11LimitedAccessFeatures : public Win11LimitedAccessFeaturesInterface {
 public:
  using AtomicState = Atomic<int, SequentiallyConsistent>;

  Result<bool, HRESULT> Unlock(Win11LimitedAccessFeatureType feature) override;

 private:
  AtomicState& GetState(Win11LimitedAccessFeatureType feature);
  Result<bool, HRESULT> UnlockImplementation(
      Win11LimitedAccessFeatureType feature);

  /**
   * Store the state as an atomic so that it can be safely accessed from
   * different threads.
   */
  static AtomicState mTaskbarState;
  static AtomicState mDefaultState;

  enum State {
    Uninitialized,
    Locked,
    Unlocked,
  };
};

Win11LimitedAccessFeatures::AtomicState
    Win11LimitedAccessFeatures::mTaskbarState(
        Win11LimitedAccessFeatures::Uninitialized);
Win11LimitedAccessFeatures::AtomicState
    Win11LimitedAccessFeatures::mDefaultState(
        Win11LimitedAccessFeatures::Uninitialized);

RefPtr<Win11LimitedAccessFeaturesInterface>
CreateWin11LimitedAccessFeaturesInterface() {
  RefPtr<Win11LimitedAccessFeaturesInterface> result(
      new Win11LimitedAccessFeatures());
  return result;
}

Result<bool, HRESULT> Win11LimitedAccessFeatures::Unlock(
    Win11LimitedAccessFeatureType feature) {
  AtomicState& atomicState = GetState(feature);

  const auto& lafInfo = limitedAccessFeatureInfo[static_cast<int>(feature)];

  LAF_LOG(
      LogLevel::Debug, "Limited Access Feature Info for %s. Feature %S, %S, %S",
      lafInfo.debugName, lafInfo.feature, lafInfo.token, lafInfo.attestation);

  int state = atomicState;
  if (state != Uninitialized) {
    LAF_LOG(LogLevel::Debug, "%s already initialized! State = %s",
            lafInfo.debugName, (state == Unlocked) ? "true" : "false");
    return (state == Unlocked);
  }

  // If multiple threads read the state at the same time, and it's unitialized,
  // both threads will unlock the feature. This situation is unlikely, but even
  // if it happens, it's not a problem.

  auto result = UnlockImplementation(feature);

  int newState = Locked;
  if (!result.isErr() && result.unwrap()) {
    newState = Unlocked;
  }

  atomicState = newState;

  return result;
}

Win11LimitedAccessFeatures::AtomicState& Win11LimitedAccessFeatures::GetState(
    Win11LimitedAccessFeatureType feature) {
  switch (feature) {
    case Win11LimitedAccessFeatureType::Taskbar:
      return mTaskbarState;

    default:
      LAF_LOG(LogLevel::Debug, "Missing feature type for %d",
              static_cast<int>(feature));
      MOZ_ASSERT(false,
                 "Unhandled feature type! Add a new atomic state variable, add "
                 "that entry to the switch statement above, and add the proper "
                 "entries for the feature and the token.");
      return mDefaultState;
  }
}

Result<bool, HRESULT> Win11LimitedAccessFeatures::UnlockImplementation(
    Win11LimitedAccessFeatureType feature) {
  ComPtr<ILimitedAccessFeaturesStatics> limitedAccessFeatures;
  ComPtr<ILimitedAccessFeatureRequestResult> limitedAccessFeaturesResult;

  const auto& lafInfo = limitedAccessFeatureInfo[static_cast<int>(feature)];

  HRESULT hr = RoGetActivationFactory(
      HStringReference(
          RuntimeClass_Windows_ApplicationModel_LimitedAccessFeatures)
          .Get(),
      IID_ILimitedAccessFeaturesStatics, &limitedAccessFeatures);

  if (!SUCCEEDED(hr)) {
    LAF_LOG(LogLevel::Debug, "%s activation error. HRESULT = 0x%lx",
            lafInfo.debugName, hr);
    return Err(hr);
  }

  hr = limitedAccessFeatures->TryUnlockFeature(
      HStringReference(lafInfo.feature).Get(),
      HStringReference(lafInfo.token).Get(),
      HStringReference(lafInfo.attestation).Get(),
      &limitedAccessFeaturesResult);
  if (!SUCCEEDED(hr)) {
    LAF_LOG(LogLevel::Debug, "%s unlock error. HRESULT = 0x%lx",
            lafInfo.debugName, hr);
    return Err(hr);
  }

  LimitedAccessFeatureStatus status;
  hr = limitedAccessFeaturesResult->get_Status(&status);
  if (!SUCCEEDED(hr)) {
    LAF_LOG(LogLevel::Debug, "%s get status error. HRESULT = 0x%lx",
            lafInfo.debugName, hr);
    return Err(hr);
  }

  int state = Unlocked;
  if ((status != LimitedAccessFeatureStatus_Available) &&
      (status != LimitedAccessFeatureStatus_AvailableWithoutToken)) {
    LAF_LOG(LogLevel::Debug, "%s not available. HRESULT = 0x%lx",
            lafInfo.debugName, hr);
    state = Locked;
  }

  return (state == Unlocked);
}

#else  // MINGW32 implementation

RefPtr<Win11LimitedAccessFeaturesInterface>
CreateWin11LimitedAccessFeaturesInterface() {
  RefPtr<Win11LimitedAccessFeaturesInterface> result;
  return result;
}

#endif