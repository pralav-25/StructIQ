import csv
import io
import os
import tempfile
import unittest
from unittest.mock import patch

_test_database = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = (
    os.getenv("TEST_DATABASE_URL") or "sqlite:///" + _test_database.name + "/test.db"
)

from fastapi.testclient import TestClient
from PIL import Image

import database
from main import COOKIE, app
from security import check_password

HEADERS = {"X-Requested-With": "StructIQ"}
ASSET = {
    "name": "Test bridge",
    "asset_type": "Bridge",
    "construction_year": 2000,
    "latitude": 13,
    "longitude": 80,
}


def photo():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), "gray").save(buffer, "PNG")
    return buffer.getvalue()


class ApiTests(unittest.TestCase):
    def setUp(self):
        database.Base.metadata.drop_all(database.engine)
        database.Base.metadata.create_all(database.engine)
        self.client = TestClient(app, headers=HEADERS)
        self.other = TestClient(app, headers=HEADERS)
        self.account = self.client.post("/api/auth/demo").json()
        self.other_account = self.other.post("/api/auth/demo").json()
        result = self.client.post("/api/assets", json=ASSET)
        self.assertEqual(result.status_code, 201, result.text)
        self.asset = result.json()

    def tearDown(self):
        self.client.close()
        self.other.close()

    def upload(self, **kwargs):
        return self.client.post(
            "/api/reports",
            data={
                "asset_id": kwargs.pop("asset_id", self.asset["id"]),
                "description": kwargs.pop("description", "Surface crack requiring inspection"),
                "severity": kwargs.pop("severity", "10"),
            },
            files={"file": kwargs.pop("file", ("evidence.png", photo(), "image/png"))},
        )

    def health(self):
        return next(
            a for a in self.client.get("/api/assets").json() if a["id"] == self.asset["id"]
        )["health_score"]

    def test_report_summaries_do_not_load_photo_blobs(self):
        from sqlalchemy import event, inspect

        uploaded = self.upload().json()
        with database.SessionLocal() as db:
            report = db.get(database.Report, uploaded["id"])
            self.assertTrue(report.has_image)
            self.assertIn("image", inspect(report).unloaded)

        statements = []
        def capture(_conn, _cursor, statement, _params, _context, _many):
            statements.append(statement)
        event.listen(database.engine, "before_cursor_execute", capture)
        try:
            response = self.client.get("/api/reports")
        finally:
            event.remove(database.engine, "before_cursor_execute", capture)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()[0]["has_image"])
        self.assertFalse(any("incident_reports.image AS" in sql for sql in statements))
        image = self.client.get(f"/api/reports/{uploaded['id']}/image")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/jpeg")
        self.assertEqual(self.other.get(f"/api/reports/{uploaded['id']}/image").status_code, 404)

    def test_workspace_isolation_and_anonymous_access(self):
        self.assertEqual(len(self.client.get("/api/assets").json()), 10)
        self.assertEqual(len(self.other.get("/api/assets").json()), 9)
        stranger = TestClient(app, headers=HEADERS)
        self.assertEqual(stranger.get("/api/assets").status_code, 401)
        self.assertEqual(stranger.post("/api/assets", json=ASSET).status_code, 401)
        self.assertEqual(
            self.other.put(f"/api/assets/{self.asset['id']}", json=ASSET).status_code, 404
        )
        self.assertEqual(
            self.other.post(
                f"/api/assets/{self.asset['id']}/maintenance", json={"note": "Repair completed"}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.other.patch(
                f"/api/assets/{self.asset['id']}/archive", json={"archived": True}
            ).status_code,
            404,
        )

    def test_registration_password_hash_login_and_logout(self):
        credentials = {"username": "TestOperator", "password": "a long unique passphrase"}
        response = self.client.post(
            "/api/auth/register", json={**credentials, "name": "New workspace"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        with database.SessionLocal() as db:
            account = db.query(database.Workspace).filter_by(username="testoperator").one()
            self.assertNotIn(credentials["password"], account.password_hash)
            self.assertTrue(check_password(credentials["password"], account.password_hash))
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(
            self.client.post(
                "/api/auth/login", json={**credentials, "password": "wrong password"}
            ).status_code,
            401,
        )
        self.assertEqual(self.client.post("/api/auth/login", json=credentials).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").json()["name"], "New workspace")
        duplicate = self.other.post("/api/auth/register", json={**credentials, "name": "Duplicate"})
        self.assertEqual(duplicate.status_code, 409)

    def test_cookie_security_and_csrf_header(self):
        cookie = self.client.cookies[COOKIE]
        session_header = self.client.post("/api/auth/demo").headers["set-cookie"]
        self.assertIn("HttpOnly", session_header)
        self.assertIn("SameSite=lax", session_header)
        plain = TestClient(app)
        plain.cookies.set(COOKIE, cookie)
        self.assertEqual(plain.post("/api/assets", json=ASSET).status_code, 403)
        with patch.dict(os.environ, {"VERCEL": "1"}):
            response = self.other.post("/api/auth/demo")
            self.assertIn("Secure", response.headers["set-cookie"])

    def test_resolution_preserves_history_and_never_inflates_score(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.text)
        report_id = response.json()["id"]
        self.assertLess(self.health(), self.asset["health_score"])
        route = f"/api/reports/{report_id}/resolve"
        self.assertFalse(
            self.client.post(route, json={"note": "Repair inspected and confirmed"}).json()[
                "already_resolved"
            ]
        )
        restored = self.health()
        self.assertEqual(restored, self.asset["health_score"])
        self.assertTrue(
            self.client.post(route, json={"note": "Repeat resolution attempt"}).json()[
                "already_resolved"
            ]
        )
        self.assertEqual(self.health(), restored)
        self.assertEqual(self.client.get("/api/reports?status=Open").json(), [])
        history = self.client.get("/api/reports").json()[0]
        self.assertEqual(history["status"], "Resolved")
        self.assertEqual(history["resolution_note"], "Repair inspected and confirmed")
        self.assertIsNotNone(history["resolved_at"])
        self.assertEqual(
            len([e for e in self.client.get("/api/activity").json() if e["kind"] == "resolution"]),
            1,
        )

    def test_multiple_report_penalties_remain_until_each_resolution(self):
        a, b = self.upload().json(), self.upload().json()
        self.assertEqual(self.health(), self.asset["health_score"] - 30)
        self.client.post(f"/api/reports/{a['id']}/resolve", json={"note": "First repair completed"})
        self.assertEqual(self.health(), self.asset["health_score"] - 15)
        self.assertEqual(
            self.other.post(
                f"/api/reports/{b['id']}/resolve", json={"note": "Unauthorized resolution"}
            ).status_code,
            404,
        )
        self.assertEqual(self.other.get(f"/api/reports/{b['id']}/image").status_code, 404)

    def test_report_archive_and_restore(self):
        report = self.upload().json()
        endpoint = f"/api/assets/{self.asset['id']}/archive"
        self.assertEqual(self.client.patch(endpoint, json={"archived": True}).status_code, 409)
        self.client.post(
            f"/api/reports/{report['id']}/resolve", json={"note": "Issue addressed and inspected"}
        )
        self.assertEqual(self.client.patch(endpoint, json={"archived": True}).status_code, 200)
        self.assertNotIn(self.asset["id"], [a["id"] for a in self.client.get("/api/assets").json()])
        self.assertEqual(
            self.client.get("/api/assets?archived=true").json()[0]["id"], self.asset["id"]
        )
        self.assertEqual(self.upload().status_code, 404)
        self.client.patch(endpoint, json={"archived": False})
        self.assertIn(self.asset["id"], [a["id"] for a in self.client.get("/api/assets").json()])

    def test_verified_image_and_rejected_invalid_uploads(self):
        for kwargs, code in [
            ({"description": "   "}, 422),
            ({"file": ("test.txt", b"text", "text/plain")}, 415),
            ({"file": ("empty.png", b"", "image/png")}, 422),
            ({"file": ("fake.png", b"not an image", "image/png")}, 422),
            ({"file": ("large.png", b"x" * (3 * 1024 * 1024 + 1), "image/png")}, 413),
            ({"severity": "30"}, 422),
        ]:
            response = self.upload(**kwargs)
            self.assertEqual(response.status_code, code, response.text)
        self.assertEqual(self.client.get("/api/reports").json(), [])
        self.assertEqual(self.health(), self.asset["health_score"])
        report = self.upload().json()
        image = self.client.get(f"/api/reports/{report['id']}/image")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/jpeg")
        with Image.open(io.BytesIO(image.content)) as decoded:
            self.assertEqual(decoded.size, (40, 40))
            self.assertFalse(decoded.getexif())

    def test_public_report_is_scoped_and_tracking_does_not_leak_details(self):
        public = TestClient(app, headers=HEADERS)
        token = self.account["share_token"]
        public_assets = public.get(f"/api/public/{token}/assets").json()
        self.assertEqual(set(public_assets["assets"][0]), {"id", "name", "asset_type"})
        response = public.post(
            f"/api/public/{token}/reports",
            data={
                "asset_id": self.asset["id"],
                "description": "Private observation",
                "severity": "5",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        report = response.json()
        tracking = public.get(f"/api/track/{report['tracking_code']}").json()
        self.assertEqual(tracking["status"], "Open")
        self.assertNotIn("description", tracking)
        self.assertNotIn("image", tracking)
        self.assertNotIn("username", tracking)
        foreign = self.other.get("/api/assets").json()[0]["id"]
        self.assertEqual(
            public.post(
                f"/api/public/{token}/reports",
                data={"asset_id": foreign, "description": "Wrong workspace", "severity": "5"},
            ).status_code,
            404,
        )
        self.assertEqual(public.get("/api/public/not-a-token/assets").status_code, 404)

    def test_flood_is_reversible_idempotent_and_workspace_scoped(self):
        before = {a["id"]: a["health_score"] for a in self.client.get("/api/assets").json()}
        second_before = self.other.get("/api/assets").json()
        endpoint = "/api/scenarios/flood"
        self.assertTrue(self.client.post(endpoint, json={"active": True}).json()["changed"])
        first = self.client.get("/api/assets").json()
        self.assertFalse(self.client.post(endpoint, json={"active": True}).json()["changed"])
        self.assertEqual(first, self.client.get("/api/assets").json())
        for asset in first:
            self.assertEqual(
                asset["health_score"],
                max(0, before[asset["id"]] - (15 if asset["asset_type"] == "Road" else 0)),
            )
        self.client.post(endpoint, json={"active": False})
        self.assertEqual(
            before, {a["id"]: a["health_score"] for a in self.client.get("/api/assets").json()}
        )
        self.assertEqual(second_before, self.other.get("/api/assets").json())

    def test_maintenance_records_note_and_keeps_open_report_penalty(self):
        self.upload()
        endpoint = f"/api/assets/{self.asset['id']}/maintenance"
        response = self.client.post(endpoint, json={"note": "Repaired deck expansion joints"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["condition_score"], 100)
        self.assertEqual(response.json()["health_score"], 85)
        self.assertTrue(response.json()["last_service_at"])
        self.assertIn(
            "Repaired deck expansion joints", self.client.get("/api/activity").json()[0]["message"]
        )
        self.assertEqual(self.client.post(endpoint, json={"note": "  "}).status_code, 422)

    def test_edit_asset_validation_seed_and_filters(self):
        endpoint = f"/api/assets/{self.asset['id']}"
        self.assertEqual(
            self.client.put(endpoint, json={**ASSET, "name": "New name", "latitude": 22}).json()[
                "latitude"
            ],
            22,
        )
        self.assertEqual(
            self.client.put(endpoint, json={**ASSET, "construction_year": 9999}).status_code, 422
        )
        self.assertEqual(self.client.post("/api/setup-demo").json()["added"], 0)
        self.assertEqual(self.client.post("/api/setup-demo").json()["added"], 0)
        self.assertEqual(self.client.get("/api/reports?status=bad").status_code, 422)
        self.assertEqual(self.client.get("/setup-demo").status_code, 405)

    def test_export_is_scoped_and_protects_spreadsheet_formulas(self):
        self.client.put(
            f"/api/assets/{self.asset['id']}",
            json={**ASSET, "name": '=HYPERLINK("https://example.com")'},
        )
        response = self.client.get("/api/export")
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.text)))
        self.assertEqual(len(rows), 11)
        self.assertTrue(rows[-1][1].startswith("'="))
        self.assertNotIn(self.other_account["share_token"], response.text)

    def test_session_revocation_expiry_and_persistence_across_clients(self):
        resumed = TestClient(app, headers=HEADERS)
        resumed.cookies.update(self.client.cookies)
        self.assertEqual(len(resumed.get("/api/assets").json()), 10)
        resumed.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/assets").status_code, 401)
        with database.SessionLocal() as db:
            db.query(database.LoginSession).update({"expires_at": database.utcnow()})
            db.commit()
        self.assertEqual(self.other.get("/api/auth/me").status_code, 401)

    def test_auth_request_limit(self):
        for _ in range(15):
            self.assertEqual(
                self.client.post(
                    "/api/auth/login",
                    json={"username": "missing", "password": "incorrect password"},
                ).status_code,
                401,
            )
        response = self.client.post(
            "/api/auth/login", json={"username": "missing", "password": "incorrect password"}
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn("retry-after", response.headers)

    def test_expired_demo_is_inaccessible_and_cleaned_up(self):
        from datetime import timedelta

        with database.SessionLocal() as db:
            db.query(database.Workspace).filter_by(share_token=self.account["share_token"]).update(
                {"created_at": database.utcnow() - timedelta(days=8)}
            )
            db.commit()
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(
            self.client.get(f"/api/public/{self.account['share_token']}/assets").status_code, 404
        )
        self.client.post("/api/auth/demo")
        with database.SessionLocal() as db:
            self.assertIsNone(
                db.query(database.Workspace)
                .filter_by(share_token=self.account["share_token"])
                .first()
            )

    def test_pages_health_and_secret_files_are_not_served(self):
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")
        for path in ["/", "/app", "/report/example", "/track/example"]:
            self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(
            self.client.get("/auth.html", follow_redirects=False).headers["location"], "/app"
        )
        self.assertEqual(self.client.get("/database.py").status_code, 404)
        self.assertEqual(self.client.get("/structiq.db").status_code, 404)
        self.assertEqual(self.client.get("/.env").status_code, 404)
        self.assertEqual(self.client.get("/api/assets").headers["cache-control"], "no-store")
