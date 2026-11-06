(function () {
    var files = {};
    files["C:/Users/Leon/Downloads/doublecut/history.json"] = JSON.stringify([
        {
            id: "1",
            at: "2026-11-06T14:13:26.000Z",
            note: "Karton",
            host: "192.168.0.200",
            port: "8080",
            count: 8,
            job: {
                paths: [
                    {
                        holder: "left",
                        mode: "cut",
                        force: 5,
                        cut_speed: 1,
                        travel_speed: 200,
                        passes: 4,
                        layer: "Left F5",
                        rgb: [216, 87, 255],
                        blade_offset_mm: 0.4,
                        cut_depth: 7,
                        stay_down: true
                    }
                ]
            }
        }
    ]);
    files["C:/Users/Leon/Downloads/doublecut/configurations.json"] = "[]";
    files["C:/Users/Leon/Downloads/doublecut/colors.json"] = "[]";
    files["C:/Users/Leon/Downloads/doublecut/connection.json"] = JSON.stringify({
        host: "192.168.0.200",
        port: "8080",
        marked: "0"
    });
    files["C:/temp/job.json"] = JSON.stringify({
        paths: [
            {
                holder: "left",
                mode: "cut",
                force: 9,
                cut_speed: 10,
                travel_speed: 20,
                passes: 1,
                layer: "Left F9",
                rgb: [1, 2, 3],
                stay_down: true
            }
        ]
    });

    function key(path) {
        return String(path).replace(/\\/g, "/");
    }

    function fs() {
        return {
            existsSync: function (path) {
                return Object.prototype.hasOwnProperty.call(files, key(path));
            },
            readFileSync: function (path) {
                var name = key(path);
                if (!Object.prototype.hasOwnProperty.call(files, name)) throw new Error("missing " + name);
                return files[name];
            },
            writeFileSync: function (path, data) {
                files[key(path)] = String(data);
            },
            appendFileSync: function () {},
            statSync: function () {
                return { size: 10 };
            }
        };
    }

    window.require = function (name) {
        if (name === "fs") return fs();
        if (name === "child_process") {
            return {
                execFile: function (cmd, args, opts, cb) {
                    if (typeof opts === "function") cb = opts;
                    if (cb) cb(null, "", "");
                }
            };
        }
        if (name === "os") return { tmpdir: function () { return "C:/Temp"; } };
        if (name === "path") {
            return {
                join: function () {
                    return Array.prototype.join.call(arguments, "/");
                }
            };
        }
        throw new Error("require " + name);
    };
    window.nodeRequire = window.require;
})();
