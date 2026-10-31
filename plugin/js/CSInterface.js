function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
    if (!window.__adobe_cep__) {
        if (callback) callback("ERR Illustrator-Erweiterung nicht geladen");
        return;
    }
    window.__adobe_cep__.evalScript(script, callback || function () {});
};

CSInterface.prototype.getSystemPath = function (pathType) {
    return window.__adobe_cep__.getSystemPath(pathType);
};
