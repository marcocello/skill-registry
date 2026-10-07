from concurrent.futures import ThreadPoolExecutor

from backend.app.config import Settings
from backend.app.main import create_app


def test_open_restore_is_atomic_preserves_versions_and_handles_export_failure(tmp_path):
    settings = Settings(database_path=tmp_path / 'registry.sqlite3', git_dir=tmp_path / 'unused', public_url='http://localhost')
    app = create_app(settings, require_setup=True)
    client = app.test_client()
    assert client.post('/setup', json={'auth_mode': 'none', 'public_url': 'http://localhost', 'git_repository': {'name': 'registry-git'}}, headers={'Origin': 'http://localhost'}).status_code == 201
    files = {'SKILL.md': '# Original\n', 'assets/data.bin': {'encoding': 'base64', 'data': 'AAEC'}}
    assert client.post('/skills', json={'slug': 'restore-test', 'name': 'Original', 'description': 'Original description', 'files': files}).status_code == 201
    assert client.put('/skills/restore-test', json={'name': 'Changed', 'description': 'Changed description', 'files': {'SKILL.md': '# Changed\n'}}).status_code == 200
    before = client.get('/skills/restore-test').json

    def restore():
        with app.test_client() as concurrent_client:
            return concurrent_client.post('/skills/restore-test/restore', json={'version': 1, 'expected_version': 2}, headers={'Origin': 'http://localhost'}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: restore(), range(2))) == [201, 409]
    current = client.get('/skills/restore-test').json
    assert current['latest_version'] == 3
    assert current['versions'][:2] == before['versions']
    assert current['versions'][2]['files'] == files
    assert current['versions'][2]['name'] == 'Original'
    assert current['versions'][2]['description'] == 'Original description'
    assert current['versions'][2]['author'] is None
    assert client.post('/skills/restore-test/restore', json={'version': 1, 'expected_version': 3}).status_code == 403
    assert client.post('/skills/restore-test/restore', json={'version': 3, 'expected_version': 3}, headers={'Origin': 'http://localhost'}).status_code == 409

    registry = app.extensions['registry_service']
    def fail_export(*args, **kwargs):
        raise RuntimeError('Simulated unavailable Git storage')
    registry.exporter.export_version = fail_export
    restored = client.post('/skills/restore-test/restore', json={'version': 2, 'expected_version': 3}, headers={'Origin': 'http://localhost'})
    assert restored.status_code == 201
    assert restored.json['git_export']['status'] == 'pending'
    assert client.get('/skills/restore-test').json['latest_version'] == 4
