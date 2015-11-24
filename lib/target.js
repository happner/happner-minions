module.exports = Target;

function Target() {

}

Target.prototype.getStats = function($happn, callback) {
  callback(null, {stats: 1});
}
