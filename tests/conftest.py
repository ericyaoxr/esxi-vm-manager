import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from app.main import get_config


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        yield app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def runner(app):
    return app.test_cli_runner()


@pytest.fixture
def auth_headers():
    return {'Content-Type': 'application/json'}


@pytest.fixture
def sample_vm_data():
    return {
        'name': 'test-vm',
        'server_host': '192.168.1.100',
        'state': 'poweredOn',
        'cpu': 4,
        'memory': 8
    }


@pytest.fixture
def sample_task_data():
    return {
        'id': 'test-task-001',
        'name': '测试任务',
        'trigger_type': 'cron',
        'action': 'start',
        'delay': 10,
        'cron': {'hour': 9, 'minute': 0, 'day_of_week': '0-4'},
        'target_vms': [{'name': 'vm1', 'server_host': '192.168.1.100'}],
        'enabled': True
    }
