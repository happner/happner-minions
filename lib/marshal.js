module.exports = Marshal;

var Promise = require('bluebird');
var spawn = require('child_process').spawn;
var normalize = require('path').normalize;
var sillyname = require('sillyname');
var externalInterfaces = require('./util').externalInterfaces;

function Marshal() {
  this.minions = {};
  this.pendingMinions = {};
}

Marshal.prototype.start = function($happn, callback) {

  var _this = this;

  this.info = JSON.parse(JSON.stringify($happn.info));
  this.abilities = JSON.parse(JSON.stringify($happn.config.abilities));

  for (var script in this.abilities) {
    for (var type in this.abilities[script]) {
      this.abilities[script][type].running = 0;
    }
  }

  if (this.info.datalayer.address.address == '0.0.0.0') {
    // assume first public iface for remote to connect to
    var ifaces = externalInterfaces();
    this.info.datalayer.address.address = ifaces[0];
  }

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];
  var masterEvent = $happn.event[masterAddress[0]][masterAddress[1]];

  return Promise.all([

    masterEvent.onAsync('keepalive', function(data) {

      var master = data.master;
      if (!master || !_this.master) return;
      if (master.process == _this.master.process) return;

      // new master detected, reregister

      masterExchange.registerMarshal({
        info: _this.info,
        abilities: _this.abilities,
        minions: _this.minions,
      })
      .then(function(masterInfo) {
        _this.master = masterInfo;
      })
      .catch(function(e) {
        $happn.error('re-register failed', e);
      })
    }),


    masterEvent.onAsync('minion/spawn/at/' + $happn.info.mesh.name, function(data, meta) {
      var name = (sillyname.randomAdjective() + sillyname.randomNoun()).toLowerCase();

      var minion = {
        name: name,
        status: 'pending',
        marshalName: _this.info.mesh.name,
        spawnedAt: Date.now(),
      }

      Object.keys(data).forEach(function(key) {
        minion[key] = data[key];
      });

      _this.minions[name] = minion;

      var spawnConfig = JSON.stringify({
        marshal: _this.info,
        config: minion,
      });

      $happn.log.$$DEBUG('spawn %s', normalize(__dirname + '/../bin/' + data.type));

      var child = spawn(normalize(__dirname + '/../bin/' + data.type), [spawnConfig]);

      Object.defineProperty(_this.minions[name], 'process', {
        value: child
      });

      _this.abilities[minion.script][minion.type].running++;

      child.on('error', function(e) {
        $happn.log.error('spawn error', e);
      });

      child.on('close', function() {

        masterExchange.destroyMinion({
          info: _this.info,
          minion: _this.minions[name]
        })
        .catch(function(e) {
          $happn.log.error('error de-registering minion', e);
        })
        .finally(function() {
          delete _this.minions[name];
        })
      });

      if (process.env.MINION_STDOUT || data.stdout) {
        child.stdout.on('data', function(data) {
          console._stdout.write(data.toString());
        });
      }

      if (process.env.MINION_STDERR || data.stdout || data.stderr) {
        child.stderr.on('data', function(data) {
          console._stderr.write(data.toString());
        });
      }

      masterExchange.createMinion({
        info: _this.info,
        minion: _this.minions[name],
      })
      .catch(function(e) {
        $happn.log.error('error registering minion', e);
      })

    }),

    masterEvent.onAsync('minions/finish', function(data, meta) {
      for (var name in _this.minions) {
        var minion = _this.minions[name];
        if (minion.tag != data.tag) return;
        $happn.emit('minion/finish/' + name, data);
      }
    }),

    masterEvent.onAsync('minion/start/*', function(data, meta) {
      var name = meta.path.match(/.*\/(.*)/)[1];
      $happn.emit('minion/start/' + name);
    }),

    masterEvent.onAsync('minion/reset/*', function(data, meta) {
      var name = meta.path.match(/.*\/(.*)/)[1];
      $happn.emit('minion/reset/' + name, data);
    }),

    masterEvent.onAsync('minion/killall', function(data, meta) {
      $happn.log.$$DEBUG('kill all minions');
      for (var name in _this.minions) {
        var minion = _this.minions[name];

        // filter
        var match = true;
        for(var key in data) {
          if (minion[key] != data[key]) match = false;
        }
        if (!match) continue;

        $happn.log.$$DEBUG('kill minion \'%s\'', name);

        try {
          minion.process.kill();
        } catch (e) {}
        try {
          _this.abilities[minion.script][minion.type].running--;
        } catch (e) {}
      }
    }),

    masterEvent.onAsync('minion/kill/*', function(data, meta) {
      var name = meta.path.split('/').pop();
      if (!_this.minions[name]) {
        $happn.log.warn('cannot kill no such minion: \'%s\'', name);
        return;
      };
      $happn.log.$$DEBUG('kill minion \'%s\'', name);
      var minion = _this.minions[name];
      
      try {
        minion.process.kill();
      } catch (e) {}
      try {
        _this.abilities[minion.script][minion.type].running--;
      } catch (e) {}
    }),
  ])

  .then(function() {
    return masterExchange.registerMarshal({
      info: _this.info,
      abilities: _this.abilities,
      minions: _this.minions,
    });
  })

  .then(function(masterInfo) {
    $happn.log.info('registered with master: \'%s\'', $happn.config.master);
    _this.master = masterInfo;
  })

  .then(function() {
    process.on('exit', function() {
      for (var name in _this.minions) {
        _this.minions[name].process.kill();
      }
    })

  })

  .then(callback)

  .catch(callback);

}

Marshal.prototype.minionReady = function($happn, update, callback) {

  var name = update.name;
  var minion = this.minions[name];

  if (!minion) {
    $happn.log.warn('cannot update no such minion: \'%s\'', name);
    return;
  }

  minion.status = 'ready';
  minion.readyAt = update.timestamp;
  minion.address = update.address;
  minion.task = update.task;
  minion.meshName = update.meshName;

  this.minions[name] = minion;

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.updateMinion({
    info: this.info,
    minion: minion
  })
  .then(function() {
    callback();
  })
  .catch(function(e) {
    $happn.log.error('error updating minion (update)', e);
    callback();
  })


}

Marshal.prototype.minionError = function($happn, name, error, callback) {
  $happn.log.error('minion \'%s\' error', name, error);

  var minion = this.minions[name];

  if (!minion) {
    $happn.log.warn('cannot error no such minion: \'%s\'', id);
    return callback();
  }

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  minion.status = 'error';
  minion.errorAt = Date.now();
  minion.error = error;

  masterExchange.updateMinion({
    info: this.info,
    minion: minion,
  })
  .then(function() {
    callback();
  })
  .catch(function(e) {
    $happn.log.error('error updating minion (error)', e);
    callback();
  });

}

Marshal.prototype.minionDone = function($happn, name, result, callback) {

  $happn.log.$$DEBUG('minion \'%s\' done result: \'%j\'', name, result);
  
  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];


  var minion = this.minions[name];
  minion.status = 'done';
  minion.finishedAt = Date.now();
  delete minion.error;

  masterExchange.updateMinion({
    info: this.info,
    minion: minion,
    result: result
  })
  .then(function() {
    callback();
  })
  .catch(function(e) {
    $happn.log.error('error updating minion (done)', e);
    callback();
  });

}

Marshal.prototype.minionResetDone = function($happn, name, resetResult, callback) {
  $happn.log.$$DEBUG('minion \'%s\' minionResetDone \'%s\': \'%j\'', name, resetResult);

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.minionResetDone({
    marshalName: this.info.mesh.name,
    minionName: name,
    resetResult: resetResult,
  });

  callback();
}


Marshal.prototype.minionFinishDone = function($happn, name, finishResult, callback) {
  $happn.log.$$DEBUG('minion \'%s\' minionFinishDone \'%s\': \'%j\'', name, finishResult);

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.minionFinishDone({
    marshalName: this.info.mesh.name,
    minionName: name,
    finishResult: finishResult,
  });

  callback();
}

Marshal.prototype.minionStepDone = function($happn, name, stepName, stepResult, callback) {

  $happn.log.$$DEBUG('minion \'%s\' minionStepDone \'%s\': \'%j\'', name, stepName, stepResult);

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.minionStepDone({
    marshalName: this.info.mesh.name,
    minionName: name,
    stepName: stepName,
    stepResult: stepResult,
  });

  callback();

}

Marshal.prototype.minionStarted = function($happn, name, info, callback) {

  $happn.log.$$DEBUG('minion \'%s\' minionStarted', name);

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.minionStarted({
    marshalName: this.info.mesh.name,
    minionName: name,
    info: info,
  });

  callback();

}

