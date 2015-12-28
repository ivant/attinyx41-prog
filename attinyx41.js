function ATtinyX41UploadFirmware(handle, srec) {
  var onDone = function() {
    SetGPIOModeAndLevel(handle, 7, CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT, 1, function(transferResult) {
      if (chrome.runtime.lastError !== undefined) {
        showError('SetGPIOValues error: ' + chrome.runtime.lastError.message);
        return;
      }
    });
  };

  // Set the slowest SPI speed: 93.8KHz.
  // TODO: have the code find the highest speed that works.
  SetSPIWord(handle, 0, 3, function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      showError('SetSPIWord error: ' + chrome.runtime.lastError.message);
      return;
    }

    // Pull GPIO.7 (connected to /RESET) low.
    SetGPIOModeAndLevel(handle, 7, CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT, 0, function(transferResult) {
      if (chrome.runtime.lastError !== undefined) {
        showError('SetGPIOValues error: ' + chrome.runtime.lastError.message);
        return;
      }

      // Wait 20ms before proceeding.
      setTimeout(function() {
        // Send 'Programming Enable'.
        SPIWriteRead(handle, new Uint8Array([0xAC, 0x53, 0x00, 0x00]), function(transferResult) {
          if (chrome.runtime.lastError !== undefined) {
            showError('SPIWriteRead(Programming Enable) error: ' + chrome.runtime.lastError.message);
            onDone();
            return;
          }
          var response = new Uint8Array(transferResult.data);
          if (response.length != 4) {
            showError('SPIWriteRead(Programming Enable) error: unexpected response length:', response.length);
            onDone();
            return;
          }
          if (response[2] != 0x53) {
            showError('SPIWriteRead(Programming Enable) error: unexpected response', response);
            onDone();
            return;
          }
          onDone();
        });
      }, 20);
    });
  });
}
