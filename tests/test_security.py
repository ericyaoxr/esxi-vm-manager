import pytest
from flask import Flask, request
from app.security import is_ip_allowed, get_client_ip, is_private_ip, ip_in_subnet


class TestIPWhitelistSecurity:
    def test_private_ip_allowed(self):
        app = Flask(__name__)

        with app.test_request_context(environ_base={'REMOTE_ADDR': '192.168.1.100'}):
            config = {'allowed_ips': []}
            allowed, ip = is_ip_allowed(request, config)
            assert allowed is True

    def test_ip_whitelist_config_key(self):
        from app.security import is_ip_allowed
        import inspect
        source = inspect.getsource(is_ip_allowed)
        assert 'allowed_ips' in source, "is_ip_allowed should use 'allowed_ips' config key"
        assert 'allowed_networks' not in source, "is_ip_allowed should not use 'allowed_networks'"

    def test_empty_whitelist_blocks_public_ip(self):
        app = Flask(__name__)

        with app.test_request_context(environ_base={'REMOTE_ADDR': '8.8.8.8'}):
            config = {'allowed_ips': []}
            allowed, ip = is_ip_allowed(request, config)
            assert allowed is False

    def test_whitelisted_ip_allowed(self):
        app = Flask(__name__)

        with app.test_request_context(environ_base={'REMOTE_ADDR': '8.8.8.8'}):
            config = {'allowed_ips': ['8.8.8.8']}
            allowed, ip = is_ip_allowed(request, config)
            assert allowed is True


class TestPrivateIPDetection:
    def test_private_ip_ranges(self):
        private_ips = [
            '192.168.1.1',
            '192.168.0.100',
            '10.0.0.1',
            '10.255.255.255',
            '172.16.0.1',
            '172.31.255.255',
            '127.0.0.1'
        ]
        for ip in private_ips:
            assert is_private_ip(ip) is True, f"{ip} should be recognized as private"

    def test_public_ip_ranges(self):
        public_ips = [
            '8.8.8.8',
            '1.1.1.1',
            '114.114.114.114'
        ]
        for ip in public_ips:
            assert is_private_ip(ip) is False, f"{ip} should not be recognized as private"


class TestIPSubnetMatching:
    def test_ip_in_subnet(self):
        assert ip_in_subnet('192.168.1.100', '192.168.1.0/24') is True
        assert ip_in_subnet('192.168.1.100', '192.168.2.0/24') is False
        assert ip_in_subnet('10.0.0.50', '10.0.0.0/8') is True
        assert ip_in_subnet('8.8.8.8', '8.8.8.8') is True
