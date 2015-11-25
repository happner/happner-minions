var os = require('os');
var ifaces;

module.exports.externalInterfaces = function(callback) {
  if (ifaces) {
    if (callback) callback(null, ifaces);
    return ifaces;
  }
  var ifacesList;
  var got = {};
  ifaces = [];
  Object.keys(ifacesList = os.networkInterfaces()).forEach(function(dev) {
    ifacesList[dev]
    .filter(function(address) {
      return address.internal == false && address.family == 'IPv4';
    })
    .forEach(function(iface) {
      if (got[iface.address]) return;
      ifaces.push(iface.address);
      got[iface.address] = 1;
    });
  });
  if (callback) callback(null, ifaces);
  return ifaces;
}