import unittest
from aiohttp.test_utils import AioHTTPTestCase
from server import create_app

class TestScheduleServer(AioHTTPTestCase):
    def get_app(self):
        return create_app()

    async def test_index_page(self):
        resp = await self.client.get('/')
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn('manifest.json', text)
        self.assertIn('heroCurrentWidget', text)
        self.assertIn('mobileBottomNav', text)
        self.assertIn('exportIcsBtn', text)
        self.assertIn('syncStatusBadge', text)

    async def test_manifest_endpoint(self):
        resp = await self.client.get('/manifest.json')
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get('Content-Type'), 'application/manifest+json; charset=utf-8')
        data = await resp.json()
        self.assertEqual(data.get('short_name'), 'бТИИ-262')
        self.assertEqual(data.get('display'), 'standalone')

    async def test_service_worker_endpoint(self):
        resp = await self.client.get('/sw.js')
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get('Content-Type'), 'application/javascript; charset=utf-8')
        self.assertEqual(resp.headers.get('Service-Worker-Allowed'), '/')
        text = await resp.text()
        self.assertIn('btii262', text)
        self.assertIn('addEventListener', text)

    async def test_api_schedule(self):
        resp = await self.client.get('/api/schedule')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data.get('group'), 'бТИИ-262')
        self.assertIn('days', data)
        self.assertTrue(len(data['days']) > 0)

    async def test_api_tasks(self):
        resp = await self.client.get('/api/tasks')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn('tasks', data)

    async def test_api_students(self):
        resp = await self.client.get('/api/students')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn('students', data)
        self.assertTrue(len(data['students']) >= 29)

    async def test_service_worker_headers(self):
        resp = await self.client.get('/sw.js')
        self.assertEqual(resp.status, 200)
        self.assertIn('no-cache', resp.headers.get('Cache-Control', ''))
        self.assertEqual(resp.headers.get('Service-Worker-Allowed'), '/')

    async def test_manifest_headers_and_fields(self):
        resp = await self.client.get('/manifest.json')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data.get('name'), 'Расписание бТИИ-262')
        self.assertEqual(data.get('start_url'), '/')
        self.assertEqual(data.get('scope'), '/')
        self.assertIn('icons', data)
        self.assertTrue(len(data['icons']) >= 1)

    async def test_schedule_data_structure(self):
        resp = await self.client.get('/api/schedule')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn('days', data)
        for day in data['days']:
            self.assertIn('dayOfWeek', day)
            self.assertIn('name', day)
            self.assertIn('short', day)
            self.assertIn('lessons', day)
            for lesson in day['lessons']:
                self.assertIn('id', lesson)
                self.assertIn('subject', lesson)
                self.assertIn('type', lesson)
                self.assertIn('time', lesson)
                self.assertIn('pair', lesson)
                self.assertIn('room', lesson)
                self.assertIn('subgroup', lesson)

    async def test_static_assets_served(self):
        for path in ['/static/css/style.css', '/static/js/app.js', '/static/js/schedule.js', '/static/js/tasks.js']:
            resp = await self.client.get(path)
            self.assertEqual(resp.status, 200, f"Failed to get {path}")
            text = await resp.text()
            self.assertTrue(len(text) > 100, f"{path} content too short")

    async def test_favicon_ico(self):
        resp = await self.client.get('/favicon.ico')
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get('Content-Type'), 'image/svg+xml')

    async def test_service_worker_features(self):
        resp = await self.client.get('/sw.js')
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn('ignoreSearch: true', text)
        self.assertIn('fetchWithTimeout', text)
        self.assertIn('/api/schedule', text)
        self.assertIn('/api/students', text)

    async def test_index_inline_theme_script(self):
        resp = await self.client.get('/')
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn("localStorage.getItem('theme')", text)
        self.assertIn("prefers-color-scheme: dark", text)

    async def test_css_integrity(self):
        resp = await self.client.get('/static/css/style.css')
        self.assertEqual(resp.status, 200)
        css = await resp.text()
        self.assertNotIn('rgba(var(', css)
        self.assertIn('.mobile-bottom-nav', css)
        self.assertIn('min-height: 44px', css)

if __name__ == '__main__':
    unittest.main()
