function ATtinyX41UploadFirmware(handle, srec) {
  var onError = function(message) {
    console.error(message);
    return showError(message);
  };
  ATtinyX41ProgrammingEnableAtHighestSpeed(handle, 7, /* onSuccess */ function() {
    console.log("Ready to program.");
  }, /* onSyncError */ function() {
    return onError("Failed to sync with the device.");
  }, /* onUsbError */ onError);
}

function ATtinyX41PulseResetPin(handle, pin, pulseValue, lengthMs, onSuccess, onUsbError) {
  pulseValue = pulseValue ? 1 : 0;
  SetGPIOModeAndLevel(handle, pin, CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT, pulseValue, function() {
    if (chrome.runtime.lastError !== undefined) {
      return onUsbError(chrome.runtime.lastError.message);
    }
    setTimeout(function() {
      SetGPIOModeAndLevel(handle, pin, CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT, 1 - pulseValue, function() {
        if (chrome.runtime.lastError !== undefined) {
          return onUsbError(chrome.runtime.lastError.message);
        }
        return onSuccess();
      });
    }, lengthMs);
  });
}

function ATtinyX41ProgrammingEnable(handle, onSuccess, onSyncError, onUsbError) {
  // Send 'Programming Enable'.
  SPIWriteRead(handle, new Uint8Array([0xAC, 0x53, 0x00, 0x00]), function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      return onUsbError(chrome.runtime.lastError.message);
    }

    var response = new Uint8Array(transferResult.data);
    if (response.length != 4) {
      return onUsbError('SPIWriteRead(Programming Enable) error: unexpected response length: ' + response.length);
    }

    // ATtinyX41 responds with the second transmitted byte (0x53) repeated in
    // the third byte of the response on successful sync.
    if (response[2] != 0x53) {
      return onSyncError();
    }

    return onSuccess();
  });
}

function ATtinyX41ProgrammingEnableAtHighestSpeed(handle, nResetPin, onSuccess, onSyncError, onUsbError) {
  // SPI clock frequency:
  // freq = 12 MHz / 2^x, where x is 0..7
  //
  // Since the search space is rather small we can do a naive linear search
  // from the highest frequency towards the lowest.

  var TryFrequency = function(freqValue) {
    if (freqValue < 0 || freqValue > 7) {
      return onSyncError();
    }

    ATtinyX41PulseResetPin(handle, nResetPin, 1, 1, function() {
      // Wait 20ms before proceeding after RESET.
      setTimeout(function() {
        SetSPIWord(handle, 0, freqValue, function() {
          ATtinyX41ProgrammingEnable(handle, /* onSuccess */ function() {
            console.log("ATtinyX41: Successfully enabled programming @", 12000 / Math.pow(2, freqValue), "kHz");
            return onSuccess();
          }, /* onSyncError */ function() {
            TryFrequency(freqValue + 1);
          }, onUsbError);
        });
      }, 20);
    }, onUsbError);
  };

  TryFrequency(0);
}
