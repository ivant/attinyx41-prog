var deviceDiv;
var errorDiv;
var uploadButton;

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

function SPIWriteSomething() {
  var data = Uint8Array.of(0x8c, 0xef, 0x13, 0x7f);
  SPIWrite(deviceHandle, data, function(transferResult) {
    if (chrome.runtime.lastError !== undefined) {
      showError('SPIWrite error: ' + chrome.runtime.lastError.message);
      return;
    }
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

function onDeviceAddedSingleShotHandler(device) {
  if (IsCP2130Device(device)) {
    showError('');
    chrome.usb.onDeviceAdded.removeListener(onDeviceAddedSingleShotHandler);
    onDeviceFound([device]);
  }
}

function onDeviceRemovedSingleShotHandler(device) {
  if (IsCP2130Device(device)) {
    showError('');
    chrome.usb.onDeviceRemoved.removeListener(onDeviceRemovedSingleShotHandler);
    FindUsbSpiDevice();
  }
}

function FindUsbSpiDevice() {
  chrome.usb.getDevices({
    'filters': [GetCP2130DeviceFilter()]
  }, onDeviceFound);
}

function onDeviceFound(devices) {
  if (chrome.runtime.lastError !== undefined) {
    showError('Chrome error: ' + chrome.runtime.lastError.message);
    return;
  }

  if (devices.length === 0) {
    showError('USB-SPI device not found. Please plug one in to continue.');
    chrome.usb.onDeviceAdded.addListener(onDeviceAddedSingleShotHandler);
    return;
  } else if (devices.length > 1) {
    showError('Got ' + devices.length + ' USB-SPI devices. Please remove all but one.');
    chrome.usb.onDeviceRemoved.addListener(onDeviceRemovedSingleShotHandler);
    return;
  }

  OpenUSBDevice(devices[0], function(handle) {
    deviceHandle = handle;
    uploadButton.disabled = false;
  });
}

function UploadSREC(clickEvent) {
  chrome.fileSystem.chooseEntry({}, function(entry) {
    entry.file(function(file) {
      var reader = new FileReader();
      reader.onloadend = function(e) {
        srec = ParseSREC(reader.result);
        if (!srec) {
          showError('Failed to parse SREC file');
          return;
        }

        SetupSPIChannel(deviceHandle, 0, SPIWriteSomething);

        // For now, as a test, just write out the first record.
        SPIWrite(deviceHandle, new Uint8Array(srec['records'][0]['data']), function(transferResult) {
          if (chrome.runtime.lastError !== undefined) {
            showError('SPIWrite error: ' + chrome.runtime.lastError.message);
            return;
          }
        });
      };
      reader.readAsText(file);
    });
  });
}

window.onload = function() {
  deviceDiv = document.getElementById('device');
  errorDiv = document.getElementById('error');
  uploadButton = document.getElementById('upload');
  uploadButton.disabled = true;
  uploadButton.addEventListener('click', UploadSREC);

  FindUsbSpiDevice();

  /*
  selectDeviceButton.addEventListener('click', function(event) {
    chrome.usb.getUserSelectedDevices({
      'multiple': false,
      'filters': [GetCP2130DeviceFilter()]
    }, onDeviceFound);
  });
  */
};
