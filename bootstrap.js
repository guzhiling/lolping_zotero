/* global Services, Zotero, PingWheel */
var PingWheel;

function install() {}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + 'pingwheel.js');
  PingWheel.init({ id, version, rootURI });
  try {
    Zotero.PreferencePanes.register({
      pluginID: id,
      src: rootURI + 'prefs.xhtml',
      label: 'Ping Wheel',
      image: rootURI + 'icon.png',
    });
  } catch (e) {
    Zotero.logError(e);
  }
}

function onMainWindowLoad() {}
function onMainWindowUnload() {}

function shutdown() {
  if (PingWheel) PingWheel.shutdown();
  PingWheel = undefined;
}

function uninstall() {}
