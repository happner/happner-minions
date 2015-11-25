module.exports = Master;

var os = require('os');

function Master() {

  this.marshals = {};
  this.scripts = {};

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

  $happn.emit('marshal/created', registration);

  callback(null, this.info);

}

Master.prototype.runScript = function($happn, scriptName, opts, callback) {

  try {
    var script = require(process.cwd() + '/minions/scripts/master_' + scriptName);
    script.start(scriptName, $happn, opts, callback);
  } catch (e) {
    $happn.log.error('runScript', e);
    callback(e);
  }
}

Master.prototype.viewScript = function($happn, scriptName, opts, callback) {

  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }
  // var minions = [];
  var minions = {};
  for (var marshalName in this.marshals) {
    var marshal = this.marshals[marshalName];
    for (var minionName in marshal.minions) {
      var minion = marshal.minions[minionName];
      // if (minion.masterScript != scriptName) continue;
      // minions.push(minion);
      minions[minionName] = minion;
    }
  }
  callback(null, {
    minions: minions,
    // scripts: {}
  });
}


Master.prototype.spawnMinions = function($happn, count, opts, callback) {

  $happn.log.info('spawnMinions %j', opts);
  
  // var count = opts.count || 1;
  var marshals = Object.keys(this.marshals);

  opts = opts || {};

  opts.masterScript = opts.masterScript || 'default';
  opts.type = opts.type || 'mesh';
  opts.config = opts.type == 'mesh' ? opts.config || 'default' : null;
  opts.endpoint = opts.endpoint || 'default';
  opts.script = opts.script || 'default';

  if (marshals.length < 1) return callback(new Error('no marshals'));

  var result = {marshals: {}};

  // When spawing one at a time into multiple marshals,
  // this makes it not always spawn into the first marshal
  var lastOffset = this.lastOffset || 0;
  for (var i = lastOffset + 1; i < count + lastOffset + 1; i++) {

    var offset = i % marshals.length;
    this.lastOffset = offset;

    var next = marshals[offset];

    $happn.emit('minion/spawn/at/' + next, opts);

    result.marshals[next] = result.marshals[next] || {spawning: 0};
    result.marshals[next].spawning++;
  }
  
  callback(null, result);

}


Master.prototype.killMinions = function($happn, opts, callback) {
  opts = opts || {};
  $happn.log.info('killMinions %j', opts || {});

  $happn.emit('minion/killall');

  callback();

};

Master.prototype.killMinion = function($happn, opts, callback) {
  opts = opts || {};
  $happn.log.info('killMinion %j', opts || {});

  var name = opts;

  $happn.emit('minion/kill/' + name);

  callback();

};


Master.prototype.createMinion = function($happn, registration, callback) {

  // called by marshals when it creates a minion

  var marshalName = registration.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = registration.minion;
  var name = minion.name;

  $happn.log.info('createMinion \'%s\'', name);

  marshal.minions[name] = minion;
  callback();

}


Master.prototype.destroyMinion = function($happn, registration, callback) {

  // called by marshals when minion dies/ends/closes

  var marshalName = registration.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = registration.minion;
  var name = minion.name;

  $happn.log.info('destroyMinion \'%s\'', name);

  if (!marshal.minions[name]) {
    $happn.log.warn('cannot destroyMinion no such minion\'%s\'', name);
    return callback();
  }

  // keep error or finished in list for 7 seconds
  if (marshal.minions[name].status == 'error' || marshal.minions[name].status == 'finished') {
    setTimeout(function() {
      delete marshal.minions[name];
    }, 7000);
    return callback();
  }

  delete marshal.minions[name];
  callback();

}


Master.prototype.updateMinion = function($happn, update, callback) {

  // called by marshals when minion state changes

  var marshalName = update.info.mesh.name;
  var marshal = this.marshals[marshalName];
  var minion = update.minion;
  var name = minion.name;
  var updateTarget = marshal.minions[name];

  if (!updateTarget) {
    $happn.log.warn('cannot updateMinion no such minion\'%s\'', name);
    return callback();
  }
  
  if (updateTarget.task) {
    delete minion.task; // to not overwrite local task accumulation
  }

  $happn.log.info('updateMinion \'%s\'', name);
  

  Object.keys(minion).forEach(function(key) {
    updateTarget[key] = minion[key];
  });

  if (update.result) {
    updateTarget.task.result = update.result;
  }

  callback();

}

Master.prototype.minionStepDone = function($happn, update, callback) {

  var marshal = this.marshals[update.marshalName];
  var minion = marshal.minions[update.minionName];

  minion.task.stepsDone[update.stepName] = update.stepResult;
  minion.task.stepsRemaining--;
  callback();
}



