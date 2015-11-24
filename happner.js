module.exports.configs = {


  'master': {
    module: {
      name: 'happner-minions',
      config: {
        path: 'happner-minions.Master'
      }
    },
    component: {
      name: 'happner-minions',
      config: {
        module: 'happner-minions',
        accessLevel: 'mesh',
        startMethod: 'start',
        web: {
          routes: {
            static: 'browser'
          }
        }
      }
    }
  },


  'marshal': {
    module: {
      name: 'happner-minions',
      config: {
        path: 'happner-minions.Marshal'
      }
    },
    component: {
      name: 'happner-minions',
      config: {
        module: 'happner-minions',
        accessLevel: 'mesh',
        startMethod: 'start',
        // master: 'endpoint/componentName'
        // (point to remote controller.Server instance)
        master: 'master/happner-minions',
      }
    }
  }
}
