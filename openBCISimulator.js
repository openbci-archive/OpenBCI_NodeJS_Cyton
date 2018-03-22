'use strict';
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const stream = require('stream');

const obciUtilities = require('openbci-utilities/dist/utilities');
const k = require('openbci-utilities/dist/constants');
const now = require('performance-now');
const Buffer = require('safe-buffer').Buffer;

const _options = {
  accel: true,
  alpha: true,
  boardFailure: false,
  daisy: false,
  daisyCanBeAttached: true,
  drift: 0,
  firmwareVersion: [k.OBCIFirmwareV1, k.OBCIFirmwareV2, k.OBCIFirmwareV3],
  fragmentation: [k.OBCISimulatorFragmentationNone, k.OBCISimulatorFragmentationRandom, k.OBCISimulatorFragmentationFullBuffers, k.OBCISimulatorFragmentationOneByOne],
  latencyTime: 16,
  bufferSize: 4096,
  lineNoise: [k.OBCISimulatorLineNoiseHz60, k.OBCISimulatorLineNoiseHz50, k.OBCISimulatorLineNoiseNone],
  sampleRate: 250,
  serialPortFailure: false,
  verbose: false
};

function Simulator (portName, options) {
  if (!(this instanceof Simulator)) {
    return new Simulator(portName, options);
  }
  options = options || {};
  let opts = {};

  stream.Stream.call(this);

  /** Configuring Options */
  let o;
  for (o in _options) {
    let userValue = options[o];
    delete options[o];

    if (typeof _options[o] === 'object') {
      // an array specifying a list of choices
      // if the choice is not in the list, the first one is defaulted to

      if (_options[o].indexOf(userValue) !== -1) {
        opts[o] = userValue;
      } else {
        opts[o] = _options[o][0];
      }
    } else {
      // anything else takes the user value if provided, otherwise is a default

      if (userValue !== undefined) {
        opts[o] = userValue;
      } else {
        opts[o] = _options[o];
      }
    }
  }

  for (o in options) throw new Error('"' + o + '" is not a valid option');

  this.options = opts;

  // Bools
  this.isOpen = false;
  this.sd = {
    active: false,
    startTime: 0
  };
  this.streaming = false;
  this.synced = false;
  this.sendSyncSetPacket = false;
  // Buffers
  this.outputBuffer = new Buffer(this.options.bufferSize);
  this.outputBuffered = 0;
  // Numbers
  this.channelNumber = 1;
  this.hostChannelNumber = this.channelNumber;
  this.pollTime = 80;
  this.sampleNumber = -1; // So the first sample is 0
  // Objects
  this.sampleGenerator = obciUtilities.randomSample(k.OBCINumberOfChannelsDefault, this.options.sampleRate, this.options.alpha, this.options.lineNoise);
  this.time = {
    current: 0,
    start: now(),
    loop: null
  };
  // Strings
  this.portName = portName || k.OBCISimulatorPortName;

  // Call 'open'
  if (this.options.verbose) console.log(`Port name: ${portName}`);
  setTimeout(() => {
    this.isOpen = true;
    this.emit('open');
  }, 200);
}

// This allows us to use the emitter class freely outside of the module
util.inherits(Simulator, EventEmitter);

Simulator.prototype.flush = function (callback) {
  this.outputBuffered = 0;

  clearTimeout(this.outputLoopHandle);
  this.outputLoopHandle = null;

  if (callback) callback();
};

// output only size bytes of the output buffer
Simulator.prototype._partialDrain = function (size) {
  if (!this.isOpen) throw new Error('not connected');

  if (size > this.outputBuffered) size = this.outputBuffered;

  // buffer is copied because presently openBCICyton.js reuses it
  let outBuffer = new Buffer(this.outputBuffer.slice(0, size));

  this.outputBuffer.copy(this.outputBuffer, 0, size, this.outputBuffered);
  this.outputBuffered -= size;

  this.emit('data', outBuffer);
};

// queue some data for output and send it out depending on options.fragmentation
Simulator.prototype._output = function (dataBuffer) {
  // drain full buffers until there is no overflow
  while (this.outputBuffered + dataBuffer.length > this.outputBuffer.length) {
    let len = dataBuffer.copy(this.outputBuffer, this.outputBuffered);
    dataBuffer = dataBuffer.slice(len);
    this.outputBuffered += len;

    this._partialDrain(this.outputBuffered);
    this.flush();
  }

  dataBuffer.copy(this.outputBuffer, this.outputBuffered);
  this.outputBuffered += dataBuffer.length;

  if (!this.outputLoopHandle) {
    let latencyTime = this.options.latencyTime;
    if (this.options.fragmentation === k.OBCISimulatorFragmentationOneByOne ||
      this.options.fragmentation === k.OBCISimulatorFragmentationNone) {
      // no need to wait for latencyTime
      // note that this is the only difference between 'none' and 'fullBuffers'
      latencyTime = 0;
    }
    let outputLoop = () => {
      let size;
      switch (this.options.fragmentation) {
        case k.OBCISimulatorFragmentationRandom:
          if (Math.random() < 0.5) {
            // randomly picked to send out a fragment
            size = Math.ceil(Math.random() * Math.max(this.outputBuffered, 62));
            break;
          } // else, randomly picked to send a complete buffer in next block
        /* falls through */
        case k.OBCISimulatorFragmentationFullBuffers:
        case k.OBCISimulatorFragmentationNone:
        case false:
          size = this.outputBuffered;
          break;
        case k.OBCISimulatorFragmentationOneByOne:
          size = 1;
          break;
      }
      this._partialDrain(size);
      if (this.outputBuffered) {
        this.outputLoopHandle = setTimeout(outputLoop, latencyTime);
      } else {
        this.outputLoopHandle = null;
      }
    };
    if (latencyTime === 0) {
      outputLoop();
    } else {
      this.outputLoopHandle = setTimeout(outputLoop, latencyTime);
    }
  }
};

Simulator.prototype.write = function (data, callback) {
  if (!this.isOpen) {
    /* istanbul ignore else */
    if (callback) callback(Error('Not connected'));
    else throw new Error('Not connected!');
    return;
  }

  // TODO: this function assumes a type of Buffer for radio, and a type of String otherwise
  //       FIX THIS it makes it unusable outside the api code
  switch (data[0]) {
    case k.OBCIRadioKey:
      this._processPrivateRadioMessage(data);
      break;
    case k.OBCIStreamStart:
      if (!this.stream) this._startStream();
      this.streaming = true;
      break;
    case k.OBCIStreamStop:
      if (this.stream) clearInterval(this.stream); // Stops the stream
      this.streaming = false;
      break;
    case k.OBCIMiscSoftReset:
      if (this.stream) clearInterval(this.stream);
      this.streaming = false;
      this._output(new Buffer(`OpenBCI V3 Simulator On Board ADS1299 Device ID: 0x3E ${this.options.daisy ? `On Daisy ADS1299 Device ID: 0x3E\n` : ``} LIS3DH Device ID: 0x38422 ${this.options.firmwareVersion === k.OBCIFirmwareV2 ? `Firmware: v2.0.0\n` : ``}$$$`));
      break;
    case k.OBCISDLogForHour1:
    case k.OBCISDLogForHour2:
    case k.OBCISDLogForHour4:
    case k.OBCISDLogForHour12:
    case k.OBCISDLogForHour24:
    case k.OBCISDLogForMin5:
    case k.OBCISDLogForMin15:
    case k.OBCISDLogForMin30:
    case k.OBCISDLogForSec14:
      // If we are not streaming, then do verbose output
      if (!this.streaming) {
        this._output(new Buffer('Wiring is correct and a card is present.\nCorresponding SD file OBCI_69.TXT\n$$$'));
      }
      this.sd.active = true;
      this.sd.startTime = now();
      break;
    case k.OBCISDLogStop:
      if (!this.streaming) {
        if (this.SDLogActive) {
          this._output(new Buffer(`Total Elapsed Time: ${now() - this.sd.startTime} ms`));
          this._output(new Buffer(`Max write time: ${Math.random() * 500} us`));
          this._output(new Buffer(`Min write time: ${Math.random() * 200} us`));
          this._output(new Buffer(`Overruns: 0`));
          this._printEOT();
        } else {
          this._output(new Buffer('No open file to close\n'));
          this._printEOT();
        }
      }
      this.SDLogActive = false;
      break;
    case k.OBCISyncTimeSet:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        this.synced = true;
        setTimeout(() => {
          this._output(new Buffer(k.OBCISyncTimeSent));
          this._syncUp();
        }, 10);
      }
      break;
    case k.OBCIChannelMaxNumber8:
      if (this.options.daisy) {
        this.options.daisy = false;
        this._output(new Buffer(k.OBCIChannelMaxNumber8SuccessDaisyRemoved));
        this._printEOT();
      } else {
        this._printEOT();
      }
      break;
    case k.OBCIChannelMaxNumber16:
      if (this.options.daisy) {
        this._output(new Buffer(k.OBCIChannelMaxNumber16DaisyAlreadyAttached));
        this._printEOT();
      } else {
        if (this.options.daisyCanBeAttached) {
          this.options.daisy = true;
          this._output(new Buffer(k.OBCIChannelMaxNumber16DaisyAttached));
          this._printEOT();
        } else {
          this._output(new Buffer(k.OBCIChannelMaxNumber16NoDaisyAttached));
          this._printEOT();
        }
      }
      break;
    case k.OBCIMiscQueryRegisterSettings:
      let outputString = k.OBCIRegisterQueryCyton;
      if (this.options.daisy) {
        outputString += k.OBCIRegisterQueryCytonDaisy;
      }
      if (this.options.firmwareVersion === k.OBCIFirmwareV3) {
        outputString += k.OBCIRegisterQueryAccelerometerFirmwareV3;
      } else {
        outputString += k.OBCIRegisterQueryAccelerometerFirmwareV1;
      }
      this._output(Buffer.from(outputString));
      this._printEOT();
      break;
    default:
      break;
  }

  /** Handle Callback */
  if (callback) {
    callback(null, 'Success!');
  }
};

Simulator.prototype.drain = function (callback) {
  if (callback) callback();
};

Simulator.prototype.close = function (callback) {
  if (this.isOpen) {
    this.flush();

    if (this.stream) clearInterval(this.stream);

    this.isOpen = false;
    this.emit('close');
    if (callback) callback();
  } else {
    if (callback) callback(Error('Not connected'));
  }
};

Simulator.prototype._startStream = function () {
  let intervalInMS = 1000 / this.options.sampleRate;

  if (intervalInMS < 2) intervalInMS = 2;

  let getNewPacket = sampNumber => {
    if (this.options.accel) {
      if (this.synced) {
        if (this.sendSyncSetPacket) {
          this.sendSyncSetPacket = false;
          return obciUtilities.convertSampleToPacketAccelTimeSyncSet(this.sampleGenerator(sampNumber), now().toFixed(0));
        } else {
          return obciUtilities.convertSampleToPacketAccelTimeSynced(this.sampleGenerator(sampNumber), now().toFixed(0));
        }
      } else {
        return obciUtilities.convertSampleToPacketStandard(this.sampleGenerator(sampNumber));
      }
    } else {
      if (this.synced) {
        if (this.sendSyncSetPacket) {
          this.sendSyncSetPacket = false;
          return obciUtilities.convertSampleToPacketRawAuxTimeSyncSet(this.sampleGenerator(sampNumber), now().toFixed(0), new Buffer([0, 0, 0, 0, 0, 0]));
        } else {
          return obciUtilities.convertSampleToPacketRawAuxTimeSynced(this.sampleGenerator(sampNumber), now().toFixed(0), new Buffer([0, 0, 0, 0, 0, 0]));
        }
      } else {
        return obciUtilities.convertSampleToPacketRawAux(this.sampleGenerator(sampNumber), new Buffer([0, 0, 0, 0, 0, 0]));
      }
    }
  };

  this.stream = setInterval(() => {
    this._output(getNewPacket(this.sampleNumber));
    this.sampleNumber++;
  }, intervalInMS);
};

Simulator.prototype._syncUp = function () {
  setTimeout(() => {
    this.sendSyncSetPacket = true;
  }, 12); // 3 packets later
};

Simulator.prototype._printEOT = function () {
  this._output(new Buffer('$$$'));
};

Simulator.prototype._printFailure = function () {
  this._output(new Buffer('Failure: '));
};

Simulator.prototype._printSuccess = function () {
  this._output(new Buffer('Success: '));
};

Simulator.prototype._printValidatedCommsTimeout = function () {
  this._printFailure();
  this._output(new Buffer('Communications timeout - Device failed to poll Host'));
  this._printEOT();
};

Simulator.prototype._processPrivateRadioMessage = function (dataBuffer) {
  switch (dataBuffer[1]) {
    case k.OBCIRadioCmdChannelGet:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (!this.options.boardFailure) {
          this._printSuccess();
          this._output(new Buffer(`Host and Device on Channel Number ${this.channelNumber}`));
          this._output(new Buffer([this.channelNumber]));
          this._printEOT();
        } else if (!this.serialPortFailure) {
          this._printFailure();
          this._output(new Buffer(`Host on Channel Number ${this.channelNumber}`));
          this._output(new Buffer([this.channelNumber]));
          this._printEOT();
        }
      }
      break;
    case k.OBCIRadioCmdChannelSet:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (!this.options.boardFailure) {
          if (dataBuffer[2] <= k.OBCIRadioChannelMax) {
            this.channelNumber = dataBuffer[2];
            this.hostChannelNumber = this.channelNumber;
            this._printSuccess();
            this._output(new Buffer(`Channel Number ${this.channelNumber}`));
            this._output(new Buffer([this.channelNumber]));
            this._printEOT();
          } else {
            this._printFailure();
            this._output(new Buffer('Verify channel number is less than 25'));
            this._printEOT();
          }
        } else if (!this.serialPortFailure) {
          this._printValidatedCommsTimeout();
        }
      }
      break;
    case k.OBCIRadioCmdChannelSetOverride:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (dataBuffer[2] <= k.OBCIRadioChannelMax) {
          if (dataBuffer[2] === this.channelNumber) {
            this.options.boardFailure = false;
          } else {
            this.options.boardFailure = true;
          }
          this.hostChannelNumber = dataBuffer[2];
          this._printSuccess();
          this._output(new Buffer(`Host override - Channel Number ${this.hostChannelNumber}`));
          this._output(new Buffer([this.hostChannelNumber]));
          this._printEOT();
        } else {
          this._printFailure();
          this._output(new Buffer('Verify channel number is less than 25'));
          this._printEOT();
        }
      }
      break;
    case k.OBCIRadioCmdPollTimeGet:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (!this.options.boardFailure) {
          this._printSuccess();
          this._output(new Buffer(`Poll Time ${this.pollTime}`));
          this._output(new Buffer([this.pollTime]));
          this._printEOT();
        } else {
          this._printValidatedCommsTimeout();
        }
      }
      break;
    case k.OBCIRadioCmdPollTimeSet:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (!this.options.boardFailure) {
          this.pollTime = dataBuffer[2];
          this._printSuccess();
          this._output(new Buffer(`Poll Time ${this.pollTime}`));
          this._output(new Buffer([this.pollTime]));
          this._printEOT();
        } else {
          this._printValidatedCommsTimeout();
        }
      }
      break;
    case k.OBCIRadioCmdBaudRateSetDefault:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        this._printSuccess();
        this._output(new Buffer('Switch your baud rate to 115200'));
        this._output(new Buffer([0x24, 0x24, 0x24, 0xFF])); // The board really does this
      }
      break;
    case k.OBCIRadioCmdBaudRateSetFast:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        this._printSuccess();
        this._output(new Buffer('Switch your baud rate to 230400'));
        this._output(new Buffer([0x24, 0x24, 0x24, 0xFF])); // The board really does this
      }
      break;
    case k.OBCIRadioCmdSystemStatus:
      if (this.options.firmwareVersion === k.OBCIFirmwareV2) {
        if (!this.options.boardFailure) {
          this._printSuccess();
          this._output(new Buffer('System is Up'));
          this._printEOT();
        } else {
          this._printFailure();
          this._output(new Buffer('System is Down'));
          this._printEOT();
        }
      }
      break;
    default:
      break;
  }
};

module.exports = Simulator;
