"use strict";

function ArrayBufToString(arrayBuf) {
  return new TextDecoder("utf-8").decode(new DataView(arrayBuf));
}

// srec argument is string.
//
// Returns object:
// {
//   header: header,
//   records: [
//     {
//       address: address,
//       bytes: uint8array
//     },
//     ...
//   ]
// }
function ParseSREC(srecText) {
  var ParseSingleLine = function(line) {
    var matches = line.match(/^S([0-35-9])([0-9A-Fa-f]{2})((?:[0-9A-Fa-f]{2}){2,})([0-9A-Fa-f]{2})$/);
    if (!matches || matches.length != 5) {
      return null;
    }
    var type = matches[1];
    var len = parseInt(matches[2], 16);
    var addrAndData = matches[3];
    var chkSum = parseInt(matches[4], 16);

    if (len * 2 != addrAndData.length + 2) {
      console.debug("SREC line length mismatch for line:\n" + line);
      return null;
    }
    var addrLenByType = { '0': 4, '1': 4, '2': 6, '3': 8, '5': 4, '6': 6, '7': 8, '8': 6, '9': 4 };
    var addrLen = addrLenByType[type];
    if (addrLen !== undefined && addrAndData.length < addrLen) {
      console.debug("SREC line address and data length is less than expected address length. Expected:", addrLen, "Actual:", addrAndData.length);
      return null;
    }
    var addrAndDataBytes = addrAndData.match(/[0-9A-Fa-f]{2}/gm).map(function(ds) { return parseInt(ds, 16); });
    var actualChkSum = 0xff ^ ((len + addrAndDataBytes.reduce(function(a, b) { return a + b; }, 0)) % 0x100);
    if (chkSum != actualChkSum) {
      console.debug("SREC line checksum mismatch. Expected:", chkSum, "Actual:", actualChkSum);
      return null;
    }

    var addr = parseInt(addrAndData.slice(0, addrLen), 16);
    var bytes = new Uint8Array(addrAndDataBytes.slice(addrLen / 2));
    return {
      type: type,
      address: addr,
      bytes: bytes
    };
  };

  var header = new ArrayBuffer();
  var records = [];
  var currentRecordStart = 0;
  var currentAddr = 0;
  var currentDataArrays = [];

  var FlushDataArrays = function() {
    var dataSize = currentAddr - currentRecordStart;
    if (dataSize === 0) return;
    var recordData = new Uint8Array(dataSize);
    records.push({
      address: currentRecordStart,
      bytes: recordData
    });
    var pieceOffset = 0;
    for (let byteArray of currentDataArrays) {
      recordData.set(byteArray, pieceOffset);
      pieceOffset += byteArray.length;
      currentRecordStart += byteArray.length;
    }
    currentDataArrays = [];
  };

  var error = false;
  var lines = srecText.split(/\r\n|\r(?!\n)|\n/);
  lines.forEach(function(line) {
    if (error) return;
    var srec = ParseSingleLine(line);
    if (!srec) return;
    if (srec.type === '0') {
      header = srec['bytes'].buffer;
      return;
    }
    if (srec.type != '1' && srec.type != '2' && srec.type != '3') return;
    if (srec['address'] < currentAddr) {
      console.error('SREC line addresses are non-increasing, at line:\n' + line);
      error = true;
      return;
    }
    if (srec['address'] != currentAddr) {
      FlushDataArrays();
      currentRecordStart = srec['address'];
      currentAddr = currentRecordStart;
    }
    var bytes = srec['bytes'];
    currentDataArrays.push(bytes);
    currentAddr += bytes.length;
  });

  FlushDataArrays();
  if (error) return undefined;
  return {
    header: header,
    records: records
  };
}

function IsValidSREC(srec) {
  let records = srec['records'];
  if (!records || !Array.isArray(records)) {
    console.debug('Invalid SREC: no records array');
    return false;
  }
  let address = 0;
  for (let record of records) {
    let recordAddress = record['address'];
    if (recordAddress === undefined || recordAddress === null) {
      console.debug('Invalid SREC: record has no address');
      return false;
    }
    if (recordAddress < address) {
      console.debug('Invalid SREC: addresses are non-increasing');
      return false;
    }
    let recordData = record['bytes'];
    if (!recordData || !(recordData instanceof Uint8Array)) {
      console.debug('Invalid SREC: record has no data');
      return false;
    }
    if(recordData.byteLength === 0) {
      console.debug('Invalid SREC: record data has size of 0');
      return false;
    }
    address = recordAddress + recordData.byteLength;
  }
  return true;
}
