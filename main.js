var deviceDiv;
var errorDiv;
var selectDeviceButton;

var deviceHandle;
var interfaceClaimed = false;

chrome.app.window.onClosed.addListener(function() {
  if (deviceHandle !== undefined) {
    var closeDevice = function() {
      chrome.usb.closeDevice(deviceHandle, function() {});
    };
    if (interfaceClaimed) {
      chrome.usb.releaseInterface(deviceHandle, 0, function() {
        closeDevice();
      });
    } else {
      closeDevice();
    }
  }
});

function showError(error) {
  errorDiv.textContent = error;
  errorDiv.style['display'] = 'block';
}

function SPIWriteInCycle() {
  var data = Uint8Array.of(0x8c, 0xef, 0x13, 0x7f);
  SPIWrite(deviceHandle, data, function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      showError('chrome.usb.controlTransfer error: ' +
                chrome.runtime.lastError.message);
      return;
    }
    setTimeout(SPIWriteInCycle, 50);
  });
}

function SetGPIOValuesInCycle() {
  SetGPIOValues(deviceHandle, [0x00, 0x00], [0x08, 0x00], function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      showError('chrome.usb.controlTransfer error: ' +
                chrome.runtime.lastError.message);
      return;
    }
    setTimeout(function() {
      SetGPIOValues(deviceHandle, [0x08, 0x00], [0x08, 0x00], function(transferResult) {
        if (chrome.runtime.lastError !== undefined) {
          showError('chrome.usb.controlTransfer error: ' +
                    chrome.runtime.lastError.message);
          return;
        }
        
        setTimeout(SetGPIOValuesInCycle, 200);
      });
    }, 200);
  });
}

function SetupSPIChannel(handle, channel, continuation) {
  SetGPIOChipSelect(deviceHandle, channel, 2, function(transferResult) {
    SetSPIWord(deviceHandle, channel, 0x04, function(transferResult) {
      continuation();
    });
  });
}

// function continuation(handle)
function OpenUSBDevice(device, continuation) {
  chrome.usb.openDevice(device, function(handle) {
    if (chrome.runtime.lastError !== undefined) {
      showError('chrome.usb.openDevice error: ' +
                chrome.runtime.lastError.message);
      return;
    }
    chrome.usb.claimInterface(handle, 0, function() {
      if (chrome.runtime.lastError !== undefined) {
        showError('chrome.usb.claimInterface error: ' +
                  chrome.runtime.lastError.message);
        return;
      }
      interfaceClaimed = true;
      continuation(handle);
    });
  });
}

function onDeviceSelected(devices) {
  if (chrome.runtime.lastError !== undefined) {
    showError('chrome.usb.getUserSelectedDevices error: ' +
              chrome.runtime.lastError.message);
    return;
  }
  if (devices.length != 1) {
    showError('Got ' + devices.length + ' devices from chrome.usb.getUserSelectedDevices');
    return;
  }
  OpenUSBDevice(devices[0], function(handle) {
    deviceHandle = handle;
    SetupSPIChannel(handle, 0, SPIWriteInCycle);
  });
}

window.onload = function() {
  deviceDiv = document.getElementById('device');
  errorDiv = document.getElementById('error');
  selectDeviceButton = document.getElementById('select-device');
  selectDeviceButton.addEventListener('click', function(event) {
    chrome.usb.getDevices({
      'vendorId': 0x10c4,
      'productId': 0x87a0
    }, onDeviceSelected);
    /*
    chrome.usb.getUserSelectedDevices({
      'multiple': false,
      'filters': [{
        'vendorId': 0x10c4,
        'productId': 0x87a0
      }]
    }, onDeviceSelected);
    */
  });
};
