import unittest

from scoring import calculate_health, maintenance_priority


class CalculateHealthTests(unittest.TestCase):
    def test_roads_use_the_faster_decay_rate(self):
        age, score, priority = calculate_health("Road", 2006, current_year=2026)

        self.assertEqual(age, 20)
        self.assertEqual(score, 40.0)
        self.assertEqual(priority, "High")

    def test_non_road_assets_use_the_standard_decay_rate(self):
        age, score, priority = calculate_health("Bridge", 1970, current_year=2026)

        self.assertEqual(age, 56)
        self.assertEqual(score, 72.0)
        self.assertEqual(priority, "Low")

    def test_health_score_cannot_drop_below_zero(self):
        _, score, priority = calculate_health("Road", 1950, current_year=2026)

        self.assertEqual(score, 0.0)
        self.assertEqual(priority, "Emergency")

    def test_future_construction_year_is_rejected(self):
        with self.assertRaises(ValueError):
            calculate_health("Bridge", 2027, current_year=2026)


class MaintenancePriorityTests(unittest.TestCase):
    def test_priority_boundaries(self):
        self.assertEqual(maintenance_priority(39.9), "Emergency")
        self.assertEqual(maintenance_priority(40), "High")
        self.assertEqual(maintenance_priority(69.9), "High")
        self.assertEqual(maintenance_priority(70), "Low")


if __name__ == "__main__":
    unittest.main()
