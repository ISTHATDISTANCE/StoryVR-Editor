import unittest
from unittest.mock import patch

import https_server


IFCONFIG_WITH_WIFI_AND_ETHERNET = """
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
    inet 192.168.1.117 netmask 0xffffff00 broadcast 192.168.1.255
    status: active
en14: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
    inet 10.88.3.212 netmask 0xfffffe00 broadcast 10.88.3.255
    status: active
en7: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
    inet 10.0.0.9 netmask 0xffffff00 broadcast 10.0.0.255
    status: inactive
"""

NETWORKSETUP_WITH_WIFI_AND_ETHERNET = """
Hardware Port: USB 10/100/1000 LAN
Device: en14
Ethernet Address: f4:4d:ad:07:92:31

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: 0e:71:7b:0e:0d:3c
"""


class HttpsServerLanDetectionTests(unittest.TestCase):
    def test_detect_lan_ips_prefers_wifi_over_default_route_ethernet(self):
        def output_for(command):
            if command[0] == "ifconfig":
                return IFCONFIG_WITH_WIFI_AND_ETHERNET
            if command[0] == "networksetup":
                return NETWORKSETUP_WITH_WIFI_AND_ETHERNET
            return ""

        with patch.object(https_server, "command_output", side_effect=output_for), patch.object(
            https_server,
            "detect_default_route_ip",
            return_value="10.88.3.212",
        ):
            self.assertEqual(
                https_server.detect_lan_ips(),
                ["192.168.1.117", "10.88.3.212"],
            )

    def test_system_profiler_supplies_wifi_interface_when_networksetup_is_unavailable(self):
        profiler_output = """
Wi-Fi:
    Interfaces:
      en0:
        Card Type: Wi-Fi
"""

        def output_for(command):
            if command[0] == "ifconfig":
                return IFCONFIG_WITH_WIFI_AND_ETHERNET
            if command[0] == "system_profiler":
                return profiler_output
            return ""

        with patch.object(https_server, "command_output", side_effect=output_for), patch.object(
            https_server,
            "detect_default_route_ip",
            return_value="10.88.3.212",
        ):
            self.assertEqual(
                https_server.detect_lan_ips(),
                ["192.168.1.117", "10.88.3.212"],
            )

    def test_lan_display_puts_preferred_public_host_before_localhost(self):
        self.assertEqual(
            https_server.display_hosts(
                "0.0.0.0",
                ["192.168.1.117", "10.88.3.212"],
                prefer_public=True,
            ),
            ["192.168.1.117", "10.88.3.212", "localhost", "127.0.0.1"],
        )

    def test_story_paths_are_normalized_for_printed_final_url(self):
        self.assertEqual(
            https_server.normalized_story_paths(
                [
                    "animation_capture_experiement/shark/dist-webxr-adaptation",
                    "/animation_capture_experiement/shark/dist-webxr-adaptation/",
                ],
            ),
            ["/animation_capture_experiement/shark/dist-webxr-adaptation/"],
        )


if __name__ == "__main__":
    unittest.main()
