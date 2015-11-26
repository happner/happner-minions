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
        // (point to remote happner-minions.Server instance)
        master: 'master/happner-minions',

        // which scriptsName/minionType/limit can this marshal spawn
        abilities: {
          // scriptName: {
          //   mesh: { // minion type, see ./bin
          //     limit: 1 // how many to allow
          //   },
          //   client : {
          //     limit: 1
          //   },
          //   none: : {
          //     limit: 1
          //   }
          // }
        }
      }
    }
  }
}
