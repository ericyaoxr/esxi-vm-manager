import pytest
import json


class TestHealthEndpoint:
    def test_health_check(self, client):
        response = client.get('/health')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'healthy'
        assert 'timestamp' in data


class TestConfigAPI:
    def test_get_config(self, client):
        response = client.get('/api/config')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['success'] is True
        assert 'config' in data

    def test_save_config(self, client, auth_headers):
        new_config = {
            'auto_refresh': 30,
            'default_delay': 10,
            'show_stopped': True,
            'confirm_batch': True,
            'natural_sort': False,
            'basic_auth_username': '',
            'basic_auth_enabled': False,
            'ip_whitelist_enabled': False,
            'allowed_ips': [],
            'api_timeout': 30,
            'scheduler_enabled': True,
            'task_timeout': 10,
            'log_enabled': True,
            'filter_hosts': []
        }
        response = client.post('/api/config',
                               data=json.dumps(new_config),
                               headers=auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['success'] is True


class TestServerAPI:
    def test_get_servers(self, client):
        response = client.get('/api/servers')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'success' in data

    def test_add_server(self, client, auth_headers):
        new_server = {
            'host': '192.168.1.100',
            'username': 'admin',
            'password': 'password'
        }
        response = client.post('/api/servers',
                               data=json.dumps(new_server),
                               headers=auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['success'] is True or 'error' in data


class TestVMAPI:
    def test_get_vms_empty_servers(self, client):
        response = client.get('/api/vms')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'success' in data
        assert 'vms' in data

    def test_get_vm_detail(self, client):
        response = client.get('/api/vm/test-vm/detail?server_host=127.0.0.1')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'success' in data


class TestBatchVMAPI:
    def test_batch_action_validation(self, client, auth_headers):
        response = client.post('/api/batch-vm-action',
                               data=json.dumps({'vms': []}),
                               headers=auth_headers)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['success'] is False
        assert 'error' in data
