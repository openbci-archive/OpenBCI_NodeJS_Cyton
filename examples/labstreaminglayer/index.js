/**
 * This is an example from the readme.md
 * On windows you should run with PowerShell not git bash.
 * Install
 *   [nodejs](https://nodejs.org/en/)
 *
 * To run:
 *   change directory to this file `cd examples/debug`
 *   do `npm install`
 *   then `npm start`
 */
const portPub = 'tcp://127.0.0.1:3004';
const zmq = require('zmq-prebuilt');
const socket = zmq.socket('pair');
const debug = false; // Pretty print any bytes in and out... it's amazing...
const verbose = true; // Adds verbosity to functions

const Cyton = require('../../openBCICyton');
let ourBoard = new Cyton({
  simulatorFirmwareVersion: 'v2',
  debug: debug,
  verbose: verbose
});

let timeSyncPossible = false;
let resyncPeriodMin = 1;
let secondsInMinute = 60;
let numChans = 8;
let resyncPeriod = ourBoard.sampleRate() * resyncPeriodMin * secondsInMinute;

ourBoard.autoFindOpenBCIBoard().then(portName => {
  if (portName) {
    /**
     * Connect to the board with portName
     * i.e. ourBoard.connect(portName).....
     */
    ourBoard.connect(portName) // Port name is a serial port name, see `.listPorts()`
      .then(() => {
        ourBoard.on('ready', () => {
          ourBoard.streamStart()
            .catch((err) => {
              console.log('fatal err', err);
              process.exit(0);
            });

          ourBoard.on('sample', (sample) => {
            /** Work with sample */
            for (let i = 0; i < ourBoard.numberOfChannels(); i++) {
              console.log(`Channel ${(i + 1)}: ${sample.channelData[i].toFixed(8)} Volts.`);
              // prints to the console
              //  "Channel 1: 0.00001987 Volts."
              //  "Channel 2: 0.00002255 Volts."
              //  ...
              //  "Channel 8: -0.00001875 Volts."
            }
          });
        });
      });
    // Call to connect
    ourBoard.connect(portName)
      .then(() => {


      })
      .catch(err => {
        console.log(`connect: ${err}`);
      });
  } else {
    /** Unable to auto find OpenBCI board */
    console.log('Unable to auto find OpenBCI board');
  }
});

const sampleFunc = sample => {
  if (sample._count % resyncPeriod === 0) {
    ourBoard.syncClocksFull()
      .then(syncObj => {
        // Sync was successful
        if (syncObj.valid) {
          // Log the object to check it out!
          console.log(`timeOffset`, syncObj.timeOffsetMaster);
        } else {
          // Retry it
          console.log(`Was not able to sync... retry!`);
        }
      });
  }

  if (sample.timeStamp) { // true after the first successful sync
    if (sample.timeStamp < 10 * 60 * 60 * 1000) { // Less than 10 hours
      console.log(`Bad time sync ${sample.timeStamp}`);
    } else {
      sendToPython({
        action: 'process',
        command: 'sample',
        message: sample
      }, verbose);
    }
  }
};

// Subscribe to your functions
ourBoard.on('sample', sampleFunc);

// ZMQ
socket.bind(portPub, function (err) {
  if (err) throw err;
  console.log(`bound to ${portPub}`);
});

/**
 * Used to send a message to the Python process.
 * @param  {Object} interProcessObject The standard inter-process object.
 * @param {Boolean} verbose Should we do a verbose print out
 * @return {None}
 */
const sendToPython = (interProcessObject, verbose) => {
  if (verbose) {
    console.log(`<- out ${JSON.stringify(interProcessObject)}`);
  }
  if (socket) {
    socket.send(JSON.stringify(interProcessObject));
  }
};

function exitHandler (options, err) {
  if (options.cleanup) {
    if (verbose) console.log('clean');
    /** Do additional clean up here */
  }
  if (err) console.log(err.stack);
  if (options.exit) {
    if (verbose) console.log('exit');
    ourBoard.disconnect()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        process.exit(0);
        console.log(err);
      });
  }
}

if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('SIGINT', function () {
    process.emit('SIGINT');
  });
}

// do something when app is closing
process.on('exit', exitHandler.bind(null, {
  cleanup: true
}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
  exit: true
}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
  exit: true
}));
