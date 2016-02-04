"use strict";

function ATtinyX41UploadFirmware(handle, srec) {
  function onError(message) {
    console.error(message);
    return showError(message);
  }

  if (!IsValidSREC(srec)) {
    return onError("ATtinyX41UploadFirmware: Invalid SREC.");
  }

  ATtinyX41ProgrammingEnableAtHighestSpeed(handle, 7, /* onSuccess */ function() {
    console.log("Ready to program.");
    let pages = ATtinyX41SplitSRECIntoPages(srec, true /*bigEndian*/);
    ATtinyX41WriteManyPages(handle, pages, function() {
      // Set /RESET to 1.
      SetGPIOModeAndLevel(handle, 7, CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT, 1, function() {
        console.log("Successfully uploaded firmware.");
      }, onError);
    }, onError);
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
  function ReadWordAt(arr, byteOffset) {
    return (arr[byteOffset + msbOffset] << 8) + arr[byteOffset + (1 - msbOffset)];
  }

  var pages = [];
  var pageByteAddress = 0;
  var pageData = [];

  function FlushPage() {
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

function ATtinyX41ProgrammingEnableAtHighestSpeed(handle, nResetPin, onSuccess, onSyncError, onUsbError) {
  // SPI clock frequency:
  // freq = 12 MHz / 2^x, where x is 0..7
  //
  // Since the search space is rather small we can do a naive linear search
  // from the highest frequency towards the lowest.

  function TryFrequency(freqValue) {
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

// Sends commandBytes over SPI, reads the response bytes, calls onSuccess with
// the Uint8Array of the response as argument.
function ATtinyX41SendSerialProgrammingInstruction(handle, commandBytes, onSuccess, onUsbError) {
  SPIWriteRead(handle, new Uint8Array(commandBytes), onSuccess, onUsbError);
}

function ATtinyX41ProgrammingEnable(handle, onSuccess, onSyncError, onUsbError) {
  // Send 'Programming Enable'.
  ATtinyX41SendSerialProgrammingInstruction(handle, [0xAC, 0x53, 0x00, 0x00], function(response) {
    // ATtinyX41 responds with the second transmitted byte (0x53) repeated in
    // the third byte of the response on successful sync.
    if (response[2] != 0x53) {
      return onSyncError();
    }

    return onSuccess();
  }, onUsbError);
}

// Polls for RDY, calls onSuccess with a true in case the result is "ready".
function ATtinyX41PollRDY(handle, onSuccess, onUsbError) {
  // Send 'Poll RDY'.
  ATtinyX41SendSerialProgrammingInstruction(handle, [0xF0, 0x00, 0x00, 0x00], function(response) {
    // LSB is 0 if RDY, 1 otherwise.
    return onSuccess((response[3] & 1) === 0);
  }, onUsbError);
}

// Polls for RDY continuously, calls onReady once RDY is reported.
function ATtinyX41PollUntilRDY(handle, onReady, onUsbError) {
  // Send 'Poll RDY'.
  ATtinyX41PollRDY(handle, function(isReady) {
    if (isReady) return onReady();
    return ATtinyX41PollUntilRDY(handle, onReady, onUsbError);
  }, onUsbError);
}

function ATtinyX41LoadWord(handle, wordAddress, word, onSuccess, onUsbError) {
  let addrLSB = wordAddress & 0x3f;  // bottom 6 bits.
  let high = (word >> 8) & 0xff;
  let low = word & 0xff;
  function loadLow(onLoadSuccess) {
    if (low != 0xff) {
      return ATtinyX41SendSerialProgrammingInstruction(handle, [0x40, 0x00, addrLSB, low], function(response) {
        onLoadSuccess();
      }, onUsbError);
    }
    return onLoadSuccess();
  }

  function loadHigh(onLoadSuccess) {
    if (high != 0xff) {
      return ATtinyX41SendSerialProgrammingInstruction(handle, [0x48, 0x00, addrLSB, high], function(response) {
        onLoadSuccess();
      }, onUsbError);
    }
    return onLoadSuccess();
  }
  return loadLow(function() { return loadHigh(onSuccess); });
}

function ATtinyX41WritePage(handle, pageWordAddress, onSuccess, onUsbError) {
  let addrMSB = (pageWordAddress >> 8) & 0xff;
  let addrLSB = pageWordAddress & 0xff;
  ATtinyX41SendSerialProgrammingInstruction(handle, [0x4C, addrMSB, addrLSB, 0x00], function(response) {
    onSuccess();
  }, onUsbError);
}

function ATtinyX41WriteManyPages(handle, pages, onSuccess, onUsbError) {
  if (pages.length === 0) {
    return ATtinyX41PollUntilRDY(handle, onSuccess, onUsbError);
  }

  function LoadWords(pageWordAddress, words, onSuccess) {
    if (words.length === 0) return onSuccess();
    let word = words[0];
    ATtinyX41LoadWord(handle, pageWordAddress + word.wordOffsetInPage, word.value, function() {
      LoadWords(pageWordAddress, words.slice(1), onSuccess);
    }, onUsbError);
  }

  ATtinyX41PollUntilRDY(handle, function() {
    let page = pages[0];
    LoadWords(page['pageWordAddress'], page['data'], function() {
      ATtinyX41WritePage(handle, page.pageWordAddress, function() {
        console.debug('Wrote page @', page['pageWordAddress']);
        ATtinyX41WriteManyPages(handle, pages.slice(1), onSuccess, onUsbError);
      }, onUsbError);
    });
  }, onUsbError);
}

function ATtinyX41ReadMemoryRange(handle, wordAddress, numWords, onSuccess, onUsbError) {
  let words = [];
  let maxWordsPerRound = 31;

  let readMemoryRangeInternal = function(wordAddress, numWords) {
    if (numWords === 0) return onSuccess(words);

    let numWordsThisRound = Math.min(maxWordsPerRound, numWords);
    let numWordsNextTime = numWords - numWordsThisRound;

    let commands = [];
    for (let offset = 0; offset < numWordsThisRound; ++offset) {
      let addrMSB = ((wordAddress + offset) >> 8) & 0xff;
      let addrLSB = (wordAddress + offset) & 0xff;
      commands.push(
          0x20, addrMSB, addrLSB, 0x00,
          0x28, addrMSB, addrLSB, 0x00);
    }

    return ATtinyX41SendSerialProgrammingInstruction(handle, commands, function(response) {
      for (let i = 0; i < numWordsThisRound; ++i) {
        let word = response[i * 8 + 3] + (response[i * 8 + 7] << 8);
        words.push(word);
      }
      if (numWordsNextTime > 0) {
        return readMemoryRangeInternal(wordAddress + numWordsThisRound, numWordsNextTime);
      }
      return onSuccess(words);
    }, onUsbError);
  };
  return readMemoryRangeInternal(wordAddress, numWords);
}

function ATtinyX41ReadWord(handle, wordAddress, onSuccess, onUsbError) {
  ATtinyX41ReadMemoryRange(handle, wordAddress, 1, function(words) {
    return onSuccess(words[0]);
  }, onUsbError);
}
