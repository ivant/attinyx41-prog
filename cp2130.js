"use strict";

// SI CP2130 communication functions.
//
// See "AN792: CP2130 Interface Specification" for details.

function IsCP2130Device(device) {
  return device.vendorId == 0x10c4 && device.productId == 0x87a0;
}

function GetCP2130DeviceFilter() {
  return {
    'vendorId': 0x10c4,
    'productId': 0x87a0
  };
}

function ControlIn(handle, request, length, onTransferResult) {
  chrome.usb.controlTransfer(handle, {
    'direction': 'in',
    'recipient': 'device',
    'requestType': 'vendor',
    'request': request,
    'value': 0,
    'index': 0,
    'length': length
  }, onTransferResult);
}

function ControlOut(handle, request, buf, onTransferResult) {
  chrome.usb.controlTransfer(handle, {
    'direction': 'out',
    'recipient': 'device',
    'requestType': 'vendor',
    'request': request,
    'value': 0,
    'index': 0,
    'data': buf
  }, onTransferResult);
}

function GetGPIOValues(handle, onTransferResult) {
  ControlIn(handle, 0x20 /* Get_GPIO_Values */, 2, onTransferResult);
}

function SetGPIOValues(handle, levels, mask,  onTransferResult) {
  var buf = new ArrayBuffer(4);
  var bufView = new Uint8Array(buf);
  bufView[0] = levels[0];
  bufView[1] = levels[1];
  bufView[2] = mask[0];
  bufView[3] = mask[1];
  ControlOut(handle, 0x21 /* Set_GPIO_Values */, buf, onTransferResult);
}

function GetGPIOChipSelect(handle, onTransferResult) {
  ControlIn(handle, 0x24 /* Get_GPIO_Chip_Select */, 4, onTransferResult);
}

function SetGPIOChipSelect(handle, channel, control, onTransferResult) {
  var buf = new ArrayBuffer(2);
  var bufView = new Uint8Array(buf);
  bufView[0] = channel;
  bufView[1] = control;
  ControlOut(handle, 0x25 /* Set_GPIO_ChipSelect */, buf, onTransferResult);
}

function GetGPIOModeAndLevel(handle, onTransferResult) {
  ControlIn(handle, 0x22 /* Get_GPIO_Mode_And_Level */, 4, onTransferResult);
}

var CP2130_PIN_MODE_INPUT = 0x00;
var CP2130_PIN_MODE_OPEN_DRAIN_OUTPUT = 0x01;
var CP2130_PIN_MODE_PUSH_PULL_OUTPUT = 0x02;

function SetGPIOModeAndLevel(handle, pin, mode, level, onTransferResult) {
  var buf = new ArrayBuffer(3);
  var bufView = new Uint8Array(buf);
  bufView[0] = pin;
  bufView[1] = mode;
  bufView[2] = level;
  ControlOut(handle, 0x23 /* Get_GPIO_Mode_And_Level */, buf, onTransferResult);
}

function GetClockDivider(handle, onTransferResult) {
  ControlIn(handle, 0x46 /* Get_Clock_Divider */, 1, onTransferResult);
}

// GPIO.5 Clock Frequency = 24MHz / clockDivider
// clockDivider value of 0 means 256.
function SetClockDivider(handle, clockDivider, onTransferResult) {
  var buf = new ArrayBuffer(1);
  var bufView = new Uint8Array(buf);
  bufView[0] = clockDivider;
  ControlOut(handle, 0x47 /* Set_Clock_Divider */, buf, onTransferResult);
}

function GetSPIWord(handle, onTransferResult) {
  ControlIn(handle, 0x30 /* Get_SPI_Word */, 0x0b, onTransferResult);
}

function SetSPIWord(handle, channel, word, onTransferResult) {
  var buf = new ArrayBuffer(2);
  var bufView = new Uint8Array(buf);
  bufView[0] = channel;
  bufView[1] = word;
  ControlOut(handle, 0x31 /* Set_SPI_Word */, buf, onTransferResult);
}

// data is Uint8Array
function SPIWrite(handle, data, onTransferResult) {
  var buf = new ArrayBuffer(data.length + 8);
  var bufView = new Uint8Array(buf);
  bufView.set(Uint8Array.of(0x00, 0x00, 0x01, 0x00), 0);
  bufView.set(Uint32Array.of(data.length), 4);  // little-endian
  bufView.set(data, 8);
  chrome.usb.bulkTransfer(handle, {
    'direction': 'out',
    'endpoint': 1,
    'data': buf
  }, onTransferResult);
}


// On success calls onSuccess with a Uint8Array argument containing the response.
function SPIWriteRead(handle, data, onSuccess, onUsbError) {
  let buf = new ArrayBuffer(data.length + 8);
  let bufView = new Uint8Array(buf);
  bufView.set(Uint8Array.of(0x00, 0x00, 0x02, 0x00), 0);
  bufView.set(Uint32Array.of(data.length), 4);  // little-endian
  bufView.set(data, 8);

  let response = new Uint8Array(data.length);
  let receivedBytes = 0;

  function receiveData() {
    chrome.usb.bulkTransfer(handle, {
      'direction': 'in',
      'endpoint': 2,
      'length': (response.length - receivedBytes)
    }, function(transferResult) {
      if (chrome.runtime.lastError !== undefined) {
        return onUsbError(chrome.runtime.lastError.message);
      }
      if (transferResult.resultCode !== 0) {
        return onUsbError('chrome.usb.bulkTransfer returned ' + transferResult.resultCode);
      }

      response.set(new Uint8Array(transferResult.data), receivedBytes);
      receivedBytes += transferResult.data.byteLength;

      if (response.length - receivedBytes > 0) return receiveData();
      onSuccess(response);
    });
  }

  chrome.usb.bulkTransfer(handle, {
    'direction': 'out',
    'endpoint': 1,
    'data': buf
  }, function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      return onUsbError(chrome.runtime.lastError.message);
    }
    if (transferResult.resultCode !== 0) {
      return onUsbError('chrome.usb.bulkTransfer returned ' + transferResult.resultCode);
    }

    receiveData();
  });
}
