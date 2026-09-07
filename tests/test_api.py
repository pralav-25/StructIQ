import os
import tempfile
import unittest

# Set before importing the application: startup must not open the demo database.
_test_database = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + _test_database.name + "/test.db"

from fastapi.testclient import TestClient
import database
from main import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        database.Base.metadata.drop_all(database.engine)
        database.Base.metadata.create_all(database.engine)
        self.client = TestClient(app)
        self.asset = self.client.post("/assets", json={
            "name": "Test bridge", "asset_type": "Bridge", "construction_year": 2000,
            "latitude": 13, "longitude": 80,
        }).json()

    def upload(self, **kwargs):
        return self.client.post("/reports/upload-ai", data={
            "asset_id": self.asset["id"], "description": kwargs.pop("description", "Surface crack"),
        }, files={"file": kwargs.pop("file", ("download.png", b"demo-image", "image/png"))})

    def test_resolution_is_retained_and_idempotent(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["simulated"])
        report_id = response.json()["report_id"]
        route = f"/reports/{report_id}/resolve"
        self.assertFalse(self.client.post(route).json()["already_resolved"])
        health = self.client.get("/assets").json()[0]["health_score"]
        self.assertTrue(self.client.post(route).json()["already_resolved"])
        self.assertEqual(self.client.get("/assets").json()[0]["health_score"], health)
        self.assertEqual(self.client.get("/reports?status=Open").json(), [])
        self.assertEqual(self.client.get("/reports").json()[0]["status"], "Resolved")

    def test_rejects_invalid_uploads_without_changing_health(self):
        for kwargs, status in [
            ({"description": "   "}, 422),
            ({"file": ("test.txt", b"text", "text/plain")}, 415),
            ({"file": ("empty.png", b"", "image/png")}, 422),
            ({"file": ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}, 413),
        ]:
            self.assertEqual(self.upload(**kwargs).status_code, status)
        self.assertEqual(self.client.get("/reports").json(), [])
        self.assertEqual(self.client.get("/assets").json()[0]["health_score"], self.asset["health_score"])

    def test_seeding_is_post_only_and_repeatable(self):
        self.assertEqual(self.client.get("/setup-demo").status_code, 405)
        self.assertEqual(self.client.post("/setup-demo").status_code, 200)
        self.client.post("/setup-demo")
        self.assertEqual(len(self.client.get("/assets").json()), 10)

    def test_invalid_report_filter_and_missing_report(self):
        self.assertEqual(self.client.get("/reports?status=invalid").status_code, 422)
        self.assertEqual(self.client.post("/reports/999/resolve").status_code, 404)
