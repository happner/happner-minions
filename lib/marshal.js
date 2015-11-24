module.exports = Marshal;

var Promise = require('bluebird');
var shortid = require('shortid');
var spawn = require('child_process').spawn;

function Marshal() {
  this.minions = {};
  this.pendingMinions = {};
}

Marshal.prototype.start = function($happn, callback) {

  var _this = this;

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];
  var masterEvent = $happn.event[masterAddress[0]][masterAddress[1]];


  return Promise.all([

    masterEvent.onAsync('keepalive', function(data) {

      var master = data.master;
      if (master.process == _this.master.process) return;

      // new master detected, reregister
      masterExchange.registerMarshal({
        info: $happn.info,
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
      var name = shortid();
      
      var minion = {
        name: name,
        status: 'pending',
      }

      Object.keys(data).forEach(function(key) {
        minion[key] = data[key];
      });

      _this.minions[name] = minion;

      var spawnConfig = JSON.stringify({
        name: name,
        marshal: $happn.info,
        config: minion,
      });

      var child = spawn('bin/minion_' + data.type, [spawnConfig]);

      Object.defineProperty(_this.minions[name], 'process', {
        value: child
      });

      child.on('error', function(e) {
        $happn.log.error('spawn error', e);
      });

      child.on('close', function() {

        masterExchange.destroyMinion({
          info: $happn.info,
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
        info: $happn.info,
        minion: _this.minions[name],
      })
      .catch(function(e) {
        $happn.log.error('error registering minion', e);
      })

    }),

    masterEvent.onAsync('minion/killall', function(data, meta) {
      $happn.log.info('kill all minions');
      for (var name in _this.minions) {
        $happn.log.info('kill minion \'%s\'', name);
        _this.minions[name].process.kill();
      }
    }),

    masterEvent.onAsync('minion/kill/*', function(data, meta) {
      var name = meta.path.split('/').pop();
      if (!_this.minions[name]) {
        $happn.log.warn('cannot kill no such minion: \'%s\'', name);
        return;
      };
      $happn.log.info('kill minion \'%s\'', name);
      _this.minions[name].process.kill();
    }),

  ])

  .then(function() {
    return masterExchange.registerMarshal({
      info: $happn.info,
      minions: _this.minions,
    });
  })

  .then(function(masterInfo) {
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

  minion.status = 'started';
  minion.startedAt = update.timestamp;

  this.minions[name] = minion;

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  masterExchange.updateMinion({
    info: $happn.info,
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
    info: $happn.info,
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



Marshal.prototype.minionUpdate = function($happn, name, stat, callback) {

  $happn.log.info('minion \'%s\' update stat: \'%j\'', name, stat);

  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];

  // TODO: Communicate stat/metric to master, done by call on exchange because
  //       master has no endpointing here, so this can't emit to master.

  callback();

}


Marshal.prototype.minionDone = function($happn, name, result, callback) {

  $happn.log.info('minion \'%s\' done result: \'%j\'', name, result);
  
  var masterAddress = $happn.config.master.split('/');
  var masterExchange = $happn.exchange[masterAddress[0]][masterAddress[1]];


  var minion = this.minions[name];
  minion.status = 'finished';
  minion.finishedAt = Date.now();
  minion.result = result;

  masterExchange.updateMinion({
    info: $happn.info,
    minion: minion,
  })
  .then(function() {
    callback();
  })
  .catch(function(e) {
    $happn.log.error('error updating minion (done)', e);
    callback();
  });


}
