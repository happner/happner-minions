# happner-minions

Control scripted minion nodes.

### Usage

* Server and Marshal.
* Server informs Marshal to spawn and kill minions.
* Server provides config for minions.

#### Server

Server controls marshals.

##### Config

```javascript
meshConfig = {
  modules: {
    'controller': {
      path: 'happner-minions.Server'
    }
  },
  components: {
    'controller': {}
  }
}
```

#### Marshal

Marshal spawns minions.

##### Config

```javascript
meshConfig = {
  endpoints: {
    'master': {
      // configure enpoint to happner-minions.Server instance
    }
  }
  modules: {
    'controller': {
      path: 'happner-minions.Marshal'
    }
  },
  components: {
    'controller': {
      // endpoint/componentName
      // (point to remote controller.Server instance)
      master: 'master/controller'
    }
  }
}
```
