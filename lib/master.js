module.exports = Master;

var os = require('os');
var shortid = require('shortid');

function Master() {

  this.marshals = {};
  this.limits = {};
  this.spawning = {};

  this.info = {
    process: os.hostname() + '/' + process.pid
  };

}

Master.prototype.start = function($happn, callback) {

  var _this = this;

  $happn._mesh.datalayer.events.on('attach', function(ev) {
    // console.log('attached', JSON.stringify(ev, null, 2));
  });

  $happn._mesh.datalayer.events.on('detatch', function(ev) {
    // console.log('detatched', JSON.stringify(ev, null, 2));

    if (ev.info._browser) return;

    var name;

    try { 
      name = ev.info.mesh.name;
    } catch (e) {
      $happn.log.error('detatch without name', e);
      return;
    }

    if (_this.marshals[name]) {
      $happn.emit('marshal/destroyed', _this.marshals[name]);
      delete _this.marshals[name];
    }

  });

  setInterval(function() {

    // marshals listen to this
    // - if it goes silent they do nothing
    // - if it resumes (from same master) they do nothing
    // - if it resumes (from new master) they re-register

    $happn.emit('keepalive', {
      master: _this.info
    });

  }, 1000);
  
  callback();

}


Master.prototype.registerMarshal = function($happn, registration, callback) {

  // called by marshals when they start or detect new master

  $happn.log.info('registering marshal \'%s\'', registration.info.mesh.name);

  var name = registration.info.mesh.name;
  this.marshals[name] = registration;
  this.marshals[name].minions = this.marshals[name].minions || {};
  this.limits[name] = registration.abilities;

  $happn.emit('marshal/created', registration);

  callback(null, this.info);

}

Master.prototype.loadScript = function($happn, scriptName, opts, callback) {

  try {
    var script = require(process.cwd() + '/minions/scripts/master_' + scriptName);
    script.load(scriptName, $happn, opts, callback);
  } catch (e) {
    $happn.log.error('runScript', e);
    callback(e);
  }
}

Master.prototype.startScript = function($happn, opts, callback) {
  opts = opts || {};
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }
  opts.status = 'ready'; // only start ready minions

  var now = Date.now();

  this.listMinions($happn, opts, function(e, minions) {
    if (e) return callback(e);
    var started = [];
    for (var name in minions) {
      started.push(name);
      $happn.emit('minion/start/' + name);
      minions[name].status = 'started';
      minions[name].startedAt = now;
    }
    
    if (started.length > 0) {
      callback(null, {tag: opts.tag, startedAt: now, names: started});
      $happn.emit('minions/start', {tag: opts.tag, startedAt: now, names: started});
      return;
    }
    callback();
  });
}

Master.prototype.viewScript = function($happn, opts, callback) {
  opts = opts || {};
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }
  // var minions = [];
  var tasksArray = [];
  this.listMinions($happn, opts, function(e, minions) {
    if (e) return callback(e);
    var minionStats = {
      pending: [],
      done: [],
    }
    var stepStats = {
      pending: 0,
      done: 0,
    }
    for (var minionName in minions) {
      var minion = minions[minionName];
      var task = minion.task;

      stepStats.pending += task.stepsRemaining;
      for (var step in task.stepsDone) {
        stepStats.done++;
      }
      if (task.stepsRemaining == 0) {
        minionStats.done.push(minionName);
      }
      else {
        minionStats.pending.push(minionName);
      }

      tasksArray.push(JSON.parse(JSON.stringify(minion.task)));
      minion.task.minionName = minionName;
    }
    return callback(null, {
      tasks: tasksArray,
      minions: minionStats,
      steps: stepStats
    });
  });
}

Master.prototype.resetScript = function($happn, opts, callback) {
  opts = opts || {};
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }
  var resetOpts = opts.opts;
  delete opts.opts; // move out of search filter
  var now = Date.now();
  this.listMinions($happn, opts, function(e, minions) {
    if (e) return callback(e);
    var resetted = [];
    for (var name in minions) {
      resetted.push(name);
      $happn.emit('minion/reset/' + name, resetOpts);
      minions[name].status = 'resetting';
      minions[name].resetAt = now;
    }
    callback(null, {tag: opts.tag, resetAt: now, names: resetted});
  });
  
}


Master.prototype.spawnMinions = function($happn, count, opts, callback) {

  $happn.log.$$DEBUG('spawnMinions %j', opts);
  
  // var count = opts.count || 1;
  var marshals = Object.keys(this.marshals);
  if (marshals.length < 1) return callback(new Error('no marshals'));

  opts = opts || {};
  opts.tag = opts.tag || shortid.generate();
  opts.masterScript = opts.masterScript || 'default';
  opts.type = opts.type || 'mesh';
  opts.config = opts.type == 'mesh' ? opts.config || 'default' : null;
  opts.script = opts.script || 'default';

  if (opts.spreads) {
    Object.keys(opts.spreads).forEach(function(key) {
      var array = opts.spreads[key];
      var offset = 0;
      // define value at opts[key] to cycle through spread
      Object.defineProperty(opts, key, {
        get: function() {
          var next = array[offset];
          offset++;
          if (offset >= array.length) offset = 0;
          return next;
        },
        enumerable: true
      });
    });
  }

  delete opts.spreads;

  var spawnRef = opts.spawnRef = opts.spawnRef || shortid.generate();
  var spawning = this.spawning[spawnRef] = this.spawning[spawnRef] || {};
  spawning = spawning[opts.tag] = spawning[opts.tag] || {};

  var result = {
    REACHED_CAPACITY: false,
    label: opts.label,
    tag: opts.tag,
    spawnRef: spawnRef,
    count: 0
  };

  // When spawing one at a time into multiple marshals,
  // this makes it not always spawn into the first marshal
  var lastOffset = this.lastOffset || 0;
  // skip minions at capacity (ability)
  var skip = 0;
  var skipSpan = 0;
  var atCapacity = false;
  for (var i = lastOffset + 1; i < count + lastOffset + 1; i++) {

    var offset = (i + skip) % marshals.length;
    this.lastOffset = offset;

    var nextMarshal = marshals[offset];
    var can = false;

    try {
      can = this.limits[nextMarshal][opts.script][opts.type];
      if (!can) throw new Error('cannot');
    } catch (e) {
      $happn.log.$$DEBUG('marshal \'%s\' has no ability %s:%s', nextMarshal, opts.script, opts.type);
      skip++;
      skipSpan++;
      if (skipSpan >= marshals.length) {
        result.REACHED_CAPACITY = true;
        break;
      }
      i--;
      continue;
    }

    if (can.running >= can.limit) {
      $happn.log.$$DEBUG('marshal \'%s\' at limit of ability %s:%s', nextMarshal, opts.script, opts.type);
      skip++;
      skipSpan++;
      if (skipSpan >= marshals.length) {
        result.REACHED_CAPACITY = true;
        break;
      }
      i--;
      continue;
    }

    can.running++;
    skipSpan = 0;

    $happn.emit('minion/spawn/at/' + nextMarshal, opts);
    $happn.log.$$DEBUG('spawn at %s', nextMarshal);

    result.count++;
    spawning[nextMarshal] = spawning[nextMarshal] || {count: 0};
    spawning[nextMarshal].count++;
  }
  
  callback(null, result);

}

Master.prototype.listMarshals = function($happn, callback) {
  callback(null, this.marshals);
}

Master.prototype.listMinions = function($happn, opts, callback) {
  opts = opts || {};
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }

  var list = {};
  for (var marshalName in this.marshals) {
    var marshal = this.marshals[marshalName];
    for (var minionName in marshal.minions) {
      var minion = marshal.minions[minionName];
      
      // filter
      var match = true;
      for(var key in opts) {
        if (minion[key] != opts[key]) match = false;
      }
      if (!match) continue;

      list[minionName] = minion;
    }
  }

  callback(null, list);
}


Master.prototype.killMinions = function($happn, opts, callback) {
  opts = opts || {};
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }

  $happn.log.$$DEBUG('killMinions %j', opts);

  $happn.emit('minion/killall', opts);

  callback();

};

Master.prototype.killMinion = function($happn, name, callback) {
  if (typeof name == 'function') {
    callback(new Error('missing name'));
    return;
  }
  $happn.log.$$DEBUG('killMinion %s', name);

  $happn.emit('minion/kill/' + name);

  callback();

};


Master.prototype.createMinion = function($happn, registration, callback) {

  // called by marshals when it creates a minion

  var marshalName = registration.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = registration.minion;
  var name = minion.name;

  $happn.log.$$DEBUG('createMinion \'%s\'', name);

  marshal.minions[name] = minion;
  callback();

}


Master.prototype.destroyMinion = function($happn, registration, callback) {

  // called by marshals when minion dies/ends/closes

  var marshalName = registration.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = registration.minion;
  var name = minion.name;

  $happn.log.$$DEBUG('destroyMinion \'%s\'', name);

  if (!marshal.minions[name]) {
    $happn.log.warn('cannot destroyMinion no such minion\'%s\'', name);
    return callback();
  }

  try {
    this.limits[marshalName][minion.script][minion.type].running--;
  } catch (e) {
    $happn.log.warn('error decrementing runningcount', e);
  }

  // // keep error or finished in list for 7 seconds
  // if (marshal.minions[name].status == 'error' || marshal.minions[name].status == 'finished') {
  //   setTimeout(function() {
  //     delete marshal.minions[name];
  //   }, 7000);
  //   return callback();
  // }

  delete marshal.minions[name];
  callback();

}


Master.prototype.updateMinion = function($happn, update, callback) {

  // called by marshals when minion state changes

  var _this = this;
  var marshalName = update.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = update.minion;
  var name = minion.name;
  var updateTarget = marshal.minions[name];
  var spawning;

  if (!updateTarget) {
    $happn.log.warn('cannot updateMinion no such minion\'%s\'', name);
    return callback();
  }
  
  if (updateTarget.task) {
    delete minion.task; // to not overwrite local task accumulation
  }

  $happn.log.$$DEBUG('updateMinion \'%s\'', name);
  
  Object.keys(minion).forEach(function(key) {
    updateTarget[key] = minion[key];
  });

  if (update.result) {
    updateTarget.task.result = update.result;
  }

  if (minion.error) {
    return $happn.emit('error', {
      type: 'minion error',
      error: minion.error,
      object: minion
    });
  }

  if (minion.status == 'ready') {
    var spawning = this.spawning[minion.spawnRef][minion.tag][marshalName];
    spawning.count--;
    if (spawning.count == 0) {

      this.pendingSpawnMinions($happn, minion.spawnRef, function(e, result) {
        if (result.count > 0) return;

        _this.listMinions($happn, {tag: minion.tag, type: minion.type}, function(e, result) {
          $happn.emit('minions/ready', {
            spawnRef: minion.spawnRef,
            label: minion.label,
            names: Object.keys(result),
            tag: minion.tag,
            type: minion.type,
            script: minion.script,
            config: minion.config,
          });
        });
      });
    }
  }

  if (minion.status == 'done') {
    $happn.emit('minion/done', minion);
    _this.listMinions($happn, {tag: minion.tag}, function(e, minions) {
      var done = true;
      for (var name in minions) {
        if (minions[name].status != 'done') {
          done = false;
          break;
        }
      }
      if (done) {
        $happn.emit('minions/done', {tag: minion.tag, endedAt: Date.now()});
      }
    });
  }

  callback();
}

Master.prototype.pendingSpawnMinions = function($happn, spawnRef, callback) {
  var refs = this.spawning[spawnRef];
  var result = {count: 0};
  try {
    for (var ref in refs) {
      var marshals = refs[ref];
      for (var marshalName in marshals) {
        var pending = marshals[marshalName];
        if (pending) {
          result.count += pending.count;
          result.marshals = result.marshals || {};
          result.marshals[marshalName] = pending;
        }
      }
    }
    return callback(null, result);
  } catch (e) {
    return callback(e);
  }
}

Master.prototype.minionResetDone = function($happn, update, callback) {

  var _this = this;
  var marshal = this.marshals[update.marshalName];
  var minion = marshal.minions[update.minionName];

  minion.status = 'ready';
  minion.resetResult = update.resetResult;

  Object.keys(minion.task.stepsDone).forEach(function(stepName) {
    delete minion.task.stepsDone[stepName];
    minion.task.stepsRemaining++;
  });

  this.pendingResetMinions($happn, {tag: minion.tag, type: minion.type}, function(e, result) {
    if (result.pending > 0) return;

    _this.listMinions($happn, {tag: minion.tag, type: minion.type, status: 'ready'}, function(e, minions) {
      $happn.emit('minions/reset', {
        ready: result.ready,
        label: minion.label,
        names: Object.keys(minions),
        tag: minion.tag,
        type: minion.type,
        script: minion.script,
        config: minion.config,
      });
    });

  });
  callback();
}

Master.prototype.pendingResetMinions = function($happn, opts, callback) {
  this.listMinions($happn, opts, function(e, minions) {
    if (e) return callback(e);
    var pending = 0;
    var ready = 0;
    for (var name in minions) {
      var minion = minions[name];
      if (minion.status == 'resetting') pending++;
      if (minion.status == 'ready') ready++;
    }
    callback(null, {pending: pending, ready: ready});
  });
}


Master.prototype.minionStepDone = function($happn, update, callback) {

  var marshal = this.marshals[update.marshalName];
  var minion = marshal.minions[update.minionName];

  minion.task.stepsDone[update.stepName] = update.stepResult;
  minion.task.stepsRemaining--;
  callback();
}


Master.prototype.minionStarted = function($happn, update, callback) {

  var marshal = this.marshals[update.marshalName];
  var minion = marshal.minions[update.minionName];

  minion.task.startedAt = update.info.startedAt;
  callback();
}



