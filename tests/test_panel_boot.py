"""Open the real panel page in Chrome, the same way Illustrator's panel does.

The page gets a normal browser history object, so a variable named history
cannot store the job list. The window is the size of the Illustrator panel,
and the Verlauf list has to be on screen with the saved job in it.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BOOT = os.path.join(ROOT, "tests", "boot.html")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super(Handler, self).__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        return


class PanelBootTest(unittest.TestCase):
    def test_history_shows_in_a_panel_sized_window(self):
        self.assertTrue(os.path.isfile(CHROME), "Chrome fehlt: " + CHROME)
        with open(os.path.join(ROOT, "plugin", "index.html"), encoding="utf-8") as handle:
            html = handle.read()
        html = html.replace('href="css/', 'href="/plugin/css/')
        html = html.replace('src="js/', 'src="/plugin/js/')
        html = html.replace(
            '<script>window.nodeRequire = (typeof require === "function") ? require : null;</script>',
            '<script src="/tests/panel_node_mock.js"></script>',
        )
        probe = """
<script>
var list = document.getElementById("history");
var err = "";
try { rememberJob("C:/temp/job.json", "192.168.0.200", "8080", 3); }
catch (e) { err = String(e && e.message ? e.message : e); }
renderSimCommands([{title: "Star shape", parts: [{note: "Turn stroke", commands: "U1,2 D1,2"}]}]);
var commands = document.getElementById("sim-commands");
var opened = commands && commands.querySelector("details") ? commands.querySelector("details").open : true;
var box = list.getBoundingClientRect();
var probe = document.createElement("pre");
probe.id = "panel-probe";
probe.textContent = JSON.stringify({
    text: list.textContent,
    height: box.height,
    top: box.top,
    bottom: box.bottom,
    innerHeight: window.innerHeight,
    jobs: (typeof plotJobs !== "undefined" && plotJobs) ? plotJobs.length : -1,
    err: err,
    commands: commands ? commands.textContent : "",
    commandOpen: opened
});
document.body.appendChild(probe);
</script>
"""
        html = html.replace("</body>", probe + "\n</body>")
        with open(BOOT, "w", encoding="utf-8") as handle:
            handle.write(html)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()
        profile = os.path.join(ROOT, "tests", "chrome-profile")
        if os.path.isdir(profile):
            shutil.rmtree(profile, ignore_errors=True)
        url = "http://127.0.0.1:%d/tests/boot.html" % server.server_address[1]
        try:
            done = subprocess.run(
                [
                    CHROME,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-first-run",
                    "--window-size=380,640",
                    "--user-data-dir=" + profile,
                    "--dump-dom",
                    url,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=40,
                check=False,
            )
        finally:
            server.shutdown()
            server.server_close()
            if os.path.isfile(BOOT):
                os.remove(BOOT)
        page = done.stdout.decode("utf-8", "replace")
        found = re.search(r'id="panel-probe">([^<]*)</pre>', page)
        self.assertTrue(found, "Panel ist nicht hochgefahren:\n" + page[-1500:] + "\n" + done.stderr.decode("utf-8", "replace")[-800:])
        probe_data = json.loads(found.group(1))
        self.assertEqual(probe_data["err"], "")
        self.assertGreaterEqual(probe_data["jobs"], 2)
        self.assertIn("8 Pfade", probe_data["text"])
        self.assertIn("Karton", probe_data["text"])
        self.assertIn("ca. 9:20", probe_data["text"])
        self.assertIn("3 Pfade", probe_data["text"])
        self.assertIn("ca. 1 s", probe_data["text"])
        self.assertIn("Star shape", probe_data["commands"])
        self.assertIn("Turn stroke", probe_data["commands"])
        self.assertFalse(probe_data["commandOpen"])
        self.assertGreaterEqual(probe_data["height"], 24)
        self.assertLess(probe_data["top"], probe_data["innerHeight"])
        self.assertGreater(probe_data["bottom"], 0)


if __name__ == "__main__":
    unittest.main()
