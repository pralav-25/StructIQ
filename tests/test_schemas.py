import unittest

from pydantic import ValidationError

from schemas import AssetCreate

VALID_ASSET = {
    "name": "Adyar Bridge",
    "asset_type": "Bridge",
    "construction_year": 1970,
    "latitude": 13.0067,
    "longitude": 80.2595,
}


class AssetCreateTests(unittest.TestCase):
    def test_accepts_and_normalizes_supported_asset(self):
        asset = AssetCreate(**{**VALID_ASSET, "name": "  Adyar Bridge  "})

        self.assertEqual(asset.name, "Adyar Bridge")

    def test_rejects_blank_name(self):
        with self.assertRaises(ValidationError):
            AssetCreate(**{**VALID_ASSET, "name": "   "})

    def test_rejects_unknown_asset_type(self):
        with self.assertRaises(ValidationError):
            AssetCreate(**{**VALID_ASSET, "asset_type": "Tunnel"})

    def test_rejects_coordinates_outside_earth_bounds(self):
        for field, value in (("latitude", 90.1), ("longitude", -180.1)):
            with self.subTest(field=field):
                with self.assertRaises(ValidationError):
                    AssetCreate(**{**VALID_ASSET, field: value})

    def test_rejects_non_positive_construction_year(self):
        with self.assertRaises(ValidationError):
            AssetCreate(**{**VALID_ASSET, "construction_year": 0})


if __name__ == "__main__":
    unittest.main()
