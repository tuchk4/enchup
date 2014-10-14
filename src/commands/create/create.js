'use strict';

var Command = require('../command'),
  exists = require('fs').existsSync,
  join = require('path').join,
  Types = require('../../utils/types'),
  Chalk = require('chalk'),
  SchemaClass = require('./schema'),
  TemplateClass = require('./templates'),
  ComponentClass = require('./component'),
  Placeholders = require('./placeholders'),
  Create = Command.extend({

    initialize: function () {
      this.initPromise();
    },

    isContinue: function () {
      return !!this.options.continue;
    },

    setComponent: function (component) {
      this.component = component;
    },

    setParameters: function (parameters) {
      this.parameters = parameters;
    },

    setTemplate: function (template) {
      this.template = template;
    },

    getComponentConfig: function (component) {
      var config = this.Schema.get(component, true),
        map,
        result = {};


      result.components = {};
      if (Types.isString(config)) {
        //result.map = Placeholders.map(map, this.parameters);

        var path = this.Schema.resolve(component);
        map = Placeholders.parse(path);

        result.components[this.component] = {
          path: path,
          template: this.template
        }
      } else if (Types.isObject(config)) {

        if (!config.hasOwnProperty('map') || !config.hasOwnProperty('components')) {
          throw new Error('For complex components "map" and "components" should be defined');
        }

        map = config.map.split(':');
        result.map = Placeholders.map(map, this.parameters);

        var components = config.components;
        for (var name in components) {
          if (components.hasOwnProperty(name)) {
            result.components[name] = {
              path: this.Schema.resolve(name),
              template: components[name]
            }
          }
        }
      } else {
        throw new Error('Component config could be only string or object');
      }


      return result;
    },

    placeholders: function () {
      var config = this.Schema.get(this.component, true),
        map,
        provide = {};

      if (Types.isString(config)) {
        var path = this.Schema.resolve(this.component);
        map = Placeholders.parse(path);

      } else if (Types.isObject(config)) {
        map = config.map.split(':');

        if (config.hasOwnProperty('provide')) {
          provide = config.provide;
        }
      }

      var placeholders = Placeholders.map(map, this.parameters);

      for (var item in provide) {
        if (provide.hasOwnProperty(item)) {
          var value = provide[item];
          if (value[0] == ':') {
            value = placeholders[value.slice(1)];
          }

          placeholders[item] = value;
        }
      }

      return placeholders;
    },

    components: function (placeholders) {
      var config = this.Schema.get(this.component, true),
        components = {};

      if (Types.isString(config)) {
        components[this.component] = {
          path: this.Schema.compile(this.component, placeholders),
          template: this.template
        };

      } else if (Types.isObject(config)) {

        for (var name in config.components) {
          if (config.components.hasOwnProperty(name)) {
            components[name] = {
              path: this.Schema.compile(name, placeholders),
              template: config.components[name]
            }
          }
        }
      }

      return {
        placeholders: placeholders,
        components: components
      }
    },

    merge: function (config) {
      var parameters = config.placeholders;

      if (this.config.app.parameters) {
        for (var key in this.config.app.parameters) {
          if (this.config.app.parameters.hasOwnProperty(key)) {
            parameters[key] = this.config.app.parameters[key];
          }
        }
      }


      parameters.date = new Date()
        .toISOString()
        .replace(/T/, ' ')
        .replace(/\..+/, '');

      config.parameters = parameters;


      return config;
    },


    exec: function () {
      this.Schema = new SchemaClass(this.config.app.components);
      this.Template = new TemplateClass(this.config);

      if (this.isForce() && this.isContinue()) {
        throw new Error('Force and Continue flags could not be used at same time');
      }

      return this.flow()
        .then(this.placeholders.bind(this))
        .then(this.components.bind(this))
        .then(this.merge.bind(this))
        .then(this.create.bind(this));
    },

    create: function (config) {
      var components = config.components,
        parameters = config.parameters;

      for (var name in  components) {
        if (components.hasOwnProperty(name)) {

          var local = components[name],
            Component = new ComponentClass(name);

          Component.setTemplate(local.template);
          Component.setPath(local.path);

          var script = join(this.config.scripts, Component.name + '.js');

          if (exists(script)) {
            Component.setPostScript(script);
          }


          var template = this.Template.compile(Component, parameters),
            ok = false;

          Component.setSource(template);

          if (Component.exists()) {
            if (this.isForce()) {
              Component.remove();
              ok = true;
            } else if (!this.isContinue()) {
              throw new Error('You should describe force or continue flag for existing files');
            }
          } else {
            ok = true;
          }

          if (ok) {
            Component.save();
            this.log(Component);
          }
        }
      }
    },

    /**
     * TODO: REFACTOR LOGGING!!
     */
    log: function (Component) {
      var c = Chalk.cyan,
        y = Chalk.yellow,
        u = Chalk.white.underline,
        b = Chalk.blue,
        log = console.log,
        template = Component.template,
        templatePath = this.Template.path(Component);

      if (!template) {
        if (!Component.source.length) {
          template = 'empty';
        } else {
          template = 'default';
        }
      }

      var l = [
        ('Component created:' + ' ' + Component.name + ' ' + 'at path:' + ' ' + Component.path).length + 6,
        ('Using' + ' ' + template + ' ' + 'template' + ' ' + 'at:' + ' ' + templatePath).length + 6
      ];

      var max = Math.max.apply(null, l);

      function repeat(pattern, count) {
        if (count < 1) return '';
        var result = '';
        while (count > 1) {
          if (count & 1) result += pattern;
          count >>= 1, pattern += pattern;
        }
        return result + pattern;
      }

      log(b('   +') + b(repeat('-', max)) + b('+'));
      log(b('   |   ') + c('Component created:') + ' ' + u(Component.name) + ' ' + c('at path:') + ' ' + u(Component.path) + repeat(' ', max - l[0]) + b('   |'));

      if (!!templatePath) {
        log(y('   |   ') + c('Using') + ' ' + u(template) + ' ' + c('template') + ' ' + c('at:') + ' ' + u(templatePath) + repeat(' ', max - l[1]) + y('   |'));
      } else {
        log(y('   |   ') + c('Created without template because template was not found') + repeat(' ', max - 'Created without template because template was not found'.length) + y('   |'));
      }

      log(y('   +') + y(repeat('-', max)) + y('+'));
    }
  });

module.exports = Create;