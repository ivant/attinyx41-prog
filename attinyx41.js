"use strict";

function ATtinyX41UploadFirmware(handle, srec) {
  var onError = function(message) {
    console.error(message);
    return showError(message);
  };

  if (!IsValidSREC(srec)) {
    return onError("ATtinyX41UploadFirmware: Invalid SREC.");
  }

  ATtinyX41ProgrammingEnableAtHighestSpeed(handle, 7, /* onSuccess */ function() {
    console.log("Ready to program.");
  }, /* onSyncError */ function() {
    return onError("Failed to sync with the device.");
  }, /* onUsbError */ onError);
}

// Page size: 8 words (16 bytes).
// Number of pages: 256 (ATtiny441) / 512 (ATtiny841).
//
// Disallows records starting at odd offsets or having odd lengths.
//
// Since SREC is recorded in terms of bytes, and ATtiny assembly is word-based,
// we need to know whether SREC is recorded in little-endian or big-endian
// fashion.
//
// Returns: [{
//   pageWordAddress: <uint16>,
//   data: [{
//     wordOffsetInPage: <uint8>,
//     value: <uint16>
//   }]
// }]
function ATtinyX41SplitSRECIntoPages(srec, bigEndian) {
  var pageSizeInWords = 8;
  var wordSize = 2;
  var pageSizeInBytes = pageSizeInWords * wordSize;

  var msbOffset = (bigEndian ? 0 : 1);
  var ReadWordAt = function (arr, byteOffset) {
    return (arr[byteOffset + msbOffset] << 8) + arr[byteOffset + (1 - msbOffset)];
  };

  var pages = [];
  var pageByteAddress = 0;
  var pageData = [];

  var FlushPage = function() {
    if (pageData.length > 0) {
      pages.push({
        pageWordAddress: pageByteAddress / wordSize,
        data: pageData
      });
      pageData = [];
    }
  }

  for (let record of srec['records']) {
    let address = record['address']; 
    let bytes = record['bytes']; 
    if ((address & 1) || (bytes.length & 1)) {
      console.error("ATtinyX41: records at odd offsets or having odd lengths are not supported.");
      return undefined;
    }
    let offset = 0;
    while (offset < bytes.length) {
      let byteOffsetInPage = (address + offset) % pageSizeInBytes;
      if ((address + offset) >= pageByteAddress + pageSizeInBytes) {
        FlushPage();
        pageByteAddress = (address + offset) - byteOffsetInPage;
      }
      pageData.push({
        wordOffsetInPage: byteOffsetInPage / wordSize,
        value: ReadWordAt(bytes, offset)
      });
      offset += 2;
    }
  }
  FlushPage();
  return pages;
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
