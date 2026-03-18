koad.utils = {};

/**
 * Assert that the given condition is truthy and throw an error if not.
 */

koad.utils.assert = function (condition, msg) {
  if (!condition)
    throw new Error(msg);
};

/**
 * Print a warning message to the console if the console is defined.
 */
koad.utils.warn = function (condition, msg) {
  if (!condition)
    console && console.warn && console.warn(msg);
};

/**
 * Given a target object and a property name, if the value of that property is
 * undefined, set a default value and return it. If the value is already
 * defined, return the existing value.
 */
koad.utils.defaultValue = function (target, prop, value) {
  if (typeof target[prop] === 'undefined') {
    target[prop] = value;
    return value;
  } else {
    return target[prop]
  }
};

/**
 * Make one constructor function inherit from another. Optionally provide
 * prototype properties for the child.
 *
 * @param {Function} Child The child constructor function.
 * @param {Function} Parent The parent constructor function.
 * @param {Object} [props] Prototype properties to add to the child
 */
koad.utils.inherits = function (Child, Parent, props) {
  koad.utils.assert(typeof Child !== "undefined", "Child is undefined in inherits function");
  koad.utils.assert(typeof Parent !== "undefined", "Parent is undefined in inherits function");

  // copy static fields
  for (var key in Parent) {
    if (_.has(Parent, key))
      Child[key] = EJSON.clone(Parent[key]);
  }

  var Middle = function () {
    this.constructor = Child;
  };

  // hook up the proto chain
  Middle.prototype = Parent.prototype;
  Child.prototype = new Middle;
  Child.__super__ = Parent.prototype;

  // copy over the prototype props
  if (_.isObject(props))
    _.extend(Child.prototype, props);

  return Child;
};

/**
 * Create a new constructor function that inherits from Parent and copy in the
 * provided prototype properties.
 *
 * @param {Function} Parent The parent constructor function.
 * @param {Object} [props] Prototype properties to add to the child
 */
koad.utils.extend = function (Parent, props) {
  props = props || {};

  var ctor = function () {
    // automatically call the parent constructor if a new one
    // isn't provided.
    var constructor;
    if (_.has(props, 'constructor'))
      constructor = props.constructor
    else
      constructor = ctor.__super__.constructor;

    constructor.apply(this, arguments);
  };

  return koad.utils.inherits(ctor, Parent, props);
};

/**
 * Either window in the browser or global in NodeJS.
 */
koad.utils.global = (function () {
  return Meteor.isClient ? window : global;
})();

/**
 * Ensure a given namespace exists and assign it to the given value or
 * return the existing value.
 */
koad.utils.namespace = function (namespace, value) {
  var global = koad.utils.global;
  var parts;
  var part;
  var name;
  var ptr;

  koad.utils.assert(typeof namespace === 'string', "namespace must be a string");

  parts = namespace.split('.');
  name = parts.pop();
  ptr = global;

  for (var i = 0; i < parts.length; i++) {
    part = parts[i];
    ptr = ptr[part] = ptr[part] || {};
  }

  if (arguments.length === 2) {
    ptr[name] = value;
    return value;
  } else {
    return ptr[name];
  }
};

/**
 * Returns the resolved value at the given namespace or the value itself if it's
 * not a string.
 *
 * Example:
 *
 * var koad = {};
 * koad.foo = {};
 *
 * var baz = koad.foo.baz = {};
 * koad.utils.resolve("koad.foo.baz") === baz
 */
koad.utils.resolve = function (nameOrValue) {
  var global = koad.utils.global;
  var parts;
  var ptr;

  if (typeof nameOrValue === 'string') {
    parts = nameOrValue.split('.');
    ptr = global;
    for (var i = 0; i < parts.length; i++) {
      ptr = ptr[parts[i]];
      if (!ptr)
        return undefined;
    }
  } else {
    ptr = nameOrValue;
  }

  // final position of ptr should be the resolved value
  return ptr;
};

/**
 * Capitalize a string.
 */
koad.utils.capitalize = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1, str.length);
};

/**
 * Convert a string to class case.
 */
koad.utils.classCase = function (str) {
  var re = /_|-|\.|\//;

  if (!str)
    return '';

  return _.map(str.split(re), function (word) {
    return koad.utils.capitalize(word);
  }).join('');
};

/**
 * Convert a string to camel case.
 */
koad.utils.camelCase = function (str) {
  var output = koad.utils.classCase(str);
  output = output.charAt(0).toLowerCase() + output.slice(1, output.length);
  return output;
};

/**
 * deprecatation notice to the user which can be a string or object
 * of the form:
 *
 * {
 *  name: 'somePropertyOrMethod',
 *  where: 'RouteController',
 *  instead: 'someOtherPropertyOrMethod',
 *  message: ':name is deprecated. Please use :instead instead'
 * }
 */
koad.utils.notifyDeprecated = function (info) {
  var name;
  var instead;
  var message;
  var where;
  var defaultMessage = "[:where] ':name' is deprecated. Please use ':instead' instead.";

  if (_.isObject(info)) {
    name = info.name;
    instead = info.instead;
    message = info.message || defaultMessage;
    where = info.where || 'koadRouter';
  } else {
    message = info;
    name = '';
    instead = '';
    where = '';
  }

  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      '<deprecated> ' +
      message
      .replace(':name', name)
      .replace(':instead', instead)
      .replace(':where', where) +
      ' ' +
      (new Error).stack
    );
  }
};

koad.utils.withDeprecatedNotice = function (info, fn, thisArg) {
  return function () {
    Utils.notifyDeprecated(info);
    return fn && fn.apply(thisArg || this, arguments);
  };
};

// so we can do this:
//   getController: function () {
//    ...
//   }.deprecate({...})
Function.prototype.deprecate = function (info) {
  var fn = this;
  return koad.utils.withDeprecatedNotice(info, fn);
};

/**
 * Returns a function that can be used to log debug messages for a given
 * package.
 */
koad.utils.debug = function (package) {
  koad.utils.assert(typeof package === 'string', "debug requires a package name");

  return function debug (/* args */) {
    if (console && console.log && koad.debug === true) {
      var msg = _.toArray(arguments).join(' ');
      console.log("%c<" + package + "> %c" + msg, "color: #999;", "color: #000;");
    }
  };
};

/*
 * Meteor's version of this function is broke.
 */
koad.utils.get = function (obj /*, arguments */) {
  for (var i = 1; i < arguments.length; i++) {
    if (!obj || !(arguments[i] in obj))
      return undefined;
    obj = obj[arguments[i]];
  }
  return obj;
};

// make sure koad ends up in the global namespace
koad.utils.global.koad = koad;
