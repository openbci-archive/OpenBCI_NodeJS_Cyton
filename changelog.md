# 1.1.3

### Bug Fixes

* Connect function failed and forced close of port when serial port flushed too fast

# 1.1.2

### Bug Fixes

* Connected function failed

# 1.1.1

Bumping the mathjs to 4.0.1 to fix insecurity

# 1.1.0

Bumping the minor version of openbci-utilities allows this module to move forward

### Breaking Changes

* Drop support for node 4 because of new OpenBCI utilities
* Connect will now automatically call `softReset` and resolve once it's complete.

# 1.0.8

Bump serial port to 1.0.8

### Bug Fixes
* Fix `python` example

# 1.0.7

### Bug Fixes

* Add simulator back into this repo
* Fixed bug where timestamp was not calculated with timeOffset, big fail.
* Fixed the `python` example
* Fixed the `labstreaminglayer` example

# 1.0.6

### Bug Fixes

* Daisy samples now get stop bytes with utilities bump to v0.2.7

# 1.0.4/5

### New Features

* Add function `impedanceSet` which is similar to `channelSet` in that it just sends commands and then forgets about them.

### Bug Fixes

* Fixed lead off command sending for v2 firmware and later.

# 1.0.3

### Bug Fixes

* Bumped utilities module to v0.2.1
* Fixes issue with `getStreamingDaisy.js`

# 1.0.2

### Chores

* Removed false badges

# 1.0.1

### Bug Fixes

* Problem in package.json prevented publishing

# 1.0.0

Port `openbci` v2.2.0 to this repo. Please see the change log for `openbci` if you need a history of changes.
