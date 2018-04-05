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
const debug = true; // Pretty print any bytes in and out... it's amazing...
const verbose = true; // Adds verbosity to functions

const Cyton = require('../../openBCICyton');
let ourBoard = new Cyton({
  debug: debug,
  verbose: verbose
});

ourBoard.listPorts()
  .then((ports) => {
    console.log('ports', JSON.stringify(ports));
  })

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

/**
     * Connect to the board with portName
     * Only works if one board is plugged in
     * i.e. ourBoard.connect(portName).....
     */
ourBoard.connect('COM5') // Port name is a serial port name, see `.listPorts()`
  .then(() => {
    console.log("connected");
    return ourBoard.syncRegisterSettings();
  })
  .then((cs) => {
		return ourBoard.streamStart();
  })
  .catch((err) => {
		console.log('err', err);
		return ourBoard.streamStart();
  })
  .catch((err) => {
		console.log('fatal err', err);
		process.exit(0);
  });

function exitHandler (options, err) {
  if (options.cleanup) {
    if (verbose) console.log('clean');
    ourBoard.removeAllListeners();
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
        console.log(err);
        process.exit(0);
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
