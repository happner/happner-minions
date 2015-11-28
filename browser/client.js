// window.LOG_LEVEL = 'debug';

var credentials = {
  username: localStorage.username,
  password: localStorage.password,
};

var client = window.client = new MeshClient();

var start = function() {
  document.body.innerHTML = '';

  client.event['happner-minions'].on('notify', function(info) {
    console.log('NOTIFY:', info.message, info.info || '');
  });

  client.event['happner-minions'].on('error', function(info) {
    console.error(info.type, info.error, info.object);
  });

  window.listMarshals = function() {
    client.exchange['happner-minions'].listMarshals()
    .then(function(result) {
      console.log('listMarshals result:', result);
    })
    .catch(function(e) {
      console.error(e);
    });
  }

  window.listMinions = function(opts) {
    client.exchange['happner-minions'].listMinions(opts)
    .then(function(result) {
      console.log('listMinions result:', result);
    })
    .catch(function(e) {
      console.error(e);
    });
  }

  window.killMinions = function(opts) {
    client.exchange['happner-minions'].killMinions(opts)
    .then(function(result) {
      console.log('killMinions result:', result);
    })
    .catch(function(e) {
    console.error(e);
    }); 
  }

  window.killMinion = function(name) {
    client.exchange['happner-minions'].killMinion(name)
    .then(function(result) {
      console.log('killMinion result:', result);
    })
    .catch(function(e) {
      console.error(e);
    }); 
  }

  window.loadScript = function(scriptName, opts) {
    client.exchange['happner-minions'].loadScript(scriptName, opts)
    .then(function(result) {
      console.log('loadScript result:', result);
    })
    .catch(function(e) {
      console.error(e);
    });
  }

  window.startScript = function(opts) {
    client.exchange['happner-minions'].startScript(opts)
    .then(function(result) {
      console.log('startScript result:', result);
    })
    .catch(function(e) {
      console.error(e);
    });
  }

  window.viewScript = function(opts) {
    client.exchange['happner-minions'].viewScript(opts)
    .then(function(result) {
      var minionsDone = result.minions.done.length;
      var minionsPending = result.minions.pending.length;
      var minionsTotal = minionsDone + minionsPending;

      var stepsDone = result.steps.done;
      var stepsPending = result.steps.pending;
      var stepsTotal = stepsDone + stepsPending;

      console.log(
        'viewScript result minions %d/%d, steps %d/%d\n',
        minionsDone,
        minionsTotal,
        stepsDone,
        stepsTotal,
        result

      );
    })
    .catch(function(e) {
      console.error(e);
    });
  }

  window.resetScript = function(opts) {
    client.exchange['happner-minions'].resetScript(opts)
    .then(function(result) {
      console.log('resetScript result:', result);
    })
    .catch(function(e) {
      console.error(e);
    });
  }
}

var error = function(e) {
  document.body.innerHTML = 
    '<h4>' + e.message + '</h4>' +
    'In javascript console...' +
    '<p style="font-family: courier; font-size: small">' +
    'localStorage.username = \'yours\';<br/>' +
    'localStorage.password = \'yours\';</p>' +
    '...then refresh page.';
}

client.login(credentials).then(start).catch(error);
