'use strict';
var libQ = require('kew');
var libNet = require('net');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var os = require('os');
var Gpio = require('onoff').Gpio;

// Utils
var gpioPrefix = '';

module.exports = ControllerAudiophonicsOnOff;

function ControllerAudiophonicsOnOff(context)
{
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
};

ControllerAudiophonicsOnOff.prototype.onVolumioStart = function()
{
	var self = this;
	self.logger.info("Audiophonics on/off initiated");

	this.configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	self.getConf(this.configFile);

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.onVolumioReboot = function()
{
      var self = this;
      self.softShutdown.writeSync(1);
};

ControllerAudiophonicsOnOff.prototype.onVolumioShutdown = function()
{
      var self = this;
      var defer = libQ.defer();

      self.softShutdown.writeSync(1);
      setTimeout(function(){
            self.softShutdown.writeSync(0);
            defer.resolve();
          }, 1000);

      return defer;
};

ControllerAudiophonicsOnOff.prototype.getConfigurationFiles = function()
{
	return ['config.json'];
};

// Plugin methods -----------------------------------------------------------------------------
ControllerAudiophonicsOnOff.prototype.onStop = function() {
	var self = this;
	self.logger.info("performing onStop action");

	if(self.bootOk != undefined)
		self.bootOk.unexport();
	if(self.softShutdown != undefined)
		self.softShutdown.unexport();
	if(self.shutdownButton != undefined)
	{
		self.shutdownButton.unwatchAll();
		self.shutdownButton.unexport();
	}

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.stop = function() {
	var self = this;
	self.logger.info("performing stop action");

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.onStart = function() {
	var self = this;
	self.getGPIOPrefix();
	self.logger.info("Configuring GPIO pins");

	if(self.tryParse(self.config.get('soft_shutdown'), 0) != 0)
	{
		var pin_shutdown = self.getKernelAgnosticPinNumber(self.config.get('soft_shutdown'));

		self.softShutdown = new Gpio(pin_shutdown, 'out')
		self.logger.info('Soft shutdown GPIO '  +pin_shutdown +' binding... OK');
	}

	if(self.tryParse(self.config.get('shutdown_button'), 0) != 0)
	{
		var pin_button = self.getKernelAgnosticPinNumber(self.config.get('shutdown_button'));

		self.shutdownButton = new Gpio(pin_button, 'in', 'both');
		self.logger.info('Hardware button GPIO ' +pin_button +' binding... OK');
	}

	if(self.tryParse(self.config.get('boot_ok'), 0) != 0)
	{
		var pin_button_ok = self.getKernelAgnosticPinNumber(self.config.get('boot_ok'));

		self.bootOk = new Gpio(pin_button_ok, 'high');
		self.logger.info('Boot OK GPIO ' +pin_button_ok +' binding... OK');
	}

	self.shutdownButton.watch(self.hardShutdownRequest.bind(this));

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.onRestart = function()
{
	var self = this;
	self.logger.info("performing onRestart action");
};

ControllerAudiophonicsOnOff.prototype.onInstall = function()
{
	var self = this;
	self.logger.info("performing onInstall action");
};

ControllerAudiophonicsOnOff.prototype.onUninstall = function()
{
	// Perform uninstall tasks here!
	self.logger.info("performing onUninstall action");
};

ControllerAudiophonicsOnOff.prototype.getUIConfig = function() {
    var self = this;
	var defer = libQ.defer();
    var lang_code = this.commandRouter.sharedVars.get('language_code');
	self.getConf(this.configFile);
	self.logger.info("Loaded the previous config.");

	self.commandRouter.i18nJson(__dirname+'/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
    .then(function(uiconf)
    {
		self.logger.info("## populating UI...");

		// GPIO configuration
		uiconf.sections[0].content[0].value = self.config.get('soft_shutdown');
		uiconf.sections[0].content[1].value = self.config.get('shutdown_button');
		uiconf.sections[0].content[2].value = self.config.get('boot_ok');
		self.logger.info("1/1 settings loaded");

		self.logger.info("Populated config screen.");

		defer.resolve(uiconf);
	})
	.fail(function()
	{
		defer.reject(new Error());
	});

	return defer.promise;
};

ControllerAudiophonicsOnOff.prototype.setUIConfig = function(data) {
	var self = this;

	self.logger.info("Updating UI config");
	var uiconf = fs.readJsonSync(__dirname + '/UIConfig.json');

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.getConf = function(configFile) {
	var self = this;
	this.config = new (require('v-conf'))()
	this.config.loadFile(configFile)

	return libQ.resolve();
};

ControllerAudiophonicsOnOff.prototype.setConf = function(conf) {
	var self = this;
	return libQ.resolve();
};

// Public Methods ---------------------------------------------------------------------------------------
ControllerAudiophonicsOnOff.prototype.updateButtonConfig = function (data)
{
	var self = this;

	self.config.set('soft_shutdown', data['soft_shutdown']);
	self.config.set('shutdown_button', data['shutdown_button']);
	self.config.set('boot_ok', data['boot_ok']);

	self.commandRouter.pushToastMessage('success', 'Successfully saved the new configuration.');
	return libQ.resolve();
};

// Button Management
ControllerAudiophonicsOnOff.prototype.hardShutdownRequest = function(err, value) {
	var self = this;
	self.commandRouter.shutdown();
};

ControllerAudiophonicsOnOff.prototype.tryParse = function(str,defaultValue) {
     var retValue = defaultValue;
     if(str !== null) {
         if(str.length > 0) {
             if (!isNaN(str)) {
                 retValue = parseInt(str);
             }
         }
     }
     return retValue;
};

ControllerAudiophonicsOnOff.prototype.getKernelAgnosticPinNumber = function(gpioPin){
	const self = this;
	var kVer = os.release();
	var gpioNumber = parseInt(kVer.split('.')[0]) >= 6 ? parseInt(gpioPin)  + parseInt(gpioPrefix) : parseInt(gpioPin);
	return gpioNumber.toString();
}

ControllerAudiophonicsOnOff.prototype.getGPIOPrefix = function(){
	const self = this;
	try {
		gpioPrefix = execSync("ls /sys/class/gpio/ | sed 's/[^0-9 ]//g' | sed '/^$/d' | head -n 1", { uid: 1000, gid: 1000, encoding: 'utf8'});
	} catch(e) {
		self.logger.error('Error getting GPIO prefix: ' + e.toString());
	}
}
