/*
 *
 * Copyright 2013 Canonical Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
*/

/* jshint node:true, bitwise:true, undef:true, trailing:true, quotmark:true,
          indent:4, unused:vars, latedef:nofunc,
          sub:true
*/

var fs            = require('fs'),
    path          = require('path'),
    util          = require('../util'),
    shell         = require('shelljs'),
    Q             = require('q'),
    os            = require('os'),
    ConfigParser  = require('../../configparser/ConfigParser');

module.exports = function(project) {
    this.path = project;
    this.manifest = path.join(this.path, 'manifest.json');
    this.desktop = path.join(this.path, 'cordova.desktop');
    this.apparmor = path.join(this.path, 'apparmor.json');
};

function sanitize(str) {
    return str.replace(/\n/g, ' ').replace(/^\s+|\s+$/g, '');
}

module.exports.prototype = {
    // Returns a promise.
    update_from_config: function(config) {
        if (config instanceof ConfigParser) {
        } else {
            return Q.reject(new Error('update_from_config requires a ConfigParser object'));
        }
        
        var nodearch2debarch = { 
            'arm': 'armhf',
            'ia32': 'i386',
            'x64': 'amd64'
        };

        var arch;
        if (os.arch() in nodearch2debarch) {
            arch = nodearch2debarch[os.arch()];
        } else {
            return Q.reject(new Error('Unknown CPU architecture.'));
        }

        if (!config.author()) {
            return Q.reject(new Error('Could not find the author tag in config.xml.'));
        }

        var manifest = {};

        // Load existing manifest if it exists to update it.
        if (fs.existsSync(this.manifest)) {
            manifest = JSON.parse(fs.readFileSync(this.manifest));
        }

        manifest.name = config.packageName();
        manifest.version = config.version();
        manifest.title = config.name();
        manifest.author = sanitize(config.author());
        manifest.maintainer = sanitize(config.author())  + ' <' + config.doc.find('author').attrib.email + '>';
        manifest.description = sanitize(config.description());
        manifest.architecture = arch;
        manifest.framework = manifest.framework || 'ubuntu-sdk-13.10';
        manifest.hooks = {
            cordova: {
                desktop: 'cordova.desktop',
                apparmor: 'apparmor.json'
            }
        };

        var desktopContent = [
            '[Desktop Entry]',
            'Name=' + sanitize(config.name()),
            'Exec=./cordova-ubuntu www/',
            'Terminal=false',
            'Type=Application',
            'X-Ubuntu-Touch=true'
        ];

        // An icon must be set for the application to run.
        var iconNode = config.doc.find('icon');
        var iconPath;
        if (iconNode && iconNode.attrib.src) {
            iconPath = path.join(this.path, iconNode.attrib.src);
        }

        if (!iconPath || !fs.existsSync(iconPath)) {
            if (!iconPath) {
            console.warn('Icon not defined in config.xml.');
            } else {
            console.warn('Cannot find icon at : ', iconPath);
            }
            desktopContent.push('Icon=qmlscene');
        } else {
            desktopContent.push('Icon=' + iconNode.attrib.src);
        }

        // Add additional policies used by features in config.xml
        var policyGroups = ['networking', 'audio'];
        var features = config.doc.getroot().findall('./feature/param');
        var policyGroup;
        features.forEach(function (feature) {
            policyGroup = feature.attrib.policy_group;
            if (policyGroup && policyGroups.indexOf(policyGroup) === -1) {
                policyGroups.push(policyGroup);
            }
        });

        var apparmor = {
            policy_groups: policyGroups,
            policy_version: 1.2
        };

        // Write all the files.
        fs.writeFileSync(this.manifest, JSON.stringify(manifest, null, 4));
        fs.writeFileSync(this.desktop, desktopContent.join('\n'));
        fs.writeFileSync(this.apparmor, JSON.stringify(apparmor, null, 4));

        return Q();
    },

    cordovajs_path: function(libDir) {
        var jsPath = path.join(libDir, 'www', 'cordova.js');
        return path.resolve(jsPath);
    },

    config_xml: function(){
        return path.join(this.path, 'config.xml');
    },

    www_dir: function() {
        return path.join(this.path, 'www');
    },

    update_www: function() {
        var projectRoot = util.isCordova(this.path);
        var www = util.projectWww(projectRoot);
        var platform_www = path.join(this.path, 'platform_www');

        shell.rm('-rf', this.www_dir());
        shell.mkdir(this.www_dir());

        // Copy over all www assets
        shell.cp('-rf', path.join(www, '*'), this.www_dir());
        // Copy over all stock platform www assets (ie. cordova.js)
        shell.cp('-rf', path.join(platform_www, '*'), this.www_dir());
    },

    update_overrides: function() {
        var projectRoot = util.isCordova(this.path);
        var mergesPath = path.join(util.appDir(projectRoot), 'merges', 'ubuntu');
        if (fs.existsSync(mergesPath)) {
            var overrides = path.join(mergesPath, '*');
            shell.cp('-rf', overrides, this.www_dir());
        }
    },

    // Returns a promise.
    update_project: function(cfg) {
        var self = this;

        return this.update_from_config(cfg)
        .then(function() {
            self.update_overrides();
            util.deleteSvnFolders(self.www_dir());
        });
    }
};
