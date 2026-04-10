import ipaddress
import socket
import os
import re
from functools import wraps
from cryptography.fernet import Fernet

def get_encryption_key():
    key_file = os.path.join(os.path.dirname(__file__), '..', 'config', '.key')
    if os.path.exists(key_file):
        with open(key_file, 'rb') as f:
            return f.read()
    key = Fernet.generate_key()
    os.makedirs(os.path.dirname(key_file), exist_ok=True)
    with open(key_file, 'wb') as f:
        f.write(key)
    return key

_fernet = Fernet(get_encryption_key())

def encrypt_password(password):
    if not password:
        return password
    return _fernet.encrypt(password.encode()).decode()

def decrypt_password(encrypted):
    if not encrypted:
        return encrypted
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except:
        return encrypted

def is_private_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_reserved
    except:
        return False

def ip_in_subnet(ip_str, subnet_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        network = ipaddress.ip_network(subnet_str, strict=False)
        return ip in network
    except:
        return False

def get_client_ip(request):
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    if request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    return request.remote_addr

def is_ip_allowed(request, config):
    client_ip = get_client_ip(request)

    if is_private_ip(client_ip):
        return True, client_ip

    allowed_networks = config.get('allowed_networks', [])
    for network in allowed_networks:
        if network and network.strip():
            if ip_in_subnet(client_ip, network.strip()):
                return True, client_ip

    return False, client_ip

ALLOWED_ESXI_NETWORKS = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '127.0.0.1']

def validate_esxi_host(host):
    if not host:
        return False
    host = host.strip()
    if host in ['localhost', '127.0.0.1']:
        return True
    try:
        ip = ipaddress.ip_address(host)
        for network in ALLOWED_ESXI_NETWORKS:
            if ip in ipaddress.ip_network(network):
                return True
        return False
    except:
        return False

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import request, jsonify
        api_key = request.headers.get('X-API-Key')
        config = request.app.config.get('APP_CONFIG', {})
        api_keys = config.get('api_keys', [])
        if api_keys and api_key not in api_keys:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

def sanitize_input(text, allow_html=False):
    if not text:
        return text
    if allow_html:
        import bleach
        return bleach.clean(text, tags=[], strip=True)
    return re.sub(r'[<>"\']', '', str(text))
