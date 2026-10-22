"""The Google sign-in landing page forwards only to the app's own schemes, escaped."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import auth_return
from routers.auth_return import app_target

APP = "exp://192.168.1.3:8081/--/auth/callback"


class AppTargetTests(unittest.TestCase):
    def test_forwards_code_to_expo_go_and_native(self):
        self.assertEqual(app_target(APP, "abc123", None, None), APP + "?code=abc123")
        self.assertEqual(app_target("ragastream://auth/callback", "x", None, None), "ragastream://auth/callback?code=x")
        self.assertEqual(app_target(APP + "?a=1", "x", None, None), APP + "?a=1&code=x")

    def test_forwards_errors(self):
        self.assertEqual(app_target(APP, None, "access_denied", "User said no"),
                         APP + "?error=access_denied&error_description=User+said+no")

    def test_refuses_other_destinations(self):
        for bad in ("https://evil.example/", "javascript:alert(1)", "http://192.168.1.3:8000/x", "", "exp:// spaced",
                    "intent://x#Intent;end", "EXP-not-a-scheme://x"):
            self.assertIsNone(app_target(bad, "c", None, None), bad)


class PageTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(auth_return.router)
        self.client = TestClient(app)

    def test_success_page_links_and_redirects_to_app(self):
        r = self.client.get("/auth/return", params={"app": APP, "code": "abc123"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/html", r.headers["content-type"])
        self.assertIn('href="exp://192.168.1.3:8081/--/auth/callback?code=abc123"', r.text)
        self.assertIn('window.location.replace("exp://192.168.1.3:8081/--/auth/callback?code=abc123")', r.text)
        self.assertIn("Back to RagaStream", r.text)
        self.assertIn("no-store", r.headers["cache-control"])

    def test_bad_destination_is_refused_without_a_link(self):
        r = self.client.get("/auth/return", params={"app": "https://evil.example/", "code": "abc"})
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("evil.example", r.text)
        self.assertNotIn("window.location", r.text)

    def test_values_cannot_break_out_of_html_or_script(self):
        r = self.client.get("/auth/return", params={"app": APP, "code": '"><script>alert(1)</script>'})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("<script>alert(1)", r.text)
        self.assertEqual(r.text.count("<script>"), 1)  # only ours

    def test_error_from_google_still_returns_to_app(self):
        r = self.client.get("/auth/return", params={"app": APP, "error": "access_denied"})
        self.assertIn("didn&#x27;t finish", r.text)  # apostrophe is HTML-escaped
        self.assertIn("error=access_denied", r.text)


if __name__ == "__main__":
    unittest.main()
