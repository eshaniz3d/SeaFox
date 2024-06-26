/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:expandtab:shiftwidth=2:tabstop=2:
 */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ia2AccessibleAction.h"

#include "AccessibleAction_i.c"

#include "AccessibleWrap.h"
#include "IUnknownImpl.h"
#include "MsaaAccessible.h"

using namespace mozilla::a11y;

Accessible* ia2AccessibleAction::Acc() {
  return static_cast<MsaaAccessible*>(this)->Acc();
}

// IUnknown

STDMETHODIMP
ia2AccessibleAction::QueryInterface(REFIID iid, void** ppv) {
  if (!ppv) return E_INVALIDARG;

  *ppv = nullptr;

  if (IID_IAccessibleAction == iid) {
    *ppv = static_cast<IAccessibleAction*>(this);
    (reinterpret_cast<IUnknown*>(*ppv))->AddRef();
    return S_OK;
  }

  return E_NOINTERFACE;
}

// IAccessibleAction

STDMETHODIMP
ia2AccessibleAction::nActions(long* aActionCount) {
  if (!aActionCount) return E_INVALIDARG;

  *aActionCount = 0;

  Accessible* acc = Acc();
  if (!acc) return CO_E_OBJNOTCONNECTED;

  *aActionCount = acc->ActionCount();
  return S_OK;
}

STDMETHODIMP
ia2AccessibleAction::doAction(long aActionIndex) {
  Accessible* acc = Acc();
  if (!acc) return CO_E_OBJNOTCONNECTED;

  uint8_t index = static_cast<uint8_t>(aActionIndex);
  return acc->DoAction(index) ? S_OK : E_INVALIDARG;
}

STDMETHODIMP
ia2AccessibleAction::get_description(long aActionIndex, BSTR* aDescription) {
  if (!aDescription) return E_INVALIDARG;
  *aDescription = nullptr;

  Accessible* acc = Acc();
  if (!acc) return CO_E_OBJNOTCONNECTED;

  nsAutoString description;
  uint8_t index = static_cast<uint8_t>(aActionIndex);
  acc->ActionDescriptionAt(index, description);
  if (description.IsEmpty()) return S_FALSE;

  *aDescription = ::SysAllocStringLen(description.get(), description.Length());
  return *aDescription ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP
ia2AccessibleAction::get_keyBinding(long aActionIndex, long aNumMaxBinding,
                                    BSTR** aKeyBinding, long* aNumBinding) {
  if (!aKeyBinding) return E_INVALIDARG;
  *aKeyBinding = nullptr;

  if (!aNumBinding) return E_INVALIDARG;
  *aNumBinding = 0;

  if (aActionIndex != 0 || aNumMaxBinding < 1) return E_INVALIDARG;

  Accessible* acc = Acc();
  if (!acc) return CO_E_OBJNOTCONNECTED;

  // Expose KeyboardShortcut if it's not exposed via MSAA accKeyboardShortcut.
  LocalAccessible* localAcc = acc->AsLocal();
  if (!localAcc) {
    // RemoteAccessibles can't have a KeyboardShortcut.
    return S_FALSE;
  }

  KeyBinding keyBinding = acc->AccessKey();
  if (keyBinding.IsEmpty()) {
    // In this case, KeyboardShortcut will be exposed via MSAA
    // accKeyboardShortcut.
    return S_FALSE;
  }

  // MSAA accKeyboardShortcut will expose AccessKey.
  keyBinding = localAcc->KeyboardShortcut();
  if (keyBinding.IsEmpty()) return S_FALSE;

  nsAutoString keyStr;
  keyBinding.ToString(keyStr);

  *aKeyBinding = static_cast<BSTR*>(::CoTaskMemAlloc(sizeof(BSTR*)));
  if (!*aKeyBinding) return E_OUTOFMEMORY;

  *(aKeyBinding[0]) = ::SysAllocStringLen(keyStr.get(), keyStr.Length());
  if (!*(aKeyBinding[0])) {
    ::CoTaskMemFree(*aKeyBinding);
    return E_OUTOFMEMORY;
  }

  *aNumBinding = 1;
  return S_OK;
}

STDMETHODIMP
ia2AccessibleAction::get_name(long aActionIndex, BSTR* aName) {
  if (!aName) return E_INVALIDARG;

  *aName = nullptr;

  Accessible* acc = Acc();
  if (!acc) return CO_E_OBJNOTCONNECTED;

  nsAutoString name;
  uint8_t index = static_cast<uint8_t>(aActionIndex);
  acc->ActionNameAt(index, name);
  if (name.IsEmpty()) return E_INVALIDARG;

  *aName = ::SysAllocStringLen(name.get(), name.Length());
  return *aName ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP
ia2AccessibleAction::get_localizedName(long aActionIndex,
                                       BSTR* aLocalizedName) {
  if (!aLocalizedName) return E_INVALIDARG;

  *aLocalizedName = nullptr;
  return E_NOTIMPL;
}
