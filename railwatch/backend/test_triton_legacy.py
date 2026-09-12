import unittest

from triton_legacy import crc_ccitt, decode_nmea_latlon, parse_gga, parse_rmc, parse_telegram


class TritonLegacyTests(unittest.TestCase):
    def test_crc_ccitt_vector(self):
        self.assertEqual(crc_ccitt(b"123456789"), 0x29B1)

    def test_nmea_rmc(self):
        sentence = "$GPRMC,123519,A,2612.3456,S,02803.6789,E,10.0,180.0,120926,,,A"
        parsed = parse_rmc(sentence)
        self.assertIsNotNone(parsed)
        self.assertAlmostEqual(parsed["latitude"], -26.20576, places=4)
        self.assertAlmostEqual(parsed["longitude"], 28.061315, places=4)
        self.assertAlmostEqual(parsed["speed_kph"], 18.52, places=2)

    def test_nmea_gga(self):
        sentence = "$GPGGA,123519,2612.3456,S,02803.6789,E,1,08,0.9,1600.0,M,46.9,M,,"
        parsed = parse_gga(sentence)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["gps_quality"], 1)
        self.assertEqual(parsed["satellites"], 8)
        self.assertAlmostEqual(parsed["altitude_m"], 1600.0)

    def test_telegram_header_and_crc(self):
        body = b"$GPRMC,123519,A,2612.3456,S,02803.6789,E,10.0,180.0,120926,,,A\r\n"
        header = bytes([0x31, 0x01, 0x02, 0x03, 0x07, 0x03, 0x02, 0x28, 0x23, 0x00])
        raw = header + body
        crc = crc_ccitt(raw).to_bytes(2, "little")
        decoded = parse_telegram(raw + crc)
        self.assertTrue(decoded["valid_crc"])
        self.assertEqual(decoded["serial_number"], 0x030201)
        self.assertEqual(decoded["message_type"], 0x03)
        self.assertEqual(decoded["message_name"], "GPS_RMC")
        self.assertEqual(decoded["nmea"]["gps"]["speed_kph"], 18.52)

    def test_coordinate_decoder(self):
        self.assertAlmostEqual(decode_nmea_latlon("2612.3456", "S"), -26.20576, places=4)
        self.assertAlmostEqual(decode_nmea_latlon("02803.6789", "E"), 28.061315, places=4)


if __name__ == "__main__":
    unittest.main()
