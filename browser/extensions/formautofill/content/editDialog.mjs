/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-disable mozilla/balanced-listeners */ // Not relevant since the document gets unloaded.

import {
  getCurrentFormData,
  canSubmitForm,
} from "chrome://formautofill/content/addressFormLayout.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AutofillTelemetry: "resource://gre/modules/shared/AutofillTelemetry.sys.mjs",
  formAutofillStorage: "resource://autofill/FormAutofillStorage.sys.mjs",
});

class AutofillEditDialog {
  constructor(subStorageName, elements, record) {
    this._storageInitPromise = lazy.formAutofillStorage.initialize();
    this._subStorageName = subStorageName;
    this._elements = elements;
    this._record = record;
    this.localizeDocument();
    window.addEventListener("load", this, { once: true });
  }

  async init() {
    this.updateSaveButtonState();
    this.attachEventListeners();
    // For testing only: signal to tests that the dialog is ready for testing.
    // This is likely no longer needed since retrieving from storage is fully
    // handled in manageDialog.js now.
    window.dispatchEvent(new CustomEvent("FormReadyForTests"));
  }

  /**
   * Get storage and ensure it has been initialized.
   *
   * @returns {object}
   */
  async getStorage() {
    await this._storageInitPromise;
    return lazy.formAutofillStorage[this._subStorageName];
  }

  /**
   * Asks FormAutofillParent to save or update an record.
   *
   * @param  {object} record
   * @param  {string} guid [optional]
   */
  async saveRecord(record, guid) {
    let storage = await this.getStorage();
    if (guid) {
      await storage.update(guid, record);
    } else {
      await storage.add(record);
    }
  }

  /**
   * Handle events
   *
   * @param  {DOMEvent} event
   */
  handleEvent(event) {
    switch (event.type) {
      case "load": {
        this.init();
        break;
      }
      case "click": {
        this.handleClick(event);
        break;
      }
      case "input": {
        this.handleInput(event);
        break;
      }
      case "keypress": {
        this.handleKeyPress(event);
        break;
      }
      case "contextmenu": {
        if (
          !HTMLInputElement.isInstance(event.target) &&
          !HTMLTextAreaElement.isInstance(event.target)
        ) {
          event.preventDefault();
        }
        break;
      }
    }
  }

  /**
   * Handle click events
   *
   * @param  {DOMEvent} event
   */
  handleClick(event) {
    if (event.target == this._elements.cancel) {
      window.close();
    }
    if (event.target == this._elements.save) {
      this.handleSubmit();
    }
  }

  /**
   * Handle input events
   */
  handleInput(_e) {
    this.updateSaveButtonState();
  }

  /**
   * Handle key press events
   *
   * @param  {DOMEvent} event
   */
  handleKeyPress(event) {
    if (event.keyCode == KeyEvent.DOM_VK_ESCAPE) {
      window.close();
    }
  }

  updateSaveButtonState() {
    // Toggle disabled attribute on the save button based on
    // whether the form is filled or empty.
    if (!Object.keys(this._elements.fieldContainer.buildFormObject()).length) {
      this._elements.save.setAttribute("disabled", true);
    } else {
      this._elements.save.removeAttribute("disabled");
    }
  }

  /**
   * Attach event listener
   */
  attachEventListeners() {
    window.addEventListener("keypress", this);
    window.addEventListener("contextmenu", this);
    this._elements.save.addEventListener("click", this);
    this._elements.cancel.addEventListener("click", this);
    document.addEventListener("input", this);
  }

  // An interface to be inherited.
  localizeDocument() {}

  recordFormSubmit() {
    let method = this._record?.guid ? "edit" : "add";
    lazy.AutofillTelemetry.recordManageEvent(this.telemetryType, method);
  }
}

export class EditAddressDialog extends AutofillEditDialog {
  telemetryType = lazy.AutofillTelemetry.ADDRESS;

  constructor(elements, record) {
    super("addresses", elements, record);
    if (record) {
      lazy.AutofillTelemetry.recordManageEvent(
        this.telemetryType,
        "show_entry"
      );
    }
  }

  localizeDocument() {
    if (this._record?.guid) {
      document.l10n.setAttributes(
        this._elements.title,
        "autofill-edit-address-title"
      );
    }
  }

  updateSaveButtonState() {
    // Toggle disabled attribute on the save button based on
    // whether the form is filled or empty.
    if (!canSubmitForm()) {
      this._elements.save.setAttribute("disabled", true);
    } else {
      this._elements.save.removeAttribute("disabled");
    }
  }

  async handleSubmit() {
    await this.saveRecord(
      getCurrentFormData(),
      this._record ? this._record.guid : null
    );
    this.recordFormSubmit();

    window.close();
  }
}

export class EditCreditCardDialog extends AutofillEditDialog {
  telemetryType = lazy.AutofillTelemetry.CREDIT_CARD;

  constructor(elements, record) {
    elements.fieldContainer._elements.billingAddress.disabled = true;
    super("creditCards", elements, record);
    elements.fieldContainer._elements.ccNumber.addEventListener(
      "blur",
      this._onCCNumberFieldBlur.bind(this)
    );
    if (record) {
      lazy.AutofillTelemetry.recordManageEvent(
        this.telemetryType,
        "show_entry"
      );
    }
  }

  _onCCNumberFieldBlur() {
    let elem = this._elements.fieldContainer._elements.ccNumber;
    this._elements.fieldContainer.updateCustomValidity(elem);
  }

  localizeDocument() {
    if (this._record?.guid) {
      document.l10n.setAttributes(
        this._elements.title,
        "autofill-edit-card-title2"
      );
    }
  }

  async handleSubmit() {
    let creditCard = this._elements.fieldContainer.buildFormObject();
    if (!this._elements.fieldContainer._elements.form.reportValidity()) {
      return;
    }

    try {
      await this.saveRecord(
        creditCard,
        this._record ? this._record.guid : null
      );

      this.recordFormSubmit();

      window.close();
    } catch (ex) {
      console.error(ex);
    }
  }
}
